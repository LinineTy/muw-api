// @muw-owned
package model

import (
	"errors"
	"strings"
)

// OIDC Provider（对外提供 OAuth2/OIDC 身份验证）的持久层。
//
// 分工：
//   - OIDCClient       第三方应用注册与审核状态（申请 → pending → 管理员批准）
//   - OIDCAuthCode     授权码（一次性、短寿命、绑 PKCE 与回调地址）
//   - OIDCRefreshToken 刷新令牌（轮换 + 重放检测，绑登录会话）
//   - OIDCConsent      用户对某个应用的授权（含"以后不再询问"开关）
//   - OIDCSigningKey   id_token 的 RS256 签名密钥（私钥经 AES-GCM 落库，支持轮换）
const (
	OIDCClientStatusPending  = "pending"
	OIDCClientStatusApproved = "approved"
	OIDCClientStatusRejected = "rejected"
	OIDCClientStatusDisabled = "disabled"

	OIDCClientTypePublic       = "public"
	OIDCClientTypeConfidential = "confidential"

	OIDCSigningKeyStatusActive  = "active"
	OIDCSigningKeyStatusRetired = "retired"
)

var (
	ErrOIDCClientNotFound = errors.New("OIDC 应用不存在")
	ErrOIDCNotApproved    = errors.New("OIDC 应用尚未通过审核")
)

type OIDCClient struct {
	Id       int    `json:"id"`
	ClientId string `json:"client_id" gorm:"type:varchar(64);uniqueIndex"`
	// SecretHash 用于校验（只存哈希）；SecretCipher 是 AES-GCM 加密的明文，
	// 仅用于"申请人本人在自己页面查看密钥"——管理员永远看不到密钥。
	SecretHash    string `json:"-" gorm:"type:varchar(128)"`
	SecretCipher  string `json:"-" gorm:"type:text"`
	Name          string `json:"name" gorm:"type:varchar(128)"`
	Description   string `json:"description" gorm:"type:text"`
	RedirectUris  string `json:"redirect_uris" gorm:"type:text"`          // 每行一个，精确匹配
	Scopes        string `json:"scopes" gorm:"type:varchar(255)"`         // 空格分隔，限定该应用可申请的 scope
	ClientType    string `json:"client_type" gorm:"type:varchar(16)"`     // public / confidential
	Status        string `json:"status" gorm:"type:varchar(16);index"`    // pending / approved / rejected / disabled
	OwnerUserId   int    `json:"owner_user_id" gorm:"index"`              // 申请人（站内用户）
	AllowedGroups string `json:"allowed_groups" gorm:"type:varchar(255)"` // 空=不限制；否则逗号分隔的用户分组
	ApplyReason   string `json:"apply_reason" gorm:"type:text"`
	ReviewNote    string `json:"review_note" gorm:"type:varchar(255)"` // 驳回/禁用原因，回给申请人看
	ReviewedBy    int    `json:"reviewed_by"`
	ReviewedAt    int64  `json:"reviewed_at"`
	CreatedAt     int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt     int64  `json:"updated_at" gorm:"autoUpdateTime"`
	LastUsedAt    int64  `json:"last_used_at"`
}

func (OIDCClient) TableName() string { return "oidc_clients" }

// RedirectUriList 返回精确匹配用的回调地址列表（忽略空行与首尾空白）。
func (c *OIDCClient) RedirectUriList() []string {
	return splitOIDCLines(c.RedirectUris)
}

// ScopeList 返回该应用允许申请的 scope 列表。
func (c *OIDCClient) ScopeList() []string { return splitOIDCFields(c.Scopes) }

// AllowedGroupList 返回允许使用该应用的用户分组；空表示不限。
func (c *OIDCClient) AllowedGroupList() []string { return splitOIDCCommas(c.AllowedGroups) }

// MatchesRedirectUri 回调地址必须逐字节精确匹配（OAuth 安全要求，禁止前缀/通配）。
func (c *OIDCClient) MatchesRedirectUri(uri string) bool {
	for _, allowed := range c.RedirectUriList() {
		if allowed == uri {
			return true
		}
	}
	return false
}

func (c *OIDCClient) IsPublic() bool { return c.ClientType == OIDCClientTypePublic }

