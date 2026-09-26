// @muw-owned
package service

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
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
		slot := strings.NewReplacer("/", "_", " ", "_").Replace(t.Name()) + "_" + strconv.FormatInt(time.Now().UnixNano(), 36)
		dsn = "file:oidc_provider_" + slot + "?mode=memory&cache=shared"
	}
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.OIDCClient{},
		&model.OIDCAuthCode{}, &model.OIDCRefreshToken{}, &model.OIDCConsent{}, &model.OIDCSigningKey{}, &model.OIDCUsageStat{}, &model.OIDCAccessLog{}))

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
	token, err := OIDCIssueAuthorizeRequestToken(client, req, req.Scopes, 0, "flow-hash")
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
	other := createOIDCTestUser(t, "otheruser", "default")
	now := common.GetTimestamp()

	newClient := func(clientId, name string, owner int) *model.OIDCClient {
		client := &model.OIDCClient{ClientId: clientId, Name: name, ClientType: model.OIDCClientTypePublic,
			Status: model.OIDCClientStatusApproved, OwnerUserId: owner, RedirectUris: "https://app.example.com/cb",
			Scopes: "openid", CreatedAt: now, UpdatedAt: now}
		require.NoError(t, model.DB.Create(client).Error)
		return client
	}
	client := newClient("muw_usage_client", "计数", user.Id)
	otherClient := newClient("muw_usage_other", "别人的应用", other.Id)
	require.NoError(t, model.UpsertOIDCConsent(user.Id, client.ClientId, "openid"))

	// 令牌计数：我的应用 3+1 次、别人的应用 5 次
	for i := range 3 {
		require.NoError(t, model.RecordOIDCTokenIssued(client.ClientId, user.Id, now+int64(i)))
	}
	require.NoError(t, model.RecordOIDCTokenIssued(client.ClientId, 4242, now))
	for i := range 5 {
		require.NoError(t, model.RecordOIDCTokenIssued(otherClient.ClientId, other.Id, now+int64(10+i)))
	}
	// 调用明细：我的应用 4 次（1 次失败、2 个终端用户）、别人的应用 2 次
	log := func(clientId string, userId int, success bool) {
		require.NoError(t, model.DB.Create(&model.OIDCAccessLog{
			ClientId: clientId, UserId: userId, Action: "token", Success: success,
			ErrorCode: map[bool]string{true: "", false: "invalid_grant"}[success], CreatedAt: now,
		}).Error)
	}
	log(client.ClientId, user.Id, true)
	log(client.ClientId, 4242, true)
	log(client.ClientId, 4242, false)
	log(client.ClientId, 4242, true)
	log(otherClient.ClientId, other.Id, true)
	log(otherClient.ClientId, 0, true)

	self, err := OIDCUsageSummaryFor("self", user.Id)
	require.NoError(t, err)
	assert.EqualValues(t, 1, self.Applications)
	assert.EqualValues(t, 1, self.Authorizations)
	// self 的口径是"我的应用被怎么用"，不是"我自己用了什么"：
	assert.EqualValues(t, 4, self.TokenIssued, "我的应用签发的令牌数（含别人在用）")
	assert.EqualValues(t, 4, self.Calls)
	assert.EqualValues(t, 1, self.FailedCalls)
	assert.EqualValues(t, 2, self.ActiveUsers, "使用过我应用的去重终端用户")

	all, err := OIDCUsageSummaryFor("all", user.Id)
	require.NoError(t, err)
	assert.EqualValues(t, 2, all.Applications)
	assert.EqualValues(t, 9, all.TokenIssued)
	assert.EqualValues(t, 6, all.Calls)
	assert.EqualValues(t, 1, all.FailedCalls)
	assert.EqualValues(t, 3, all.ActiveUsers, "全站去重终端用户（user / 4242 / other）")

	// 一个应用都没有的用户：必须是 0，绝不能退化成"全站"
	noApps := createOIDCTestUser(t, "noapps", "default")
	empty, err := OIDCUsageSummaryFor("self", noApps.Id)
	require.NoError(t, err)
	assert.EqualValues(t, 0, empty.Calls, "没有应用时不得退化成全站口径")
	assert.EqualValues(t, 0, empty.TokenIssued)
	assert.EqualValues(t, 0, empty.ActiveUsers)

	// 失败原因分布与按应用聚合
	scope := model.OIDCUsageScopeForClients([]string{client.ClientId})
	totals, err := model.OIDCUsageTotalsFor(scope, 0)
	require.NoError(t, err)
	assert.EqualValues(t, 4, totals.Calls)
	failures, err := model.OIDCErrorUsageRows(scope, 0, 10)
	require.NoError(t, err)
	require.Len(t, failures, 1)
	assert.Equal(t, "invalid_grant", failures[0].ErrorCode)
	appRows, err := model.OIDCApplicationUsageRows(model.OIDCUsageScopeAll(), 10)
	require.NoError(t, err)
	require.Len(t, appRows, 2)
	assert.EqualValues(t, 4, appRows[0].Calls, "按调用量倒序")

	rows, err := model.OIDCApplicationUsage(client.ClientId)
	require.NoError(t, err)
	require.Len(t, rows, 2)
}

