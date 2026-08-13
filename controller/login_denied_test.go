package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupLoginDeniedControllerTest(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	previousType := common.MainDatabaseType()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	model.DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		model.DB = previousDB
		common.SetMainDatabaseType(previousType)
	})
}

// TestLoginDisabledUserReturnsStructuredDenial 保护「被禁用用户密码登录返回结构化
// login_status」契约：前端中间态页依赖 code=AUTH_LOGIN_DENIED 与 data.login_status
// 渲染禁用原因，而非笼统的密码错误。
func TestLoginDisabledUserReturnsStructuredDenial(t *testing.T) {
	setupLoginDeniedControllerTest(t)

	oldPasswordLogin := common.PasswordLoginEnabled
	common.PasswordLoginEnabled = true
	t.Cleanup(func() { common.PasswordLoginEnabled = oldPasswordLogin })

	hashed, err := common.Password2Hash("CorrectPassword123")
	require.NoError(t, err)
	require.NoError(t, model.DB.Create(&model.User{
		Username: "banned-user",
		Password: hashed,
		Status:   common.UserStatusDisabled,
		Remark:   "violated terms",
	}).Error)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/user/login", strings.NewReader(`{"username":"banned-user","password":"CorrectPassword123"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	Login(c)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool   `json:"success"`
		Code    string `json:"code"`
		Data    struct {
			LoginStatus struct {
				Status string `json:"status"`
				Reason string `json:"reason"`
			} `json:"login_status"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)
	assert.Equal(t, common.CodeLoginDenied, response.Code)
	assert.Equal(t, common.LoginStatusUserDisabled, response.Data.LoginStatus.Status)
	assert.Equal(t, "violated terms", response.Data.LoginStatus.Reason)
}
