package controller

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 钓鱼邀请码：占用与审计同普通邀请码（used_count/used_user_id/redemption_uses 照落），
// 处置是「落一条宽限记录」而不是秒封：窗口内用有效邀请码激活即可免于停用，到期由定时
// 任务统一停用。对外仍回「邀请码无效」，不暴露钩子。
func TestActivateInviteCodeTrapStartsGraceWithoutDisabling(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Redemption{}, &model.RedemptionUse{}, &model.InviteTrapGrace{}))
	restoreInviteFlag := enableInviteCodeRegisterForTest()
	defer restoreInviteFlag()
	// 本用例覆盖**未开启人机校验**的站点配置（难度 0）：钩子命中只落宽限、不秒封。
	// 开启人机校验时命中会被当场判为真人误踩并结清，见 TestActivateInviteCodeTrapWithPoWResolvesGrace。
	previousBits := common.ActivationPoWBits
	common.ActivationPoWBits = 0
	defer func() { common.ActivationPoWBits = previousBits }()

	user := model.User{
		Username: "trap-fish", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", Activated: 0, AuthVersion: 1,
	}
	require.NoError(t, db.Create(&user).Error)
	// activated 带 default:1，GORM 插入时省略零值 → 显式回置为待激活（同建号流程）。
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("activated", 0).Error)
	code := model.Redemption{
		Name: "invite-bait", Key: "30000000000000000000000000000001",
		Status: common.RedemptionCodeStatusEnabled, Type: common.RedemptionCodeTypeInvite,
		MaxUses: 2, IsTrap: true, CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, db.Create(&code).Error)

	recorder := performActivateInviteCodeRequest(t, user.Id, code.Key)
	assert.Contains(t, recorder.Body.String(), `"success":false`, "钓鱼码不得返回激活成功")
	assert.NotContains(t, recorder.Body.String(), `"success":true`)

	// 账号不被停用、remark 不动、仍未激活 —— 处置推迟到宽限到期。
	var updated model.User
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, common.UserStatusEnabled, updated.Status, "命中钩子不立刻停用")
	assert.Equal(t, "", updated.Remark, "未到封号时不得改写 remark")
	assert.Equal(t, 0, updated.Activated, "钓鱼码不得激活账号")
	assert.Equal(t, int64(1), updated.AuthVersion, "未停用则不动认证版本")

	// 宽限记录：一条、未结清、截止时间落在窗口内。
	now := common.GetTimestamp()
	var grace model.InviteTrapGrace
	require.NoError(t, db.Where("user_id = ?", user.Id).First(&grace).Error)
	assert.Equal(t, int64(0), grace.ResolvedAt, "刚命中时记录应处于进行中")
	assert.Equal(t, "", grace.ResolvedReason)
	assert.Equal(t, 1, grace.HitCount)
	assert.Equal(t, code.Id, grace.RedemptionId)
	assert.Equal(t, user.Id, grace.UserId)
	assert.Greater(t, grace.ExpireAt, now)
	assert.LessOrEqual(t, grace.ExpireAt, now+int64(common.InviteTrapGraceWindow()))

	// 审计照常：名额扣一次、使用人回填、redemption_uses 落一条。
	var after model.Redemption
	require.NoError(t, db.First(&after, code.Id).Error)
	assert.Equal(t, 1, after.UsedCount)
	assert.Equal(t, user.Id, after.UsedUserId)
	var useCount int64
	require.NoError(t, db.Model(&model.RedemptionUse{}).
		Where("redemption_id = ? AND user_id = ?", code.Id, user.Id).Count(&useCount).Error)
	assert.Equal(t, int64(1), useCount)

	// 系统日志文案：钓到一条鱼。
	var logs []model.Log
	require.NoError(t, db.Where("user_id = ? AND type = ?", user.Id, model.LogTypeSystem).Find(&logs).Error)
	require.Len(t, logs, 1)
	assert.Equal(t, "钓到一条鱼", logs[0].Content)

	// 审计独立落一条（category=security，action=invite.trap_hit），params 带截止时间。
	var audits []model.AuditLog
	require.NoError(t, db.Where("user_id = ? AND category = ?", user.Id, model.AuditCategorySecurity).
		Find(&audits).Error)
	require.Len(t, audits, 1)
	assert.Equal(t, "invite.trap_hit", audits[0].Action)
	assert.Equal(t, "钓到一条鱼", audits[0].Content)
	assert.Contains(t, audits[0].Other.Op.Params, "code_id")
	assert.Contains(t, audits[0].Other.Op.Params, "expire_at")

	// 再踩一次：累计命中次数，但**不顺延**截止时间（否则反复提交钩子码即可无限续期）。
	firstExpire := grace.ExpireAt
	_ = performActivateInviteCodeRequest(t, user.Id, code.Key)
	var again model.InviteTrapGrace
	require.NoError(t, db.Where("user_id = ?", user.Id).First(&again).Error)
	assert.Equal(t, 2, again.HitCount)
	assert.Equal(t, firstExpire, again.ExpireAt, "重复命中不得顺延截止时间")
	var graceRows int64
	require.NoError(t, db.Model(&model.InviteTrapGrace{}).Where("user_id = ?", user.Id).Count(&graceRows).Error)
	assert.Equal(t, int64(1), graceRows, "同一用户只保留一条未结记录")
}

