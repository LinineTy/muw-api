// @muw-owned
package service

import (
	"crypto/sha256"
	"encoding/base64"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// setupOIDCTest 建一份最小 SQLite 库并固定 issuer/密钥，供 OIDC 用例复用。
func setupOIDCTest(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB, previousSecret := model.DB, common.SessionSecret
	previousIssuer := system_setting.ServerAddress
	previousRedis, previousCache := common.RedisEnabled, common.MemoryCacheEnabled

	dsn := os.Getenv("TEST_SQLITE_DSN")
	if dsn == "" {
		// 每个用例一个独立内存库：共享 DSN 会让前一个用例的数据（例如使用计数）串进来。
		slot := strings.NewReplacer("/", "_", " ", "_").Replace(t.Name())
		dsn = "file:oidc_provider_" + slot + "?mode=memory&cache=shared"
	}
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.OIDCClient{},
		&model.OIDCAuthCode{}, &model.OIDCRefreshToken{}, &model.OIDCConsent{}, &model.OIDCSigningKey{}, &model.OIDCUsageStat{}))

	model.DB = db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.SessionSecret = "oidc-provider-test-secret"
	common.RedisEnabled = false
	common.MemoryCacheEnabled = false
	system_setting.ServerAddress = "https://idp.example.com"
	oidcSigningMu.Lock()
	oidcKeyCache = nil
	oidcSigningMu.Unlock()

	t.Cleanup(func() {
		model.DB = previousDB
		common.SessionSecret = previousSecret
		system_setting.ServerAddress = previousIssuer
		common.RedisEnabled = previousRedis
		common.MemoryCacheEnabled = previousCache
		oidcSigningMu.Lock()
		oidcKeyCache = nil
		oidcSigningMu.Unlock()
	})
	return db
}

func createOIDCTestUser(t *testing.T, username, group string) *model.User {
	t.Helper()
	user := &model.User{
		Username:    username,
		Password:    "hashed-password",
		DisplayName: "昵称" + username,
		Email:       username + "@example.com",
		Avatar:      "https://cdn.example.com/" + username + ".png",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       group,
		AffCode:     "aff" + username,
		AuthVersion: 1,
	}
	require.NoError(t, model.DB.Create(user).Error)
	return user
}

func createOIDCTestSession(t *testing.T, userId int) *model.UserSession {
	t.Helper()
	now := time.Now().Unix()
	session := &model.UserSession{
		SID:             "sess-" + time.Now().Format("150405.000000"),
		UserID:          userId,
		Version:         1,
		UserAuthVersion: 1,
		Status:          model.UserSessionStatusActive,
		RefreshHash:     "hash",
		LoginMethod:     "password",
		CreatedAt:       now,
		LastActiveAt:    now,
		ExpiresAt:       now + 3600,
	}
	require.NoError(t, model.DB.Create(session).Error)
	return session
}

func TestOIDCValidateRedirectUriRules(t *testing.T) {
	cases := []struct {
		uri     string
		wantErr bool
	}{
		{"https://app.example.com/callback", false},
		{"https://app.example.com:8443/cb", false},
		{"http://localhost:5173/cb", false},
		{"http://127.0.0.1:3000/cb", false},
		{"http://192.168.1.50:3100/cb", false}, // 本地部署
		{"http://10.0.0.7/cb", false},
		{"http://app.example.com/cb", true},
		{"https://app.example.com/cb*", true},
		{"https://app.example.com/cb#frag", true},
		{"/cb", true},
		{"", true},
	}
	for _, test := range cases {
		err := oidcValidateRedirectUri(test.uri)
		if test.wantErr {
			assert.Error(t, err, "应拒绝：%s", test.uri)
			continue
		}
		assert.NoError(t, err, "应接受：%s", test.uri)
	}
}

func TestOIDCNormalizeScopesForcesOpenidAndRejectsUnknown(t *testing.T) {
	scopes, err := oidcNormalizeScopes([]string{OIDCScopeProfile, OIDCScopeProfile, OIDCScopeEmail})
	require.NoError(t, err)
	assert.Equal(t, []string{OIDCScopeOpenID, OIDCScopeProfile, OIDCScopeEmail}, scopes)

	_, err = oidcNormalizeScopes([]string{"openid", "admin"})
	assert.Error(t, err, "未支持的 scope 必须拒绝")
}

