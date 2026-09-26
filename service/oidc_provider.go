// @muw-owned
package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/golang-jwt/jwt/v5"
)

// OIDC Provider 业务逻辑：应用申请与审核、授权码签发与兑换、令牌签发与轮换、claims 组装。
//
// 安全基线（OWASP ASVS / OAuth 2.0 Security BCP）：
//   - 回调地址逐字节精确匹配，申请与审核阶段都做校验，禁止通配；
//   - 授权码一次性（条件 UPDATE 判定）、60s 过期、绑定 client/user/session/回调地址/PKCE；
//   - 强制 PKCE S256（public 应用必须带，confidential 应用带则校验、不带则拒绝降级）；
//   - access_token 只对 userinfo 有效且带会话版本（登出/改密即时失效），不能用于 relay；
//   - 刷新令牌轮换 + 重放检测（宽限期内重复提交视为抖动，窗口外视为泄露，撤销整条链）。
const (
	OIDCScopeOpenID        = "openid"
	OIDCScopeProfile       = "profile"
	OIDCScopeEmail         = "email"
	OIDCScopeGroup         = "group"
	OIDCScopeOfflineAccess = "offline_access"

	OIDCResponseTypeCode   = "code"
	OIDCPKCEMethodS256     = "S256"
	OIDCGrantAuthorization = "authorization_code"
	OIDCGrantRefresh       = "refresh_token"

	OIDCAuthCodeTTL         = 60 * time.Second
	OIDCAccessTokenTTL      = 15 * time.Minute
	OIDCRefreshTokenTTL     = 30 * 24 * time.Hour
	OIDCRefreshReplayWindow = 30 * time.Second

	oidcClientIdPrefix = "muw_"
	oidcAccessTokenUse = "oidc_access"
)

var (
	ErrOIDCInvalidRequest = errors.New("OIDC 请求参数不合法")
	ErrOIDCClientDisabled = errors.New("OIDC 应用不可用")
	ErrOIDCPKCERequired   = errors.New("该应用必须使用 PKCE（S256）")
	ErrOIDCReplayDetected = errors.New("刷新令牌被重复使用，已撤销该应用的授权")
	ErrOIDCRefreshRace    = errors.New("刷新令牌刚刚已被使用，请重试")

	errOIDCRefreshInvalid = errors.New("刷新令牌无效或已过期")
)

// OIDCSupportedScopes 是本站支持的 scope。openid 是 OIDC 的必需项，其余按需申请。
func OIDCSupportedScopes() []string {
	return []string{OIDCScopeOpenID, OIDCScopeProfile, OIDCScopeEmail, OIDCScopeGroup, OIDCScopeOfflineAccess}
}

// OIDCApplicationRequest 是第三方提交的申请（站内用户）。
type OIDCApplicationRequest struct {
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	RedirectUris []string `json:"redirect_uris"`
	Scopes       []string `json:"scopes"`
	ClientType   string   `json:"client_type"`
	Reason       string   `json:"apply_reason"`
}

// OIDCValidateApplicationRequest 校验申请内容（申请入口与审核入口都要过一遍）。
func OIDCValidateApplicationRequest(req *OIDCApplicationRequest) error {
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 128 {
		return errors.New("应用名称必填且不超过 128 字")
	}
	if len(req.RedirectUris) == 0 {
		return errors.New("至少填一个回调地址")
	}
	if len(req.RedirectUris) > 10 {
		return errors.New("回调地址最多 10 个")
	}
	for i, uri := range req.RedirectUris {
		req.RedirectUris[i] = strings.TrimSpace(uri)
		if err := oidcValidateRedirectUri(req.RedirectUris[i]); err != nil {
			return err
		}
	}
	switch req.ClientType {
	case model.OIDCClientTypePublic, model.OIDCClientTypeConfidential:
	default:
		return errors.New("应用类型只能是 public 或 confidential")
	}
	scopes, err := oidcNormalizeScopes(req.Scopes)
	if err != nil {
		return err
	}
	req.Scopes = scopes
	return nil
}

// oidcValidateRedirectUri 回调地址要求：绝对地址、无片段、无通配，https（本机回环允许 http）。
func oidcValidateRedirectUri(uri string) error {
	if uri == "" {
		return errors.New("回调地址不能为空")
	}
	if strings.Contains(uri, "*") {
		return errors.New("回调地址不支持通配符")
	}
	parsed, err := url.Parse(uri)
	if err != nil {
		return errors.New("回调地址格式不合法：" + uri)
	}
	if parsed.Host == "" || parsed.Scheme == "" {
		return errors.New("回调地址必须是绝对地址：" + uri)
	}
	if parsed.Fragment != "" {
		return errors.New("回调地址不能带 # 片段：" + uri)
	}
	if parsed.Scheme != "https" && !isLocalOrigin(parsed.Scheme+"://"+parsed.Host) {
		return errors.New("回调地址必须使用 https（本机部署可用 http://localhost 或 http://<私网IP>）：" + uri)
	}
	return nil
}