// 到期未激活：定时任务把账号停用、写封禁原因、结清宽限记录；再扫一遍不重复处置。
func TestInviteTrapGraceExpiryDisablesUserAfterWindow(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Redemption{}, &model.RedemptionUse{}, &model.InviteTrapGrace{}))
	restoreInviteFlag := enableInviteCodeRegisterForTest()
	defer restoreInviteFlag()

	user := model.User{
		Username: "trap-expired", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", Activated: 0, AuthVersion: 1,
	}
	require.NoError(t, db.Create(&user).Error)
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("activated", 0).Error)
	code := model.Redemption{
		Name: "invite-bait-expiry", Key: "30000000000000000000000000000004",
		Status: common.RedemptionCodeStatusEnabled, Type: common.RedemptionCodeTypeInvite,
		MaxUses: 1, IsTrap: true, CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, db.Create(&code).Error)
	// 宽限记录直接由 model 层造：本条测的是"到期处置"机制，与提交侧的人机校验解耦
	// （走控制器时，通过校验的提交会当场结清记录，测不到到期分支）。
	_, err := model.StartInviteTrapGrace(user.Id, code.Id, "127.0.0.1", "test")
	require.NoError(t, err)

	// 宽限期内不处置。
	summary, err := runInviteTrapGraceExpiry(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 0, summary["disabled"], "窗口未到不得停用")

	// 把截止时间推到过去，模拟窗口走完。
	require.NoError(t, db.Model(&model.InviteTrapGrace{}).Where("user_id = ?", user.Id).
		Update("expire_at", common.GetTimestamp()-1).Error)

	summary, err = runInviteTrapGraceExpiry(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, summary["disabled"])

	var updated model.User
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, common.UserStatusDisabled, updated.Status)
	assert.Equal(t, common.TrapInviteCodeBanReason, updated.Remark)

	var grace model.InviteTrapGrace
	require.NoError(t, db.Where("user_id = ?", user.Id).First(&grace).Error)
	assert.NotZero(t, grace.ResolvedAt)
	assert.Equal(t, model.InviteTrapGraceReasonExpired, grace.ResolvedReason)

	var logs []model.Log
	require.NoError(t, db.Where("user_id = ? AND content = ?", user.Id, "钓鱼码宽限期已过，账号已停用").
		Find(&logs).Error)
	assert.Len(t, logs, 1)
	var expiredAudits int64
	require.NoError(t, db.Model(&model.AuditLog{}).
		Where("user_id = ? AND action = ?", user.Id, "invite.trap_expired").Count(&expiredAudits).Error)
	assert.Equal(t, int64(1), expiredAudits)

	// 已结清的行不再被扫描，重复执行是幂等的。
	summary, err = runInviteTrapGraceExpiry(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 0, summary["disabled"])
}