func TestOIDCSelectScopesBlocksEscalation(t *testing.T) {
	client := &model.OIDCClient{Scopes: "openid profile", ClientType: model.OIDCClientTypePublic}
	scopes, err := OIDCSelectScopes(client, []string{"profile"})
	require.NoError(t, err)
	assert.Equal(t, []string{OIDCScopeOpenID, OIDCScopeProfile}, scopes)

	_, err = OIDCSelectScopes(client, []string{"email"})
	assert.Error(t, err, "申请超出批准范围的 scope 必须拒绝")
}

func TestOIDCVerifyPKCE(t *testing.T) {
	verifier := "0123456789abcdefghijklmnopqrstuvwxyzABCDEFG"
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])

	assert.True(t, oidcVerifyPKCE(verifier, challenge))
	assert.False(t, oidcVerifyPKCE(verifier+"x", challenge))
	assert.False(t, oidcVerifyPKCE("", challenge))
	assert.False(t, oidcVerifyPKCE(verifier, ""))
}

func TestOIDCIssuerRequiresHttps(t *testing.T) {
	previous := system_setting.ServerAddress
	t.Cleanup(func() { system_setting.ServerAddress = previous })

	system_setting.ServerAddress = "https://idp.example.com/"
	issuer, err := OIDCIssuer()
	require.NoError(t, err)
	assert.Equal(t, "https://idp.example.com", issuer)

	for _, value := range []string{"", "http://idp.example.com"} {
		system_setting.ServerAddress = value
		_, err := OIDCIssuer()
		assert.ErrorIs(t, err, ErrOIDCIssuerInvalid, "非 https 或空值必须报错：%q", value)
	}

	system_setting.ServerAddress = "http://localhost:3000"
	_, err = OIDCIssuer()
	assert.NoError(t, err, "本机调试允许 http")
}

func TestOIDCAuthorizeRequestTokenRoundTripAndTamper(t *testing.T) {
	setupOIDCTest(t)
	client := &model.OIDCClient{ClientId: "muw_test_client", Status: model.OIDCClientStatusApproved}
	req := OIDCAuthorizeRequest{
		ClientId:            client.ClientId,
		RedirectUri:         "https://app.example.com/cb",
		ResponseType:        OIDCResponseTypeCode,
		Scopes:              []string{OIDCScopeOpenID, OIDCScopeProfile},
		State:               "state-123",
		Nonce:               "nonce-456",
		CodeChallenge:       "challenge-abc",
		CodeChallengeMethod: OIDCPKCEMethodS256,
	}
	token, err := OIDCIssueAuthorizeRequestToken(client, req, req.Scopes)
	require.NoError(t, err)

	claims, err := OIDCParseAuthorizeRequestToken(token)
	require.NoError(t, err)
	assert.Equal(t, client.ClientId, claims.ClientId)
	assert.Equal(t, req.RedirectUri, claims.RedirectUri)
	assert.Equal(t, "state-123", claims.State)
	assert.Equal(t, "nonce-456", claims.Nonce)
	assert.Equal(t, req.Scopes, claims.Scopes)

	// 篡改载荷后签名失效，必须拒绝——否则用户能自己改 scope 或回调地址。
	tampered := token[:len(token)-3] + "aaa"
	_, err = OIDCParseAuthorizeRequestToken(tampered)
	assert.Error(t, err)
	_, err = OIDCParseAuthorizeRequestToken("")
	assert.Error(t, err)
}