// oidcNormalizeScopes 去重、校验白名单、强制包含 openid。
func oidcNormalizeScopes(raw []string) ([]string, error) {
	supported := OIDCSupportedScopes()
	var out []string
	for _, scope := range raw {
		scope = strings.TrimSpace(scope)
		if scope == "" || slices.Contains(out, scope) {
			continue
		}
		if !slices.Contains(supported, scope) {
			return nil, errors.New("不支持的 scope：" + scope)
		}
		out = append(out, scope)
	}
	if !slices.Contains(out, OIDCScopeOpenID) {
		out = append([]string{OIDCScopeOpenID}, out...)
	}
	return out, nil
}

func oidcJoinScopes(scopes []string) string { return strings.Join(scopes, " ") }

// OIDCSubmitApplication 提交申请：落 pending，等管理员审核。此时客户端不可用
// （authorize/token 都会因状态非 approved 拒绝）。
func OIDCSubmitApplication(userId int, req OIDCApplicationRequest) (*model.OIDCClient, error) {
	if userId <= 0 {
		return nil, errors.New("请先登录")
	}
	if err := OIDCValidateApplicationRequest(&req); err != nil {
		return nil, err
	}
	suffix, err := oidcRandomToken(12)
	if err != nil {
		return nil, err
	}
	now := common.GetTimestamp()
	client := &model.OIDCClient{
		ClientId:     oidcClientIdPrefix + suffix,
		Name:         req.Name,
		Description:  req.Description,
		RedirectUris: strings.Join(req.RedirectUris, "\n"),
		Scopes:       oidcJoinScopes(req.Scopes),
		ClientType:   req.ClientType,
		Status:       model.OIDCClientStatusPending,
		OwnerUserId:  userId,
		ApplyReason:  req.Reason,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := model.CreateOIDCClient(client); err != nil {
		return nil, err
	}
	return client, nil
}

// OIDCApproveApplication 批准申请：可当场改 scope 与回调地址（回调地址改动等于换目标，
// 必须由审核者确认）。confidential 应用返回一次性明文密钥，库里只留哈希。
func OIDCApproveApplication(id, reviewerId int, scopes, redirectUris, allowedGroups []string) (*model.OIDCClient, error) {
	client, err := model.GetOIDCClientById(id)
	if err != nil {
		return nil, err
	}
	if client.Status == model.OIDCClientStatusApproved {
		return nil, errors.New("该应用已通过审核")
	}
	req := OIDCApplicationRequest{
		Name:         client.Name,
		Description:  client.Description,
		RedirectUris: redirectUris,
		Scopes:       scopes,
		ClientType:   client.ClientType,
	}
	if err := OIDCValidateApplicationRequest(&req); err != nil {
		return nil, err
	}
	fields := map[string]any{
		"name":           req.Name,
		"description":    req.Description,
		"redirect_uris":  strings.Join(req.RedirectUris, "\n"),
		"scopes":         oidcJoinScopes(req.Scopes),
		"allowed_groups": strings.Join(allowedGroups, ","),
		"status":         model.OIDCClientStatusApproved,
		"reviewed_by":    reviewerId,
		"reviewed_at":    common.GetTimestamp(),
		"review_note":    "",
		"updated_at":     common.GetTimestamp(),
	}
	if client.ClientType == model.OIDCClientTypeConfidential {
		hash, cipher, err := oidcGenerateClientSecret()
		if err != nil {
			return nil, err
		}
		fields["secret_hash"] = hash
		fields["secret_cipher"] = cipher
	}
	if err := model.UpdateOIDCClientFields(id, fields); err != nil {
		return nil, err
	}
	return model.GetOIDCClientById(id)
}

// oidcGenerateClientSecret 生成客户端密钥：一份哈希用于校验、一份 AES-GCM 密文用于
// 申请人自己查看。管理员只能看到元数据，看不到密钥。
func oidcGenerateClientSecret() (hash string, cipher string, err error) {
	plain, err := oidcRandomToken(32)
	if err != nil {
		return "", "", err
	}
	hash, err = common.Password2Hash(plain)
	if err != nil {
		return "", "", err
	}
	cipher, err = common.AESGCMEncrypt(plain)
	if err != nil {
		return "", "", err
	}
	return hash, cipher, nil
}

// OIDCRevealClientSecret 申请人查看自己应用的密钥（只允许 owner；控制器侧记审计）。
func OIDCRevealClientSecret(id, ownerUserId int) (string, error) {
	client, err := model.GetOIDCClientById(id)
	if err != nil {
		return "", err
	}
	if client.OwnerUserId != ownerUserId {
		return "", errors.New("只能查看自己申请的密钥")
	}
	if client.IsPublic() {
		return "", errors.New("公开客户端没有密钥（使用 PKCE）")
	}
	if client.SecretCipher == "" {
		return "", errors.New("该应用还没有密钥，请先重置")
	}
	return common.AESGCMDecrypt(client.SecretCipher)
}

// OIDCRotateClientSecret 申请人重置自己应用的密钥（旧密钥立即失效；已签发的令牌不受影响）。
func OIDCRotateClientSecret(id, ownerUserId int) (string, error) {
	client, err := model.GetOIDCClientById(id)
	if err != nil {
		return "", err
	}
	if client.OwnerUserId != ownerUserId {
		return "", errors.New("只能重置自己申请的密钥")
	}
	if client.IsPublic() {
		return "", errors.New("公开客户端没有密钥（使用 PKCE）")
	}
	hash, cipher, err := oidcGenerateClientSecret()
	if err != nil {
		return "", err
	}
	if err := model.UpdateOIDCClientFields(id, map[string]any{"secret_hash": hash, "secret_cipher": cipher, "updated_at": common.GetTimestamp()}); err != nil {
		return "", err
	}
	return common.AESGCMDecrypt(cipher)
}

func OIDCRejectApplication(id, reviewerId int, note string) error {
	return oidcReviewStatus(id, reviewerId, model.OIDCClientStatusRejected, note)
}

// OIDCUpdateClientStatus 供管理员启用/禁用已批准的应用；禁用的同时撤销其全部刷新令牌。
func OIDCUpdateClientStatus(id, reviewerId int, status, note string) error {
	if status != model.OIDCClientStatusApproved && status != model.OIDCClientStatusDisabled {
		return errors.New("状态只能是 approved 或 disabled")
	}
	if err := oidcReviewStatus(id, reviewerId, status, note); err != nil {
		return err
	}
	if status == model.OIDCClientStatusDisabled {
		client, err := model.GetOIDCClientById(id)
		if err != nil {
			return err
		}
		return model.RevokeOIDCRefreshTokensByUserClient(0, client.ClientId, common.GetTimestamp())
	}
	return nil
}

func oidcReviewStatus(id, reviewerId int, status, note string) error {
	if _, err := model.GetOIDCClientById(id); err != nil {
		return err
	}
	return model.UpdateOIDCClientFields(id, map[string]any{
		"status":      status,
		"review_note": note,
		"reviewed_by": reviewerId,
		"reviewed_at": common.GetTimestamp(),
		"updated_at":  common.GetTimestamp(),
	})
}

// OIDCDeleteApplication 删除应用并清理其授权与令牌（回调地址与密钥随之作废）。
func OIDCDeleteApplication(id int) error {
	client, err := model.GetOIDCClientById(id)
	if err != nil {
		return err
	}
	now := common.GetTimestamp()
	if err := model.RevokeOIDCRefreshTokensByUserClient(0, client.ClientId, now); err != nil {
		return err
	}
	if err := model.DeleteOIDCConsentsByClient(client.ClientId); err != nil {
		return err
	}
	return model.DeleteOIDCClientById(id)
}

func OIDCVerifyClientSecret(client *model.OIDCClient, secret string) bool {
	if client.IsPublic() {
		return true
	}
	if client.SecretHash == "" || secret == "" {
		return false
	}
	return common.ValidatePasswordAndHash(secret, client.SecretHash)
}

// OIDCClientAllowsUser 应用可选限制用户分组；空列表表示不限。
func OIDCClientAllowsUser(client *model.OIDCClient, user *model.UserBase) bool {
	allowed := client.AllowedGroupList()
	return len(allowed) == 0 || slices.Contains(allowed, user.Group)
}

// OIDCSelectScopes 只允许申请该应用被批准范围内的 scope，并始终补上 openid。
func OIDCSelectScopes(client *model.OIDCClient, requested []string) ([]string, error) {
	allowed := client.ScopeList()
	var out []string
	for _, scope := range requested {
		scope = strings.TrimSpace(scope)
		if scope == "" || slices.Contains(out, scope) {
			continue
		}
		if !slices.Contains(allowed, scope) {
			return nil, errors.New("该应用未获准使用 scope：" + scope)
		}
		out = append(out, scope)
	}
	if !slices.Contains(out, OIDCScopeOpenID) {
		out = append([]string{OIDCScopeOpenID}, out...)
	}
	return out, nil
}

// OIDCGetApprovedClient 取"已批准且可用"的应用；pending/驳回/禁用一律拒绝。
func OIDCGetApprovedClient(clientId string) (*model.OIDCClient, error) {
	client, err := model.GetOIDCClientByClientId(clientId)
	if err != nil {
		return nil, err
	}
	if client.Status != model.OIDCClientStatusApproved {
		return nil, ErrOIDCClientDisabled
	}
	return client, nil
}

// ---- 授权码流程 ----

type OIDCAuthorizeRequest struct {
	ClientId            string
	RedirectUri         string
	ResponseType        string
	Scopes              []string
	State               string
	Nonce               string
	CodeChallenge       string
	CodeChallengeMethod string
	Prompt              string
}

// OIDCValidateAuthorize 校验授权请求（除用户同意之外的全部前置条件）。
// 失败时仍把已解析出的 client 一并返回：调用方据此判断"回调地址是否可信"，
// 可信就把错误按规范重定向回应用，不可信才直接报错（防开放重定向）。
func OIDCValidateAuthorize(req OIDCAuthorizeRequest) (*model.OIDCClient, []string, error) {
	client, err := OIDCGetApprovedClient(req.ClientId)
	if err != nil {
		return nil, nil, err
	}
	if !client.MatchesRedirectUri(req.RedirectUri) {
		return client, nil, errors.New("回调地址不匹配")
	}
	if req.ResponseType != OIDCResponseTypeCode {
		return client, nil, errors.New("只支持 response_type=code")
	}
	if req.CodeChallenge == "" {
		return client, nil, ErrOIDCPKCERequired
	}
	if req.CodeChallengeMethod != OIDCPKCEMethodS256 {
		return client, nil, errors.New("PKCE 只支持 S256")
	}
	scopes, err := OIDCSelectScopes(client, req.Scopes)
	if err != nil {
		return client, nil, err
	}
	return client, scopes, nil
}

// OIDCNeedsConsent 是否需要弹同意页：没有授权记录、用户没开静默、或本次申请的
// scope 超出了已同意范围（新增 scope 必须重新征得同意，不能靠静默放行）。
func OIDCNeedsConsent(userId int, clientId string, scopes []string) (bool, error) {
	consent, err := model.GetOIDCConsent(userId, clientId)
	if err != nil {
		return false, err
	}
	if consent == nil {
		return true, nil
	}
	for _, scope := range scopes {
		if !slices.Contains(consent.ScopeList(), scope) {
			return true, nil
		}
	}
	return !consent.Silent, nil
}

// OIDCIssueAuthCode 签发授权码：只存哈希，绑定 client/user/session/回调地址/PKCE。
func OIDCIssueAuthCode(client *model.OIDCClient, userId int, sessionId, redirectUri string, scopes []string, nonce string, req OIDCAuthorizeRequest) (string, error) {
	code, err := oidcRandomToken(32)
	if err != nil {
		return "", err
	}
	now := common.GetTimestamp()
	record := &model.OIDCAuthCode{
		CodeHash:            hashOIDCToken(code),
		ClientId:            client.ClientId,
		UserId:              userId,
		SessionId:           sessionId,
		RedirectUri:         redirectUri,
		Scopes:              oidcJoinScopes(scopes),
		Nonce:               nonce,
		CodeChallenge:       req.CodeChallenge,
		CodeChallengeMethod: req.CodeChallengeMethod,
		ExpiresAt:           now + int64(OIDCAuthCodeTTL.Seconds()),
		CreatedAt:           now,
	}
	if err := model.CreateOIDCAuthCode(record); err != nil {
		return "", err
	}
	return code, nil
}

// OIDCRedeemAuthCode 兑换授权码：一次性、校验全部绑定关系与 PKCE。
func OIDCRedeemAuthCode(code, clientId, redirectUri, verifier string) (*model.OIDCAuthCode, error) {
	record, err := model.ConsumeOIDCAuthCode(hashOIDCToken(code), common.GetTimestamp())
	if err != nil {
		return nil, err
	}
	if record.ClientId != clientId || record.RedirectUri != redirectUri {
		return nil, errors.New("授权码与本次请求不匹配")
	}
	if !oidcVerifyPKCE(verifier, record.CodeChallenge) {
		return nil, errors.New("PKCE 校验失败")
	}
	return record, nil
}

func oidcVerifyPKCE(verifier, challenge string) bool {
	if verifier == "" || challenge == "" {
		return false
	}
	sum := sha256.Sum256([]byte(verifier))
	computed := base64.RawURLEncoding.EncodeToString(sum[:])
	return hmac.Equal([]byte(computed), []byte(challenge))
}

// ---- 令牌 ----

type oidcAccessClaims struct {
	TokenUse        string   `json:"token_use"`
	ClientId        string   `json:"client_id"`
	Scopes          []string `json:"scopes,omitempty"`
	SessionID       string   `json:"sid"`
	UserAuthVersion int64    `json:"uv"`
	SessionVersion  int64    `json:"sv"`
	jwt.RegisteredClaims
}

// OIDCTokenResult 是 token 端点的响应载荷。
type OIDCTokenResult struct {
	AccessToken  string   `json:"access_token"`
	TokenType    string   `json:"token_type"`
	ExpiresIn    int64    `json:"expires_in"`
	RefreshToken string   `json:"refresh_token,omitempty"`
	IdToken      string   `json:"id_token,omitempty"`
	Scopes       []string `json:"-"`
	// UserId 仅供调用方记审计/明细用，不进响应体。
	UserId int `json:"-"`
}

// OIDCIssueTokens 按授权码流程签发：access_token（我方自验，只对 userinfo 有效）、
// id_token（RS256 供第三方验签）、refresh_token（仅当申请了 offline_access）。
func OIDCIssueTokens(client *model.OIDCClient, code *model.OIDCAuthCode, identity AuthIdentity) (*OIDCTokenResult, error) {
	user, err := model.GetUserById(code.UserId, false)
	if err != nil {
		return nil, err
	}
	return oidcIssueTokenResult(client, code.SessionId, identity, strings.Fields(code.Scopes), code.Nonce, user)
}

func oidcIssueTokenResult(client *model.OIDCClient, sessionId string, identity AuthIdentity, scopes []string, nonce string, user *model.User) (*OIDCTokenResult, error) {
	now := time.Now()
	issuer, err := OIDCIssuer()
	if err != nil {
		return nil, err
	}
	expiresAt := now.Add(OIDCAccessTokenTTL)
	accessClaims := oidcAccessClaims{
		TokenUse:        oidcAccessTokenUse,
		ClientId:        client.ClientId,
		Scopes:          scopes,
		SessionID:       sessionId,
		UserAuthVersion: identity.UserAuthVersion,
		SessionVersion:  identity.SessionVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   strconv.Itoa(identity.UserID),
			Audience:  jwt.ClaimStrings{client.ClientId},
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now.Add(-5 * time.Second)),
		},
	}
	accessToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims).SignedString(authSigningKey(oidcAccessTokenUse))
	if err != nil {
		return nil, err
	}
	result := &OIDCTokenResult{
		UserId:      identity.UserID,
		AccessToken: accessToken,
		TokenType:   "Bearer",
		ExpiresIn:   int64(OIDCAccessTokenTTL.Seconds()),
		Scopes:      scopes,
	}
	idToken, err := oidcBuildIDToken(issuer, client.ClientId, identity.UserID, nonce, scopes, user)
	if err != nil {
		return nil, err
	}
	result.IdToken = idToken
	if slices.Contains(scopes, OIDCScopeOfflineAccess) {
		refreshToken, err := oidcIssueRefreshToken(client.ClientId, sessionId, identity.UserID, scopes)
		if err != nil {
			return nil, err
		}
		result.RefreshToken = refreshToken
	}
	if err := model.TouchOIDCClientLastUsed(client.ClientId); err != nil {
		common.SysLog("oidc: touch last_used failed: " + err.Error())
	}
	if err := model.RecordOIDCTokenIssued(client.ClientId, identity.UserID, common.GetTimestamp()); err != nil {
		common.SysLog("oidc: record token usage failed: " + err.Error())
	}
	return result, nil
}