// 宽限期内用有效邀请码激活成功：记录结清为 activated，到期扫描不再动这个账号。
func TestInviteTrapGraceClearedByValidInviteCode(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Redemption{}, &model.RedemptionUse{}, &model.InviteTrapGrace{}))
	restoreInviteFlag := enableInviteCodeRegisterForTest()
	defer restoreInviteFlag()

	user := model.User{
		Username: "trap-redeemed", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", Activated: 0, AuthVersion: 1,
	}
	require.NoError(t, db.Create(&user).Error)
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("activated", 0).Error)
	bait := model.Redemption{
		Name: "invite-bait-redeem", Key: "30000000000000000000000000000005",
		Status: common.RedemptionCodeStatusEnabled, Type: common.RedemptionCodeTypeInvite,
		MaxUses: 1, IsTrap: true, CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, db.Create(&bait).Error)
	real := model.Redemption{
		Name: "invite-real", Key: "30000000000000000000000000000006",
		Status: common.RedemptionCodeStatusEnabled, Type: common.RedemptionCodeTypeInvite,
		MaxUses: 1, CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, db.Create(&real).Error)

	// 命中钩子留下的宽限记录由 model 层直接造（见上一条用例的说明）；随后用有效邀请码激活。
	_, err := model.StartInviteTrapGrace(user.Id, bait.Id, "127.0.0.1", "test")
	require.NoError(t, err)
	recorder := performActivateInviteCodeRequest(t, user.Id, real.Key)
	assert.Contains(t, recorder.Body.String(), `"success":true`)

	var updated model.User
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, common.UserStatusEnabled, updated.Status)
	assert.Equal(t, 1, updated.Activated)
	assert.Equal(t, "", updated.Remark)

	var grace model.InviteTrapGrace
	require.NoError(t, db.Where("user_id = ?", user.Id).First(&grace).Error)
	assert.NotZero(t, grace.ResolvedAt)
	assert.Equal(t, model.InviteTrapGraceReasonActivated, grace.ResolvedReason)

	require.NoError(t, db.Model(&model.InviteTrapGrace{}).Where("user_id = ?", user.Id).
		Update("expire_at", common.GetTimestamp()-1).Error)
	summary, err := runInviteTrapGraceExpiry(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 0, summary["disabled"], "已结清的记录不得被到期扫描处置")
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, common.UserStatusEnabled, updated.Status)
}

// 激活页倒计时接口：进行中返回剩余秒数，结清或过期后返回 pending=false。
func TestGetInviteTrapGraceStatusReportsRemaining(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.InviteTrapGrace{}))

	user := model.User{
		Username: "trap-countdown", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", Activated: 0, AuthVersion: 1,
	}
	require.NoError(t, db.Create(&user).Error)

	recorder := performGraceStatusRequest(t, user.Id)
	assert.Contains(t, recorder.Body.String(), `"pending":false`, "没有记录时应回 pending=false")

	_, err := model.StartInviteTrapGrace(user.Id, 1, "127.0.0.1", "test-agent")
	require.NoError(t, err)
	recorder = performGraceStatusRequest(t, user.Id)
	assert.Contains(t, recorder.Body.String(), `"pending":true`)
	assert.Contains(t, recorder.Body.String(), `"remaining_seconds"`)

	require.NoError(t, model.ResolveInviteTrapGrace(user.Id, model.InviteTrapGraceReasonActivated))
	recorder = performGraceStatusRequest(t, user.Id)
	assert.Contains(t, recorder.Body.String(), `"pending":false`, "已结清后不再提示")
}

func performGraceStatusRequest(t *testing.T, userId int) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/user/activation_deadline", nil)
	c.Set("id", userId)
	c.Set("role", common.RoleCommonUser)
	GetInviteTrapGraceStatus(c)
	return recorder
}