func TestOIDCAuthCodeIsSingleUseAndBindsPKCE(t *testing.T) {
	setupOIDCTest(t)
	user := createOIDCTestUser(t, "oidcuser", "default")
	session := createOIDCTestSession(t, user.Id)
	client := &model.OIDCClient{ClientId: "muw_code_client", Scopes: "openid profile", Status: model.OIDCClientStatusApproved,
		ClientType: model.OIDCClientTypePublic, RedirectUris: "https://app.example.com/cb"}
	require.NoError(t, model.DB.Create(client).Error)

	verifier := "verifier-0123456789abcdefghijklmnopqrst"
	sum := sha256.Sum256([]byte(verifier))
	code, err := OIDCIssueAuthCode(client, user.Id, session.SID, "https://app.example.com/cb",
		[]string{OIDCScopeOpenID}, "nonce-1", OIDCAuthorizeRequest{
			CodeChallenge:       base64.RawURLEncoding.EncodeToString(sum[:]),
			CodeChallengeMethod: OIDCPKCEMethodS256,
		})
	require.NoError(t, err)

	// 任何一次兑换尝试都会消费掉授权码（OAuth 安全建议：失败的兑换也要让码作废，
	// 避免有人拿同一个码反复试 PKCE/回调地址）。所以这里先断言"失败原因正确"，
	// 再断言"这个码已经作废"，最后用新码走通正常路径。
	_, err = OIDCRedeemAuthCode(code, client.ClientId, "https://app.example.com/cb", "wrong-verifier-0123456789abcdefg")
	require.Error(t, err, "verifier 不对必须报错")
	assert.Contains(t, err.Error(), "PKCE")

	_, err = OIDCRedeemAuthCode(code, client.ClientId, "https://app.example.com/cb", verifier)
	require.Error(t, err, "失败的兑换必须让授权码作废")

	// 回调地址不匹配同样作废该码
	code2, err := OIDCIssueAuthCode(client, user.Id, session.SID, "https://app.example.com/cb",
		[]string{OIDCScopeOpenID}, "nonce-1", OIDCAuthorizeRequest{
			CodeChallenge:       base64.RawURLEncoding.EncodeToString(sum[:]),
			CodeChallengeMethod: OIDCPKCEMethodS256,
		})
	require.NoError(t, err)
	_, err = OIDCRedeemAuthCode(code2, client.ClientId, "https://evil.example.com/cb", verifier)
	require.Error(t, err)
	_, err = OIDCRedeemAuthCode(code2, client.ClientId, "https://app.example.com/cb", verifier)
	require.Error(t, err, "回调地址不符也要让授权码作废")

	// 正常路径：新码 + 正确 verifier + 正确回调地址 ⇒ 换到绑定信息
	code3, err := OIDCIssueAuthCode(client, user.Id, session.SID, "https://app.example.com/cb",
		[]string{OIDCScopeOpenID}, "nonce-1", OIDCAuthorizeRequest{
			CodeChallenge:       base64.RawURLEncoding.EncodeToString(sum[:]),
			CodeChallengeMethod: OIDCPKCEMethodS256,
		})
	require.NoError(t, err)
	record, err := OIDCRedeemAuthCode(code3, client.ClientId, "https://app.example.com/cb", verifier)
	require.NoError(t, err)
	assert.Equal(t, user.Id, record.UserId)

	// 同一授权码第二次出示必须失败（一次性）
	_, err = OIDCRedeemAuthCode(code3, client.ClientId, "https://app.example.com/cb", verifier)
	assert.Error(t, err, "授权码重放必须被拒绝")
}

func TestOIDCConsentGateRequiresConsentForNewScopes(t *testing.T) {
	setupOIDCTest(t)
	user := createOIDCTestUser(t, "consentuser", "default")

	needed, err := OIDCNeedsConsent(user.Id, "muw_consent_client", []string{OIDCScopeOpenID})
	require.NoError(t, err)
	assert.True(t, needed, "没有授权记录时必须弹同意页")

	require.NoError(t, model.UpsertOIDCConsent(user.Id, "muw_consent_client", OIDCScopeOpenID, false))
	needed, err = OIDCNeedsConsent(user.Id, "muw_consent_client", []string{OIDCScopeOpenID})
	require.NoError(t, err)
	assert.True(t, needed, "用户没开静默时仍要弹")

	needed, err = OIDCNeedsConsent(user.Id, "muw_consent_client", []string{OIDCScopeOpenID, OIDCScopeEmail})
	require.NoError(t, err)
	assert.True(t, needed, "新增 scope 必须重新征得同意")

	require.NoError(t, model.UpsertOIDCConsent(user.Id, "muw_consent_client", OIDCScopeOpenID, true))
	needed, err = OIDCNeedsConsent(user.Id, "muw_consent_client", []string{OIDCScopeOpenID})
	require.NoError(t, err)
	assert.False(t, needed, "用户开了静默且 scope 未变时可跳过同意页")

	needed, err = OIDCNeedsConsent(user.Id, "muw_consent_client", []string{OIDCScopeOpenID, OIDCScopeGroup})
	require.NoError(t, err)
	assert.True(t, needed, "静默也不能放行新增的 scope")
}