func oidcBuildIDToken(issuer, clientId string, userId int, nonce string, scopes []string, user *model.User) (string, error) {
	claims := oidcIDTokenClaims{
		Nonce:    nonce,
		AuthTime: common.GetTimestamp(),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   strconv.Itoa(userId),
			Audience:  jwt.ClaimStrings{clientId},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(OIDCIDTokenTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	oidcFillProfileClaims(&claims, user, scopes)
	return oidcSignIDToken(claims)
}

// oidcFillProfileClaims 按 scope 填身份字段：少给是默认，多给必须用户申请且应用获准。
func oidcFillProfileClaims(claims *oidcIDTokenClaims, user *model.User, scopes []string) {
	if slices.Contains(scopes, OIDCScopeProfile) {
		claims.PreferredUsername = user.Username
		claims.Name = user.DisplayName
		if claims.Name == "" {
			claims.Name = user.Username
		}
		claims.Picture = user.Avatar
	}
	if slices.Contains(scopes, OIDCScopeEmail) {
		claims.Email = user.Email
		verified := user.Email != ""
		claims.EmailVerified = &verified
	}
	if slices.Contains(scopes, OIDCScopeGroup) {
		claims.Group = user.Group
	}
}

func oidcIssueRefreshToken(clientId, sessionId string, userId int, scopes []string) (string, error) {
	token, err := oidcRandomToken(32)
	if err != nil {
		return "", err
	}
	now := common.GetTimestamp()
	record := &model.OIDCRefreshToken{
		TokenHash: hashOIDCToken(token),
		ClientId:  clientId,
		UserId:    userId,
		SessionId: sessionId,
		Scopes:    oidcJoinScopes(scopes),
		ExpiresAt: now + int64(OIDCRefreshTokenTTL.Seconds()),
		CreatedAt: now,
	}
	if err := model.CreateOIDCRefreshToken(record); err != nil {
		return "", err
	}
	return token, nil
}

// OIDCRefreshTokens 刷新：轮换 + 重放检测（语义与仓库既有的会话刷新一致——宽限期内
// 重复提交视为抖动，窗口外视为令牌泄露，撤销整条链）。
func OIDCRefreshTokens(client *model.OIDCClient, refreshToken string) (*OIDCTokenResult, error) {
	presented := hashOIDCToken(refreshToken)
	record, err := model.GetOIDCRefreshTokenByHash(presented)
	if err != nil {
		return nil, err
	}
	now := common.GetTimestamp()
	if record == nil {
		previous, err := model.GetOIDCRefreshTokenByPreviousHash(presented)
		if err != nil {
			return nil, err
		}
		if previous == nil {
			return nil, errOIDCRefreshInvalid
		}
		if now <= previous.PreviousValidUntil {
			return nil, ErrOIDCRefreshRace
		}
		if err := model.RevokeOIDCRefreshTokenById(previous.Id, now); err != nil {
			return nil, err
		}
		return nil, ErrOIDCReplayDetected
	}
	if record.ClientId != client.ClientId || record.RevokedAt != 0 || record.ExpiresAt <= now {
		return nil, errOIDCRefreshInvalid
	}
	identity, err := ValidateSessionReference(record.UserId, record.SessionId)
	if err != nil {
		return nil, errors.New("登录会话已失效，请重新授权")
	}
	scopes := strings.Fields(record.Scopes)
	nextToken, err := oidcRandomToken(32)
	if err != nil {
		return nil, err
	}
	if err := model.RotateOIDCRefreshToken(record.Id, hashOIDCToken(nextToken), presented,
		now+int64(OIDCRefreshReplayWindow.Seconds()), now+int64(OIDCRefreshTokenTTL.Seconds())); err != nil {
		return nil, err
	}
	user, err := model.GetUserById(record.UserId, false)
	if err != nil {
		return nil, err
	}
	result, err := oidcIssueTokenResult(client, record.SessionId, identity, scopes, "", user)
	if err != nil {
		return nil, err
	}
	result.RefreshToken = nextToken
	return result, nil
}

// OIDCRevokeRefreshToken 撤销（RFC 7009 语义：无效令牌也返回成功，避免探测）。
func OIDCRevokeRefreshToken(clientId, refreshToken string) error {
	if strings.TrimSpace(refreshToken) == "" {
		return nil
	}
	record, err := model.GetOIDCRefreshTokenByHash(hashOIDCToken(refreshToken))
	if err != nil {
		return err
	}
	if record == nil || record.ClientId != clientId {
		return nil
	}
	return model.RevokeOIDCRefreshTokenById(record.Id, common.GetTimestamp())
}

// OIDCParseAccessToken 解析并校验 access_token（只认 OIDC 用途，不与站点令牌互换）。
func OIDCParseAccessToken(raw string) (*oidcAccessClaims, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, ErrAuthTokenInvalid
	}
	issuer, err := OIDCIssuer()
	if err != nil {
		return nil, err
	}
	claims := &oidcAccessClaims{}
	parsed, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		if token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, errors.New("unexpected signing method")
		}
		return authSigningKey(oidcAccessTokenUse), nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithIssuer(issuer), jwt.WithExpirationRequired(), jwt.WithIssuedAt(), jwt.WithLeeway(5*time.Second))
	if err != nil {
		return nil, ErrAuthTokenInvalid
	}
	if !parsed.Valid || claims.TokenUse != oidcAccessTokenUse || claims.ClientId == "" || claims.SessionID == "" {
		return nil, ErrAuthTokenInvalid
	}
	if len(claims.Audience) != 1 || claims.Audience[0] != claims.ClientId {
		return nil, ErrAuthTokenInvalid
	}
	return claims, nil
}