// 回归：普通邀请码照旧激活账号，remark 不被改动。
func TestActivateInviteCodeNormalInviteStillActivates(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Redemption{}, &model.RedemptionUse{}))
	restoreInviteFlag := enableInviteCodeRegisterForTest()
	defer restoreInviteFlag()

	user := model.User{
		Username: "normal-invitee", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", Activated: 0, AuthVersion: 1,
		Remark: "既有备注",
	}
	require.NoError(t, db.Create(&user).Error)
	// activated 带 default:1，GORM 插入时省略零值 → 显式回置为待激活（同建号流程）。
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("activated", 0).Error)
	code := model.Redemption{
		Name: "invite-normal", Key: "30000000000000000000000000000002",
		Status: common.RedemptionCodeStatusEnabled, Type: common.RedemptionCodeTypeInvite,
		MaxUses: 1, CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, db.Create(&code).Error)

	recorder := performActivateInviteCodeRequest(t, user.Id, code.Key)
	assert.Contains(t, recorder.Body.String(), `"success":true`)

	var updated model.User
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, common.UserStatusEnabled, updated.Status)
	assert.Equal(t, 1, updated.Activated)
	assert.Equal(t, "既有备注", updated.Remark, "普通邀请码不得改写 remark")

	var after model.Redemption
	require.NoError(t, db.First(&after, code.Id).Error)
	assert.Equal(t, 1, after.UsedCount)
	assert.Equal(t, user.Id, after.UsedUserId)

	var systemLogs []model.Log
	require.NoError(t, db.Where("user_id = ? AND type = ?", user.Id, model.LogTypeSystem).Find(&systemLogs).Error)
	require.Len(t, systemLogs, 1, "普通邀请码激活应留一条系统日志")
	assert.Equal(t, "使用邀请码激活成功", systemLogs[0].Content)

	var securityAudits int64
	require.NoError(t, db.Model(&model.AuditLog{}).
		Where("user_id = ? AND action = ?", user.Id, "invite.trap_hit").Count(&securityAudits).Error)
	assert.Equal(t, int64(0), securityAudits, "普通邀请码不写钓鱼审计")
}

// 钓鱼码被停用/用尽后不再命中钩子：仍是"邀请码无效/已被使用"，账号不会被二次处理。
func TestActivateInviteCodeTrapDisabledReportedAsDisabled(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Redemption{}, &model.RedemptionUse{}))
	restoreInviteFlag := enableInviteCodeRegisterForTest()
	defer restoreInviteFlag()

	user := model.User{
		Username: "trap-fish-disabled", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", Activated: 0, AuthVersion: 1,
	}
	require.NoError(t, db.Create(&user).Error)
	// activated 带 default:1，GORM 插入时省略零值 → 显式回置为待激活（同建号流程）。
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("activated", 0).Error)
	code := model.Redemption{
		Name: "invite-bait-off", Key: "30000000000000000000000000000003",
		Status: common.RedemptionCodeStatusDisabled, Type: common.RedemptionCodeTypeInvite,
		MaxUses: 1, IsTrap: true, CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, db.Create(&code).Error)

	recorder := performActivateInviteCodeRequest(t, user.Id, code.Key)
	assert.Contains(t, recorder.Body.String(), `"success":false`)

	var updated model.User
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, common.UserStatusEnabled, updated.Status, "停用的钓鱼码不应触发停用")
	assert.Equal(t, 0, updated.Activated)
}

func enableInviteCodeRegisterForTest() func() {
	previous := common.InviteCodeRegisterEnabled
	previousBits := common.ActivationPoWBits
	common.InviteCodeRegisterEnabled = true
	// 人机校验默认 18 位；单测里真解挑战（见 performActivateInviteCodeRequest），
	// 压到 8 位让每个用例快一个数量级，难度语义由 model 包的单测覆盖。
	common.ActivationPoWBits = 8
	return func() {
		common.InviteCodeRegisterEnabled = previous
		common.ActivationPoWBits = previousBits
	}
}

// solveActivationPoWForTest 复刻浏览器端的求解循环（从 0 递增试 nonce）。
func solveActivationPoWForTest(t *testing.T, challenge string, bits int) string {
	t.Helper()
	for nonce := 0; nonce < 10_000_000; nonce++ {
		candidate := strconv.Itoa(nonce)
		if model.VerifyActivationPoW(challenge, candidate, bits) {
			return candidate
		}
	}
	t.Fatalf("求解 PoW 失败：challenge=%s bits=%d", challenge, bits)
	return ""
}