func TestOIDCRefreshRotationAndReplayDetection(t *testing.T) {
	setupOIDCTest(t)
	user := createOIDCTestUser(t, "refreshuser", "default")
	session := createOIDCTestSession(t, user.Id)
	client := &model.OIDCClient{ClientId: "muw_refresh_client", Scopes: "openid offline_access",
		Status: model.OIDCClientStatusApproved, ClientType: model.OIDCClientTypeConfidential, RedirectUris: "https://app.example.com/cb"}
	require.NoError(t, model.DB.Create(client).Error)

	refreshToken, err := oidcIssueRefreshToken(client.ClientId, session.SID, user.Id, []string{OIDCScopeOpenID, OIDCScopeOfflineAccess})
	require.NoError(t, err)

	identity := AuthIdentity{UserID: user.Id, SessionID: session.SID, UserAuthVersion: 1, SessionVersion: 1}
	result, err := OIDCRefreshTokens(client, refreshToken)
	require.NoError(t, err)
	require.NotEmpty(t, result.RefreshToken)
	assert.NotEqual(t, refreshToken, result.RefreshToken, "刷新必须轮换出新令牌")
	assert.NotEmpty(t, result.IdToken, "刷新应重新签发 id_token")

	// 宽限期内的重复提交：视为抖动，不撤销、要求重试
	_, err = OIDCRefreshTokens(client, refreshToken)
	assert.ErrorIs(t, err, ErrOIDCRefreshRace)

	// 把宽限期拨到过去，模拟窗口外重放 ⇒ 撤销整条链
	require.NoError(t, model.DB.Model(&model.OIDCRefreshToken{}).Where("client_id = ?", client.ClientId).
		Update("previous_valid_until", time.Now().Add(-time.Hour).Unix()).Error)
	_, err = OIDCRefreshTokens(client, refreshToken)
	assert.ErrorIs(t, err, ErrOIDCReplayDetected)

	revoked, err := model.GetOIDCRefreshTokenByHash(hashOIDCToken(result.RefreshToken))
	require.NoError(t, err)
	require.NotNil(t, revoked)
	assert.NotZero(t, revoked.RevokedAt, "重放检测触发后该应用的令牌必须被撤销")
	_, err = OIDCRefreshTokens(client, result.RefreshToken)
	assert.Error(t, err)

	_ = identity
}

func TestOIDCClientSecretOnlyVisibleToOwner(t *testing.T) {
	setupOIDCTest(t)
	owner := createOIDCTestUser(t, "secretowner", "default")
	other := createOIDCTestUser(t, "secretother", "default")
	hash, cipher, err := oidcGenerateClientSecret()
	require.NoError(t, err)
	client := &model.OIDCClient{ClientId: "muw_secret_client", Name: "密钥应用", SecretHash: hash, SecretCipher: cipher,
		ClientType: model.OIDCClientTypeConfidential, Status: model.OIDCClientStatusApproved,
		OwnerUserId: owner.Id, RedirectUris: "https://app.example.com/cb", Scopes: "openid",
		CreatedAt: common.GetTimestamp(), UpdatedAt: common.GetTimestamp()}
	require.NoError(t, model.DB.Create(client).Error)

	// 申请人本人：可以查看，且看到的与重置结果一致
	secret, err := OIDCRevealClientSecret(client.Id, owner.Id)
	require.NoError(t, err)
	assert.NotEmpty(t, secret)
	assert.True(t, common.ValidatePasswordAndHash(secret, client.SecretHash))

	// 别人（包括管理员）拿不到密钥
	_, err = OIDCRevealClientSecret(client.Id, other.Id)
	assert.Error(t, err, "非申请人不得查看密钥")
	_, err = OIDCRotateClientSecret(client.Id, other.Id)
	assert.Error(t, err, "非申请人不得重置密钥")

	// 重置后旧密钥失效、新密钥可查看
	rotated, err := OIDCRotateClientSecret(client.Id, owner.Id)
	require.NoError(t, err)
	assert.NotEqual(t, secret, rotated)
	again, err := OIDCRevealClientSecret(client.Id, owner.Id)
	require.NoError(t, err)
	assert.Equal(t, rotated, again)
}