// 未通过审核的应用不该持有可用凭据：密钥在批准那一刻才签发，而"查看/重置密钥"
// 此前只看归属不看状态 —— 待审核的应用可以自己重置出一把密钥，界面上也像"已经能用"。
func TestOIDCUnapprovedClientHasNoCredentials(t *testing.T) {
	db := setupOIDCTest(t)
	owner := createOIDCTestUser(t, "cred-owner", "default")

	newClient := func(status string) *model.OIDCClient {
		client := &model.OIDCClient{
			ClientId:     "muw_cred_" + status,
			Name:         "credential probe " + status,
			RedirectUris: "https://app.example.com/cb",
			Scopes:       "openid profile",
			ClientType:   model.OIDCClientTypeConfidential,
			Status:       status,
			OwnerUserId:  owner.Id,
			CreatedAt:    1,
			UpdatedAt:    1,
		}
		require.NoError(t, db.Create(client).Error)
		return client
	}

	for _, status := range []string{
		model.OIDCClientStatusPending,
		model.OIDCClientStatusRejected,
		model.OIDCClientStatusDisabled,
	} {
		client := newClient(status)

		_, err := OIDCRevealClientSecret(client.Id, owner.Id)
		require.ErrorIs(t, err, ErrOIDCClientNotApproved, "status=%s 不该能查看密钥", status)

		_, err = OIDCRotateClientSecret(client.Id, owner.Id)
		require.ErrorIs(t, err, ErrOIDCClientNotApproved, "status=%s 不该能重置密钥", status)

		var stored model.OIDCClient
		require.NoError(t, db.First(&stored, client.Id).Error)
		assert.Empty(t, stored.SecretCipher, "status=%s 不该留下密钥密文", status)
		assert.Empty(t, stored.SecretHash, "status=%s 不该留下密钥哈希", status)
	}

	// 批准之后才拿得到密钥
	approved := newClient(model.OIDCClientStatusApproved)
	secret, err := OIDCRotateClientSecret(approved.Id, owner.Id)
	require.NoError(t, err)
	assert.NotEmpty(t, secret)
}