// performActivateInviteCodeRequest 模拟激活页的正常提交：带一道已解出的人机校验挑战
// （PoW 开启时真实客户端就是这个形状）。
func performActivateInviteCodeRequest(t *testing.T, userId int, inviteCode string) *httptest.ResponseRecorder {
	t.Helper()
	payload := map[string]any{"invite_code": inviteCode}
	if bits := common.ActivationPoWBitsEffective(); bits > 0 {
		challenge, err := model.IssueActivationPoWChallenge(userId, "127.0.0.1", bits)
		require.NoError(t, err)
		payload["challenge_id"] = challenge.Id
		payload["nonce"] = solveActivationPoWForTest(t, challenge.Challenge, challenge.Bits)
	}
	return performActivateInviteCodeRequestWithBody(t, userId, payload)
}

// performActivateInviteCodeRequestWithBody 直接给请求体：用于测"没带挑战""蜜罐字段非空"这类
// 客户端异常/自动化形状。
func performActivateInviteCodeRequestWithBody(t *testing.T, userId int, payload map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	body, err := common.Marshal(payload)
	require.NoError(t, err)
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/user/activate", strings.NewReader(string(body)))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("id", userId)
	c.Set("role", common.RoleCommonUser)
	c.Set("username", "trap-target")
	ActivateInviteCode(c)
	return recorder
}

// 隐形蜜罐：字段非空即判自动化提交 —— 立即停用、不消费邀请码名额、对外仍回"无效邀请码"。
func TestActivateInviteCodeHoneypotDisablesUser(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Redemption{}, &model.RedemptionUse{}, &model.InviteTrapGrace{}))
	restoreInviteFlag := enableInviteCodeRegisterForTest()
	defer restoreInviteFlag()

	user := model.User{
		Username: "honeypot-bot", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", Activated: 0, AuthVersion: 1,
	}
	require.NoError(t, db.Create(&user).Error)
	// activated 带 default:1，GORM 插入时省略零值 → 显式回置为待激活（否则控制器在读请求体前就返回"已激活"）。
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("activated", 0).Error)
	code := model.Redemption{
		Name: "invite-plain", Key: "30000000000000000000000000000009",
		Status: common.RedemptionCodeStatusEnabled, Type: common.RedemptionCodeTypeInvite,
		MaxUses: 5, CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, db.Create(&code).Error)

	// 模拟脚本：填了真人看不到的 website 字段，且没带人机校验
	recorder := performActivateInviteCodeRequestWithBody(t, user.Id, map[string]any{
		"invite_code": code.Key,
		"website":     "http://spam.example.com",
	})
	assert.Contains(t, recorder.Body.String(), `"success":false`)
	assert.NotContains(t, recorder.Body.String(), "honeypot") // 对外不解释原因

	var updated model.User
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, common.UserStatusDisabled, updated.Status, "蜜罐命中应立即停用")
	assert.Equal(t, common.HoneypotBanReason, updated.Remark)

	// 名额不被消耗：蜜罐检查发生在占位之前
	var after model.Redemption
	require.NoError(t, db.First(&after, code.Id).Error)
	assert.Equal(t, 0, after.UsedCount, "蜜罐命中不得消费邀请码名额")
	assert.Equal(t, 0, after.UsedUserId)

	var logs []model.Log
	require.NoError(t, db.Where("user_id = ? AND type = ?", user.Id, model.LogTypeSystem).Find(&logs).Error)
	require.Len(t, logs, 1)
	assert.Equal(t, "蜜罐命中，账号已停用", logs[0].Content)
}