// OIDCUserInfo 组装 userinfo 响应：先确认应用仍可用、会话仍有效、用户仍在允许的分组里，
// 再按 token 里的 scope 裁剪字段。权限收回（禁用应用/登出/改密/调分组）都会立刻生效。
func OIDCUserInfo(accessToken string) (map[string]any, error) {
	claims, err := OIDCParseAccessToken(accessToken)
	if err != nil {
		return nil, err
	}
	client, err := OIDCGetApprovedClient(claims.ClientId)
	if err != nil {
		return nil, err
	}
	identity := AuthIdentity{
		UserID:          atoiOrZero(claims.Subject),
		SessionID:       claims.SessionID,
		UserAuthVersion: claims.UserAuthVersion,
		SessionVersion:  claims.SessionVersion,
	}
	if identity.UserID <= 0 {
		return nil, ErrAuthTokenInvalid
	}
	_, userBase, err := ValidateLoginSession(identity)
	if err != nil {
		return nil, errors.New("登录会话已失效")
	}
	if !OIDCClientAllowsUser(client, userBase) {
		return nil, errors.New("当前账号不在该应用允许的范围内")
	}
	// 授权记录被撤销（用户在"我的授权"里解除）后，已签发的 access_token 也必须立刻失效。
	consent, err := model.GetOIDCConsent(identity.UserID, client.ClientId)
	if err != nil {
		return nil, err
	}
	if consent == nil {
		return nil, errors.New("该应用的授权已被撤销")
	}
	user, err := model.GetUserById(identity.UserID, false)
	if err != nil {
		return nil, err
	}
	out := map[string]any{"sub": strconv.Itoa(identity.UserID)}
	idClaims := oidcIDTokenClaims{}
	oidcFillProfileClaims(&idClaims, user, claims.Scopes)
	if idClaims.PreferredUsername != "" {
		out["preferred_username"] = idClaims.PreferredUsername
	}
	if idClaims.Name != "" {
		out["name"] = idClaims.Name
	}
	if idClaims.Picture != "" {
		out["picture"] = idClaims.Picture
	}
	if idClaims.Email != "" {
		out["email"] = idClaims.Email
		out["email_verified"] = true
	}
	if idClaims.Group != "" {
		out["group"] = idClaims.Group
	}
	return out, nil
}