type OIDCAuthCode struct {
	Id                  int    `json:"id"`
	CodeHash            string `json:"-" gorm:"type:varchar(64);uniqueIndex"`
	ClientId            string `json:"client_id" gorm:"type:varchar(64);index"`
	UserId              int    `json:"user_id" gorm:"index"`
	SessionId           string `json:"session_id" gorm:"type:varchar(64)"`
	RedirectUri         string `json:"redirect_uri" gorm:"type:varchar(512)"`
	Scopes              string `json:"scopes" gorm:"type:varchar(255)"`
	Nonce               string `json:"nonce" gorm:"type:varchar(255)"`
	CodeChallenge       string `json:"code_challenge" gorm:"type:varchar(128)"`
	CodeChallengeMethod string `json:"code_challenge_method" gorm:"type:varchar(8)"`
	ExpiresAt           int64  `json:"expires_at" gorm:"index"`
	UsedAt              int64  `json:"used_at"`
	CreatedAt           int64  `json:"created_at" gorm:"autoCreateTime"`
}

func (OIDCAuthCode) TableName() string { return "oidc_auth_codes" }

// OIDCRefreshToken 刷新令牌。PreviousHash/PreviousValidUntil 用于重放检测：
// 旧令牌在宽限窗口内再次出现说明被复制，直接撤销整条链。
type OIDCRefreshToken struct {
	Id                 int    `json:"id"`
	TokenHash          string `json:"-" gorm:"type:varchar(64);uniqueIndex"`
	PreviousHash       string `json:"-" gorm:"type:varchar(64)"`
	PreviousValidUntil int64  `json:"-" gorm:"type:bigint"`
	ClientId           string `json:"client_id" gorm:"type:varchar(64);index"`
	UserId             int    `json:"user_id" gorm:"index"`
	SessionId          string `json:"session_id" gorm:"type:varchar(64)"`
	Scopes             string `json:"scopes" gorm:"type:varchar(255)"`
	ExpiresAt          int64  `json:"expires_at" gorm:"index"`
	RevokedAt          int64  `json:"revoked_at" gorm:"index"`
	CreatedAt          int64  `json:"created_at" gorm:"autoCreateTime"`
}

func (OIDCRefreshToken) TableName() string { return "oidc_refresh_tokens" }

// OIDCConsent 用户对某个应用的授权记录。Silent=true 表示用户允许"以后不再询问"。
type OIDCConsent struct {
	Id        int    `json:"id"`
	UserId    int    `json:"user_id" gorm:"uniqueIndex:idx_oidc_consents_user_client,priority:1"`
	ClientId  string `json:"client_id" gorm:"type:varchar(64);uniqueIndex:idx_oidc_consents_user_client,priority:2"`
	Scopes    string `json:"scopes" gorm:"type:varchar(255)"`
	Silent    bool   `json:"silent"`
	CreatedAt int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

func (OIDCConsent) TableName() string { return "oidc_consents" }

// ScopeList 返回已同意的 scope。
func (c *OIDCConsent) ScopeList() []string { return splitOIDCFields(c.Scopes) }

type OIDCSigningKey struct {
	Id  int    `json:"id"`
	Kid string `json:"kid" gorm:"type:varchar(64);uniqueIndex"`
	Alg string `json:"alg" gorm:"type:varchar(16)"`
	// PrivateKeyCipher 是 PEM 私钥经 AES-GCM 加密后的密文，公钥由私钥推导，不单独存。
	PrivateKeyCipher string `json:"-" gorm:"type:text"`
	Status           string `json:"status" gorm:"type:varchar(16);index"`
	CreatedAt        int64  `json:"created_at" gorm:"autoCreateTime"`
	RetiredAt        int64  `json:"retired_at"`
}

func (OIDCSigningKey) TableName() string { return "oidc_signing_keys" }

func splitOIDCLines(raw string) []string {
	var out []string
	for line := range strings.SplitSeq(raw, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func splitOIDCFields(raw string) []string { return splitOIDCLines(strings.ReplaceAll(raw, " ", "\n")) }

func splitOIDCCommas(raw string) []string { return splitOIDCLines(strings.ReplaceAll(raw, ",", "\n")) }