// 人机校验开启时，没带挑战的提交拿不到结果，且不消费名额（脚本必须为每次尝试算一遍）。
func TestActivateInviteCodeRequiresPoW(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Redemption{}, &model.RedemptionUse{}, &model.InviteTrapGrace{}))
	restoreInviteFlag := enableInviteCodeRegisterForTest()
	defer restoreInviteFlag()

	user := model.User{
		Username: "pow-missing", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", Activated: 0, AuthVersion: 1,
	}
	require.NoError(t, db.Create(&user).Error)
	// activated 带 default:1，GORM 插入时省略零值 → 显式回置为待激活（否则控制器在读请求体前就返回"已激活"）。
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("activated", 0).Error)
	code := model.Redemption{
		Name: "invite-plain-2", Key: "30000000000000000000000000000010",
		Status: common.RedemptionCodeStatusEnabled, Type: common.RedemptionCodeTypeInvite,
		MaxUses: 5, CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, db.Create(&code).Error)

	recorder := performActivateInviteCodeRequestWithBody(t, user.Id, map[string]any{"invite_code": code.Key})
	assert.Contains(t, recorder.Body.String(), CodeActivationVerificationRequired)
	assert.Contains(t, recorder.Body.String(), `"success":false`)

	var after model.Redemption
	require.NoError(t, db.First(&after, code.Id).Error)
	assert.Equal(t, 0, after.UsedCount, "未通过人机校验不得消费名额")
	var updated model.User
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, common.UserStatusEnabled, updated.Status, "单纯没算 PoW 不该被停用")
	assert.Equal(t, 0, updated.Activated)
}

// 命中钩子但同一次提交通过了人机校验 ⇒ 判真人误踩：宽限记录当场结清，不会被到期停用。
func TestActivateInviteCodeTrapWithPoWResolvesGrace(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Redemption{}, &model.RedemptionUse{}, &model.InviteTrapGrace{}))
	restoreInviteFlag := enableInviteCodeRegisterForTest()
	defer restoreInviteFlag()

	user := model.User{
		Username: "trap-human", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", Activated: 0, AuthVersion: 1,
	}
	require.NoError(t, db.Create(&user).Error)
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("activated", 0).Error)
	code := model.Redemption{
		Name: "invite-bait-pow", Key: "30000000000000000000000000000011",
		Status: common.RedemptionCodeStatusEnabled, Type: common.RedemptionCodeTypeInvite,
		MaxUses: 2, IsTrap: true, CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, db.Create(&code).Error)

	recorder := performActivateInviteCodeRequest(t, user.Id, code.Key)
	assert.Contains(t, recorder.Body.String(), `"success":false`, "对外仍按无效邀请码回复")

	var grace model.InviteTrapGrace
	require.NoError(t, db.Where("user_id = ?", user.Id).First(&grace).Error)
	assert.NotEqual(t, int64(0), grace.ResolvedAt, "通过人机校验后宽限记录应结清")
	assert.Equal(t, model.InviteTrapGraceReasonVerified, grace.ResolvedReason)

	// 结清后抓不到"未结"记录 ⇒ 到期任务不会再停用这个账号
	unresolved, err := model.GetUnresolvedInviteTrapGrace(user.Id)
	require.NoError(t, err)
	assert.Nil(t, unresolved)

	var updated model.User
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, common.UserStatusEnabled, updated.Status)
	assert.Equal(t, "", updated.Remark)
}

// 签发的挑战形状与开关：bits=0 时返回 enabled=false（前端据此跳过校验）。
func TestIssueActivationChallenge(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	restoreInviteFlag := enableInviteCodeRegisterForTest()
	defer restoreInviteFlag()

	user := model.User{
		Username: "pow-issuer", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1,
	}
	require.NoError(t, db.Create(&user).Error)

	recorder := performIssueActivationChallengeRequest(t, user.Id)
	body := recorder.Body.String()
	assert.Contains(t, body, `"enabled":true`)
	assert.Contains(t, body, `"challenge_id"`)
	assert.Contains(t, body, `"bits":8`)

	previousBits := common.ActivationPoWBits
	common.ActivationPoWBits = 0
	defer func() { common.ActivationPoWBits = previousBits }()
	recorder = performIssueActivationChallengeRequest(t, user.Id)
	assert.Contains(t, recorder.Body.String(), `"enabled":false`)
}

func performIssueActivationChallengeRequest(t *testing.T, userId int) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/user/activation_challenge", nil)
	c.Set("id", userId)
	c.Set("role", common.RoleCommonUser)
	IssueActivationChallenge(c)
	return recorder
}