func TestOIDCApplicationProfileEditRependsOnRedirectChange(t *testing.T) {
	setupOIDCTest(t)
	owner := createOIDCTestUser(t, "profileowner", "default")
	other := createOIDCTestUser(t, "profileother", "default")
	client := &model.OIDCClient{ClientId: "muw_profile_client", Name: "改资料", ClientType: model.OIDCClientTypePublic,
		Status: model.OIDCClientStatusApproved, OwnerUserId: owner.Id, RedirectUris: "https://app.example.com/cb",
		Scopes: "openid profile", CreatedAt: common.GetTimestamp(), UpdatedAt: common.GetTimestamp()}
	require.NoError(t, model.DB.Create(client).Error)

	// 只改描述与主页：状态不变
	updated, err := OIDCUpdateApplicationProfile(client.Id, owner.Id, OIDCApplicationProfile{
		Name: "改资料", Description: "新描述", HomepageUrl: "https://app.example.com",
		RedirectUris: []string{"https://app.example.com/cb"},
	}, false)
	require.NoError(t, err)
	assert.Equal(t, model.OIDCClientStatusApproved, updated.Status)
	assert.Equal(t, "https://app.example.com", updated.HomepageUrl)

	// 改回调地址：退回待审核（改动不能绕过管理员）
	updated, err = OIDCUpdateApplicationProfile(client.Id, owner.Id, OIDCApplicationProfile{
		Name: "改资料", RedirectUris: []string{"https://app.example.com/cb2"},
	}, false)
	require.NoError(t, err)
	assert.Equal(t, model.OIDCClientStatusPending, updated.Status, "申请人改回调地址必须重新审核")

	// 别人不能改
	_, err = OIDCUpdateApplicationProfile(client.Id, other.Id, OIDCApplicationProfile{
		Name: "越权", RedirectUris: []string{"https://app.example.com/cb"},
	}, false)
	assert.Error(t, err)
	// 管理员可以直接改（不需重审）
	updated, err = OIDCUpdateApplicationProfile(client.Id, 999, OIDCApplicationProfile{
		Name: "管理员改", RedirectUris: []string{"https://app.example.com/cb3"},
	}, true)
	require.NoError(t, err)
	assert.Equal(t, model.OIDCClientStatusPending, updated.Status, "此前已被退回，管理员改后仍需显式批准")
}

func TestOIDCUsageCounters(t *testing.T) {
	setupOIDCTest(t)
	user := createOIDCTestUser(t, "usageuser", "default")
	client := &model.OIDCClient{ClientId: "muw_usage_client", Name: "计数", ClientType: model.OIDCClientTypePublic,
		Status: model.OIDCClientStatusApproved, OwnerUserId: user.Id, RedirectUris: "https://app.example.com/cb",
		Scopes: "openid", CreatedAt: common.GetTimestamp(), UpdatedAt: common.GetTimestamp()}
	require.NoError(t, model.DB.Create(client).Error)
	require.NoError(t, model.UpsertOIDCConsent(user.Id, client.ClientId, "openid", false))

	now := common.GetTimestamp()
	for i := range 3 {
		require.NoError(t, model.RecordOIDCTokenIssued(client.ClientId, user.Id, now+int64(i)))
	}
	require.NoError(t, model.RecordOIDCTokenIssued(client.ClientId, 4242, now))

	self, err := OIDCUsageSummaryFor("self", user.Id)
	require.NoError(t, err)
	assert.EqualValues(t, 3, self.TokenIssued, "只统计自己的签发次数")
	assert.EqualValues(t, 1, self.Applications)
	assert.EqualValues(t, 1, self.Authorizations)

	all, err := OIDCUsageSummaryFor("all", user.Id)
	require.NoError(t, err)
	assert.EqualValues(t, 4, all.TokenIssued, "全站口径应含其他用户")
	assert.EqualValues(t, 2, all.ActiveUsers)

	rows, err := model.OIDCApplicationUsage(client.ClientId)
	require.NoError(t, err)
	require.Len(t, rows, 2)
}