func atoiOrZero(raw string) int {
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0
	}
	return value
}

// ---- 授权请求凭据（授权端点 → 前端同意页 → 决策接口）----

const (
	oidcAuthorizeRequestUse = "oidc_authorize_request"
	OIDCAuthorizeRequestTTL = 10 * time.Minute
)

// oidcAuthorizeRequestClaims 携带一份"已通过校验的授权请求"。授权端点把浏览器送到
// 前端同意页，同意页再带着它回来：参数由服务端签名，用户改不动 state/nonce/scope，
// 也就不需要为一次性的授权请求建表。
type oidcAuthorizeRequestClaims struct {
	TokenUse            string   `json:"token_use"`
	ClientId            string   `json:"client_id"`
	RedirectUri         string   `json:"redirect_uri"`
	Scopes              []string `json:"scopes"`
	State               string   `json:"state,omitempty"`
	Nonce               string   `json:"nonce,omitempty"`
	CodeChallenge       string   `json:"code_challenge"`
	CodeChallengeMethod string   `json:"code_challenge_method"`
	jwt.RegisteredClaims
}

func OIDCIssueAuthorizeRequestToken(client *model.OIDCClient, req OIDCAuthorizeRequest, scopes []string) (string, error) {
	issuer, err := OIDCIssuer()
	if err != nil {
		return "", err
	}
	now := time.Now()
	claims := oidcAuthorizeRequestClaims{
		TokenUse:            oidcAuthorizeRequestUse,
		ClientId:            client.ClientId,
		RedirectUri:         req.RedirectUri,
		Scopes:              scopes,
		State:               req.State,
		Nonce:               req.Nonce,
		CodeChallenge:       req.CodeChallenge,
		CodeChallengeMethod: req.CodeChallengeMethod,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Audience:  jwt.ClaimStrings{issuer},
			ExpiresAt: jwt.NewNumericDate(now.Add(OIDCAuthorizeRequestTTL)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now.Add(-5 * time.Second)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(authSigningKey(oidcAuthorizeRequestUse))
}

// OIDCParseAuthorizeRequestToken 校验并还原授权请求；签名不符、过期、用途不符一律拒绝。
func OIDCParseAuthorizeRequestToken(raw string) (*oidcAuthorizeRequestClaims, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, ErrOIDCInvalidRequest
	}
	issuer, err := OIDCIssuer()
	if err != nil {
		return nil, err
	}
	claims := &oidcAuthorizeRequestClaims{}
	parsed, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		if token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, errors.New("unexpected signing method")
		}
		return authSigningKey(oidcAuthorizeRequestUse), nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithIssuer(issuer), jwt.WithAudience(issuer), jwt.WithExpirationRequired())
	if err != nil {
		return nil, ErrOIDCInvalidRequest
	}
	if !parsed.Valid || claims.TokenUse != oidcAuthorizeRequestUse || claims.ClientId == "" || claims.CodeChallenge == "" {
		return nil, ErrOIDCInvalidRequest
	}
	return claims, nil
}

