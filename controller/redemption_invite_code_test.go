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

// 回归：注册邀请码是纯门禁、不携带额度，后台必须能建出来（曾经 AddRedemption 把 quota
// 归零后交给要求 quota>0 的 Insert()，导致建邀请码必失败）。
func TestAddRedemptionCreatesInviteCodeWithZeroQuota(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Redemption{}, &model.RedemptionUse{}))

	recorder := performRedemptionRequest(t, http.MethodPost, "/api/redemption/",
		`{"name":"invite-batch","quota":0,"count":1,"type":2,"max_uses":1}`)
	assert.Contains(t, recorder.Body.String(), `"success":true`, recorder.Body.String())

	var code model.Redemption
	require.NoError(t, db.Where("name = ?", "invite-batch").First(&code).Error)
	assert.Equal(t, common.RedemptionCodeTypeInvite, code.Type)
	assert.Equal(t, 0, code.Quota, "邀请码不携带额度")
	assert.NotEmpty(t, code.Key)

	// 充值码仍必须携带正额度。
	recorder = performRedemptionRequest(t, http.MethodPost, "/api/redemption/",
		`{"name":"topup-batch","quota":0,"count":1,"type":1}`)
	assert.Contains(t, recorder.Body.String(), `"success":false`)
	var topupCount int64
	require.NoError(t, db.Model(&model.Redemption{}).Where("name = ?", "topup-batch").Count(&topupCount).Error)
	assert.Equal(t, int64(0), topupCount)
}

// 回归：编辑邀请码（改名称/有效期）不能被充值码的额度校验拦住，也不能被改写额度。
func TestUpdateRedemptionKeepsInviteCodeQuotaZero(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Redemption{}, &model.RedemptionUse{}))

	code := model.Redemption{
		Name: "invite-edit", Key: "40000000000000000000000000000001",
		Status: common.RedemptionCodeStatusEnabled, Type: common.RedemptionCodeTypeInvite,
		MaxUses: 1, Quota: 0, CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, db.Create(&code).Error)

	recorder := performRedemptionRequest(t, http.MethodPut, fmt.Sprintf("/api/redemption/%d", code.Id),
		fmt.Sprintf(`{"id":%d,"name":"invite-edited","quota":0,"expired_time":0}`, code.Id))
	assert.Contains(t, recorder.Body.String(), `"success":true`, recorder.Body.String())

	var updated model.Redemption
	require.NoError(t, db.First(&updated, code.Id).Error)
	assert.Equal(t, "invite-edited", updated.Name)
	assert.Equal(t, 0, updated.Quota)
}

func performRedemptionRequest(t *testing.T, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(method, path, strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("id", 1)
	c.Set("role", common.RoleRootUser)
	c.Set("username", "root-operator")
	c.Set(common.RequestIdKey, "redemption-test-request")
	if method == http.MethodPost {
		AddRedemption(c)
	} else {
		UpdateRedemption(c)
	}
	return recorder
}