// 回归：禁用应用必须真的撤销"该应用的全部刷新令牌"。
// 此前两处调用传的是 userId=0，落到 `user_id = 0` 上 —— 真实令牌的 user_id 恒大于 0，
// 所以等于什么都没撤：禁用这把"急停开关"不生效，重新启用后 30 天内的旧刷新令牌全复活。
func TestOIDCDisableRevokesAllRefreshTokens(t *testing.T) {
	db := setupOIDCTest(t)
	owner := createOIDCTestUser(t, "revoke-owner", "default")
	now := common.GetTimestamp()
	client := &model.OIDCClient{ClientId: "muw_revoke_client", Name: "撤销", ClientType: model.OIDCClientTypePublic,
		Status: model.OIDCClientStatusApproved, OwnerUserId: owner.Id, RedirectUris: "https://app.example.com/cb",
		Scopes: "openid offline_access", CreatedAt: now, UpdatedAt: now}
	require.NoError(t, db.Create(client).Error)
	for i, userId := range []int{7, 1439} {
		require.NoError(t, db.Create(&model.OIDCRefreshToken{
			TokenHash: fmt.Sprintf("revoke-hash-%d", i), ClientId: client.ClientId,
			UserId: userId, ExpiresAt: now + 86400, CreatedAt: now,
		}).Error)
	}

	require.NoError(t, OIDCUpdateClientStatus(client.Id, owner.Id, model.OIDCClientStatusDisabled, "风险"))
	var live int64
	require.NoError(t, db.Model(&model.OIDCRefreshToken{}).
		Where("client_id = ? AND revoked_at = 0", client.ClientId).Count(&live).Error)
	assert.Zero(t, live, "禁用应用后不该还有未撤销的刷新令牌")

	// 重新启用不会"复活"已撤销的令牌
	require.NoError(t, OIDCUpdateClientStatus(client.Id, owner.Id, model.OIDCClientStatusApproved, ""))
	require.NoError(t, db.Model(&model.OIDCRefreshToken{}).
		Where("client_id = ? AND revoked_at = 0", client.ClientId).Count(&live).Error)
	assert.Zero(t, live, "重新启用不该让旧刷新令牌复活")
}

// 申请配额：总量与待审数都要封顶，否则一个账号能把审核队列刷满。
func TestOIDCApplicationQuota(t *testing.T) {
	setupOIDCTest(t)
	user := createOIDCTestUser(t, "quota-user", "default")
	apply := func(index int) error {
		_, err := OIDCSubmitApplication(user.Id, OIDCApplicationRequest{
			Name: fmt.Sprintf("quota %d", index), RedirectUris: []string{"https://app.example.com/cb"},
			Scopes: []string{OIDCScopeOpenID}, ClientType: model.OIDCClientTypePublic,
		})
		return err
	}
	// 同时在审的封顶 3 个
	for i := 1; i <= oidcMaxPendingPerUser; i++ {
		require.NoError(t, apply(i))
	}
	assert.Error(t, apply(oidcMaxPendingPerUser+1), "待审数量必须封顶")

	// 全部批准后继续申请，直到总量封顶
	clients, err := model.ListOIDCClientsByOwner(user.Id)
	require.NoError(t, err)
	for _, client := range clients {
		_, err := OIDCApproveApplication(client.Id, user.Id, []string{OIDCScopeOpenID},
			[]string{"https://app.example.com/cb"}, nil)
		require.NoError(t, err)
	}
	// 之后每申请一个就批准，避开"待审数"那道闸，单独验证总量封顶
	for i := oidcMaxPendingPerUser + 1; i <= oidcMaxApplicationsPerUser; i++ {
		require.NoError(t, apply(i))
		latest, err := model.ListOIDCClientsByOwner(user.Id)
		require.NoError(t, err)
		require.NotEmpty(t, latest)
		_, err = OIDCApproveApplication(latest[0].Id, user.Id, []string{OIDCScopeOpenID},
			[]string{"https://app.example.com/cb"}, nil)
		require.NoError(t, err)
	}
	assert.Error(t, apply(oidcMaxApplicationsPerUser+1), "应用总量必须封顶")
}