// hashOIDCToken 用站点密钥派生 HMAC：令牌只存哈希，库被读走也无法还原可用令牌。
func hashOIDCToken(raw string) string { return common.GenerateHMAC(raw) }

// OIDCApplicationProfile 是应用资料里允许申请人自行修改的部分。
type OIDCApplicationProfile struct {
	Name         string
	Description  string
	HomepageUrl  string
	IconUrl      string
	RedirectUris []string
}

// OIDCUpdateApplicationProfile 申请人改自己的应用资料。回调地址属于安全边界：
// 申请人一改就退回 pending 重新审核；管理员改则直接生效（控制器传 asAdmin）。
func OIDCUpdateApplicationProfile(id, actorUserId int, profile OIDCApplicationProfile, asAdmin bool) (*model.OIDCClient, error) {
	client, err := model.GetOIDCClientById(id)
	if err != nil {
		return nil, err
	}
	if !asAdmin && client.OwnerUserId != actorUserId {
		return nil, errors.New("只能修改自己申请的应用")
	}
	req := OIDCApplicationRequest{
		Name:         profile.Name,
		Description:  profile.Description,
		RedirectUris: profile.RedirectUris,
		Scopes:       client.ScopeList(),
		ClientType:   client.ClientType,
	}
	if err := OIDCValidateApplicationRequest(&req); err != nil {
		return nil, err
	}
	fields := map[string]any{
		"name":          req.Name,
		"description":   req.Description,
		"homepage_url":  strings.TrimSpace(profile.HomepageUrl),
		"icon_url":      strings.TrimSpace(profile.IconUrl),
		"redirect_uris": strings.Join(req.RedirectUris, "\n"),
		"updated_at":    common.GetTimestamp(),
	}
	if !asAdmin && strings.Join(req.RedirectUris, "\n") != client.RedirectUris &&
		client.Status == model.OIDCClientStatusApproved {
		// 回调地址变了 ⇒ 回到待审核，改动不能绕过管理员。
		fields["status"] = model.OIDCClientStatusPending
	}
	if err := model.UpdateOIDCClientFields(id, fields); err != nil {
		return nil, err
	}
	return model.GetOIDCClientById(id)
}

// OIDCDeleteOwnApplication 申请人删除自己的应用（连带授权与令牌）。
func OIDCDeleteOwnApplication(id, actorUserId int, asAdmin bool) error {
	client, err := model.GetOIDCClientById(id)
	if err != nil {
		return err
	}
	if !asAdmin && client.OwnerUserId != actorUserId {
		return errors.New("只能删除自己申请的应用")
	}
	return OIDCDeleteApplication(id)
}

// OIDCUsageSummaryFor scope=self 只看自己；scope=all 需要管理员（控制器已校验角色）。
func OIDCUsageSummaryFor(scope string, userId int) (*model.OIDCUsageSummary, error) {
	if scope == "all" {
		return model.OIDCUsageAll()
	}
	return model.OIDCUsageForUser(userId)
}
