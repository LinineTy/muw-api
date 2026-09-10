package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 钓鱼邀请码：占用与审计同普通邀请码（used_count/used_user_id/redemption_uses 照落），
// 效果改为停用账号 + remark 写封禁原因，且不激活、对外仍回「邀请码无效」。
func TestActivateInviteCodeTrapDisablesUserWithoutActivating(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Redemption{}, &model.RedemptionUse{}))
	restoreInviteFlag := enableInviteCodeRegisterForTest()
	defer restoreInviteFlag()

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

	// 账号被停用、原因落 remark、仍未激活。
	var updated model.User
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, common.UserStatusDisabled, updated.Status)
	assert.Equal(t, common.TrapInviteCodeBanReason, updated.Remark)
	assert.Equal(t, 0, updated.Activated, "钓鱼码不得激活账号")
	assert.Greater(t, updated.AuthVersion, int64(1), "停用应递增认证版本（浏览器会话撤销）")

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

	// 审计独立落一条（category=security，action=invite.trap_hit）。
	var audits []model.AuditLog
	require.NoError(t, db.Where("user_id = ? AND category = ?", user.Id, model.AuditCategorySecurity).
		Find(&audits).Error)
	require.Len(t, audits, 1)
	assert.Equal(t, "invite.trap_hit", audits[0].Action)
	assert.Equal(t, "钓到一条鱼", audits[0].Content)
	assert.Contains(t, audits[0].Other.Op.Params, "code_id")
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

	var systemLogs int64
	require.NoError(t, db.Model(&model.Log{}).
		Where("user_id = ? AND type = ?", user.Id, model.LogTypeSystem).Count(&systemLogs).Error)
	assert.Equal(t, int64(0), systemLogs, "普通邀请码不写钓鱼日志")

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
	common.InviteCodeRegisterEnabled = true
	return func() { common.InviteCodeRegisterEnabled = previous }
}

func performActivateInviteCodeRequest(t *testing.T, userId int, inviteCode string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/user/activate",
		strings.NewReader(fmt.Sprintf(`{"invite_code":%q}`, inviteCode)))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("id", userId)
	ActivateInviteCode(c)
	return recorder
}