// 浏览器绑定：授权端点下发的 Cookie 与签名凭据里的哈希必须对得上。
func TestOIDCFlowCookieBinding(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// 模拟浏览器：把响应里的 Set-Cookie 带回下一次请求
	issue := func(previous []*http.Cookie) (string, []*http.Cookie) {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodGet, "/oauth/authorize", nil)
		for _, cookie := range previous {
			c.Request.AddCookie(cookie)
		}
		hash, err := OIDCIssueFlowCookie(c)
		require.NoError(t, err)
		require.NotEmpty(t, hash)
		return hash, recorder.Result().Cookies()
	}
	matches := func(hash string, cookies []*http.Cookie) bool {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodGet, "/oauth/authorize", nil)
		for _, cookie := range cookies {
			c.Request.AddCookie(cookie)
		}
		return OIDCFlowMatches(c, hash)
	}

	hash, cookies := issue(nil)
	require.NotEmpty(t, cookies)
	assert.True(t, matches(hash, cookies), "同一个浏览器应当匹配")
	assert.False(t, matches(hash, nil), "别的浏览器不得通过绑定校验")
	assert.False(t, matches("", cookies), "空哈希不得放行")

	// 同一浏览器并发多个流程：新流程不能把上一个挤掉
	secondHash, cookies := issue(cookies)
	assert.NotEqual(t, hash, secondHash)
	assert.True(t, matches(hash, cookies), "并发流程仍然可完成")
	assert.True(t, matches(secondHash, cookies))

	// 篡改过的标识不认
	tampered := []*http.Cookie{{Name: OIDCFlowCookieName, Value: "not-the-flow-id"}}
	assert.False(t, matches(hash, tampered))
}

// 按天趋势要按"用户看到的日历天"分桶，且三种库的整数除法语义不同
// （MySQL 的 / 出小数、SQLite/PostgreSQL 出整数）—— 这条用例跨 UTC 日界，
// 只有分桶正确才会呈现出"东八区两天、UTC 一天"的差别。
func TestOIDCDailyUsageRowsBucketsByLocalDay(t *testing.T) {
	setupOIDCTest(t)
	client := &model.OIDCClient{ClientId: "muw_daily_client", Name: "趋势", ClientType: model.OIDCClientTypePublic,
		Status: model.OIDCClientStatusApproved, OwnerUserId: 1, RedirectUris: "https://app.example.com/cb",
		Scopes: "openid", CreatedAt: common.GetTimestamp(), UpdatedAt: common.GetTimestamp()}
	require.NoError(t, model.DB.Create(client).Error)

	// 2026-09-26 15:30 UTC = 09-26 23:30（东八区）；2026-09-26 16:30 UTC = 09-27 00:30（东八区）
	first := int64(1790436600)
	second := first + 3600
	for _, ts := range []int64{first, second} {
		require.NoError(t, model.DB.Create(&model.OIDCAccessLog{
			ClientId: client.ClientId, UserId: 1, Action: "token", Success: true, CreatedAt: ts,
		}).Error)
	}
	require.NoError(t, model.DB.Create(&model.OIDCAccessLog{
		ClientId: client.ClientId, UserId: 1, Action: "token", Success: false,
		ErrorCode: "invalid_grant", CreatedAt: second,
	}).Error)

	beijing, err := model.OIDCDailyUsageRows(model.OIDCUsageScopeAll(), 0, 8*3600)
	require.NoError(t, err)
	require.Len(t, beijing, 2, "东八区跨天应分两桶：%+v", beijing)
	assert.Equal(t, "2026-09-26", beijing[0].Day)
	assert.EqualValues(t, 1, beijing[0].Calls)
	assert.Equal(t, "2026-09-27", beijing[1].Day)
	assert.EqualValues(t, 2, beijing[1].Calls)
	assert.EqualValues(t, 1, beijing[1].Failed)

	utc, err := model.OIDCDailyUsageRows(model.OIDCUsageScopeAll(), 0, 0)
	require.NoError(t, err)
	require.Len(t, utc, 1, "同一 UTC 日应合成一桶：%+v", utc)
	assert.Equal(t, "2026-09-26", utc[0].Day)
	assert.EqualValues(t, 3, utc[0].Calls)
}
