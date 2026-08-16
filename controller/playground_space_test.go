package controller

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newPlaygroundSpaceTestEngine 装配云空间相关接口（上传/用量/购买/清空临时/会话），
// 支持覆盖注入用户 id 与 role（root=100）。
func newPlaygroundSpaceTestEngine(userId, role int) *gin.Engine {
	router := gin.New()
	setCtx := func(c *gin.Context) {
		c.Set("id", userId)
		c.Set("role", role)
	}
	router.POST("/upload", func(c *gin.Context) { setCtx(c); UploadPlaygroundImage(c) })
	router.GET("/space", func(c *gin.Context) { setCtx(c); GetUserPlaygroundSpace(c) })
	router.POST("/purchase", func(c *gin.Context) { setCtx(c); PurchasePlaygroundSpace(c) })
	router.POST("/clear-transient", func(c *gin.Context) { setCtx(c); ClearUserTransientPlaygroundImages(c) })
	router.GET("/conversations", func(c *gin.Context) { setCtx(c); ListPlaygroundConversations(c) })
	router.PUT("/conversations/:clientId", func(c *gin.Context) { setCtx(c); SavePlaygroundConversation(c) })
	router.DELETE("/conversations/:clientId", func(c *gin.Context) { setCtx(c); DeletePlaygroundConversation(c) })
	return router
}

// migratePlaygroundConversation 在共享测试库上补建会话表（setupPlaygroundImageTestDB
// 只迁移图片与用户）。
func migratePlaygroundConversation(t *testing.T) {
	t.Helper()
	require.NoError(t, model.DB.AutoMigrate(&model.PlaygroundConversation{}))
}

func insertTestUserWithSpace(t *testing.T, id int, quota int, capacity int64) {
	t.Helper()
	require.NoError(t, model.DB.Create(&model.User{
		Id:            id,
		Username:      fmt.Sprintf("user%d", id),
		AffCode:       fmt.Sprintf("aff%d", id),
		Quota:         quota,
		SpaceCapacity: capacity,
	}).Error)
}

// TestUploadPlaygroundImageRootBypassesCapacity root（role=100）即使已占满初始容量也放行。
func TestUploadPlaygroundImageRootBypassesCapacity(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	insertTestUser(t, 100, false)
	require.NoError(t, model.InsertPlaygroundImage(&model.PlaygroundImage{
		Name: "x", Ext: "png", Size: int64(setting.UserSpaceInitialMB) << 20, UserId: 100, Permanent: false,
	}))
	router := newPlaygroundSpaceTestEngine(100, common.RoleRootUser)

	rec := uploadTestImageAs(t, router, "photo.png", playgroundTestPNGBytes(t), "")

	env := playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success, env.Message)
}

// TestUploadPlaygroundImageGlobalAllocation 云空间总分配量（红线）：全局占用达上限后
// 普通用户被拒、root 放行；图床 image_assets 不计入（未改动 UploadImage）。
func TestUploadPlaygroundImageGlobalAllocation(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	original := setting.UserSpaceGlobalMaxMB
	setting.UserSpaceGlobalMaxMB = 1 // 1MB 红线
	t.Cleanup(func() { setting.UserSpaceGlobalMaxMB = original })

	insertTestUser(t, 100, false)
	// 别的用户已占 1MB（= 红线）。
	require.NoError(t, model.InsertPlaygroundImage(&model.PlaygroundImage{
		Name: "x", Ext: "png", Size: 1 << 20, UserId: 200, Permanent: false,
	}))

	// 普通用户被拒。
	normal := newPlaygroundSpaceTestEngine(100, common.RoleCommonUser)
	rec := uploadTestImageAs(t, normal, "photo.png", playgroundTestPNGBytes(t), "")
	env := playgroundDecodeEnvelope(t, rec)
	assert.False(t, env.Success)
	assert.Contains(t, env.Message, "云空间容量已满")

	// root 放行。
	root := newPlaygroundSpaceTestEngine(100, common.RoleRootUser)
	rec = uploadTestImageAs(t, root, "photo.png", playgroundTestPNGBytes(t), "")
	env = playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success, env.Message)
}

// TestClearUserTransientPlaygroundImages 清空临时只删本人非永久文件；永久与别人保留。
func TestClearUserTransientPlaygroundImages(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	insertTestUser(t, 100, false)
	insertTestUser(t, 101, false)
	require.NoError(t, os.MkdirAll(filepath.Join(common.PrivateUploadDir, "playground-images"), 0o755))
	// id=1 本人临时，id=2 本人永久，id=3 他人临时。
	require.NoError(t, model.InsertPlaygroundImage(&model.PlaygroundImage{
		Id: 1, Name: "x", Ext: "png", Size: 1, UserId: 100, Permanent: false,
	}))
	require.NoError(t, model.InsertPlaygroundImage(&model.PlaygroundImage{
		Id: 2, Name: "x", Ext: "png", Size: 1, UserId: 100, Permanent: true,
	}))
	require.NoError(t, model.InsertPlaygroundImage(&model.PlaygroundImage{
		Id: 3, Name: "x", Ext: "png", Size: 1, UserId: 101, Permanent: false,
	}))
	for _, id := range []int{1, 2, 3} {
		require.NoError(t, os.WriteFile(playgroundPrivateFilePath(id, "png"), []byte("x"), 0o644))
	}

	router := newPlaygroundSpaceTestEngine(100, common.RoleCommonUser)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/clear-transient", nil))
	env := playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success, env.Message)
	raw := map[string]any{}
	require.NoError(t, json.Unmarshal(env.Data, &raw))
	assert.Equal(t, float64(1), raw["deleted"]) // 只删本人临时 id=1

	_, err := model.GetPlaygroundImageById(1)
	assert.Error(t, err)
	_, err = model.GetPlaygroundImageById(2) // 本人永久保留
	assert.NoError(t, err)
	_, err = model.GetPlaygroundImageById(3) // 他人保留
	assert.NoError(t, err)
}

// TestGetUserPlaygroundSpace 普通用户容量=初始，root 返回 -1。
func TestGetUserPlaygroundSpace(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	// GetUserPlaygroundSpace 现在也汇总对话同步占用，需要会话表。
	migratePlaygroundConversation(t)
	insertTestUser(t, 100, false)
	require.NoError(t, model.InsertPlaygroundImage(&model.PlaygroundImage{
		Name: "x", Ext: "png", Size: 10, UserId: 100, Permanent: false,
	}))

	router := newPlaygroundSpaceTestEngine(100, common.RoleCommonUser)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/space", nil))
	env := playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success)
	raw := map[string]any{}
	require.NoError(t, json.Unmarshal(env.Data, &raw))
	assert.Equal(t, float64(int64(setting.UserSpaceInitialMB)<<20), raw["capacity_bytes"])
	assert.Equal(t, float64(10), raw["used_bytes"])
	assert.Equal(t, float64(setting.UserSpacePurchaseRatio), raw["purchase_ratio"])
	assert.Equal(t, float64(10), raw["global_used_bytes"])
	assert.Equal(t, float64(int64(setting.UserSpaceGlobalMaxMB)<<20), raw["global_max_bytes"])

	rootRouter := newPlaygroundSpaceTestEngine(100, common.RoleRootUser)
	rec = httptest.NewRecorder()
	rootRouter.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/space", nil))
	env = playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success)
	raw = map[string]any{}
	require.NoError(t, json.Unmarshal(env.Data, &raw))
	assert.Equal(t, float64(-1), raw["capacity_bytes"])
}

// TestSavePlaygroundConversationEnforcesCapacity 对话也计入云空间容量：总占用超限时保存被拒。
func TestSavePlaygroundConversationEnforcesCapacity(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundConversation(t)
	// 用户容量 5 字节，消息远大于 5 字节 → 拒绝；root 无限制 → 放行。
	insertTestUserWithSpace(t, 100, 0, 5)
	msg := `[{"role":"user","content":"hello world conversation body"}]`

	userRouter := newPlaygroundSpaceTestEngine(100, common.RoleCommonUser)
	body := bytes.NewBufferString(`{"client_id":"c1","title":"t","messages":` + msg + `}`)
	rec := httptest.NewRecorder()
	userRouter.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/conversations/c1", body))
	env := playgroundDecodeEnvelope(t, rec)
	require.False(t, env.Success)

	rootRouter := newPlaygroundSpaceTestEngine(100, common.RoleRootUser)
	rec = httptest.NewRecorder()
	// body 已被上一次 ServeHTTP 消费，重新构造。
	rootBody := bytes.NewBufferString(`{"client_id":"c1","title":"t","messages":` + msg + `}`)
	rootRouter.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/conversations/c1", rootBody))
	env = playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success)
}

// TestPurchasePlaygroundSpaceSuccess 购买成功：quota 扣减、容量按「初始+购买」写回。
func TestPurchasePlaygroundSpaceSuccess(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	// cost 随展示货币类型/购买比例换算，动态取期望值；quota 正好等于 cost，扣完为 0。
	expectedCost := userSpacePurchaseRawQuota(10, setting.UserSpacePurchaseRatio)
	insertTestUserWithSpace(t, 100, int(expectedCost), 0)
	router := newPlaygroundSpaceTestEngine(100, common.RoleCommonUser)

	body := bytes.NewBufferString(`{"mb":10}`)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/purchase", body))
	env := playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success, env.Message)
	raw := map[string]any{}
	require.NoError(t, json.Unmarshal(env.Data, &raw))
	assert.Equal(t, float64(expectedCost), raw["cost"])
	assert.Equal(t, float64((int64(setting.UserSpaceInitialMB)+10)<<20), raw["capacity_bytes"])

	user, err := model.GetUserById(100, false)
	require.NoError(t, err)
	assert.Equal(t, 0, user.Quota)
	assert.Equal(t, int64((setting.UserSpaceInitialMB+10))<<20, user.SpaceCapacity)
}

// TestPurchasePlaygroundSpaceMaxPurchased 累计购买上限：已购 40MB、上限 50MB 时，
// 再买 10MB 恰好达上限放行，再买 1MB 超限拒绝且不扣费。
func TestPurchasePlaygroundSpaceMaxPurchased(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	prev := setting.UserSpaceMaxPurchasedMB
	setting.UserSpaceMaxPurchasedMB = 50
	t.Cleanup(func() { setting.UserSpaceMaxPurchasedMB = prev })

	expectedCost10 := userSpacePurchaseRawQuota(10, setting.UserSpacePurchaseRatio)
	// quota 足够买 10MB + 1MB（10 亿量级，int32 范围内）。
	insertTestUserWithSpace(t, 100, int(expectedCost10*2), 0)
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", 100).
		Update("space_purchased_bytes", int64(40)<<20).Error)
	router := newPlaygroundSpaceTestEngine(100, common.RoleCommonUser)

	buy := func(mb int) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/purchase",
			bytes.NewBufferString(fmt.Sprintf(`{"mb":%d}`, mb))))
		return rec
	}

	// 40+10=50 = 上限，允许。
	env := playgroundDecodeEnvelope(t, buy(10))
	require.True(t, env.Success, env.Message)
	// 再买 1MB → 51 > 50，拒绝。
	env = playgroundDecodeEnvelope(t, buy(1))
	assert.False(t, env.Success)
	assert.Contains(t, env.Message, "累计上限")

	user, err := model.GetUserById(100, false)
	require.NoError(t, err)
	assert.Equal(t, int64(50)<<20, user.SpacePurchasedBytes)
}

// TestPurchasePlaygroundSpaceInsufficientBalance 余额不足拒绝，且不写容量。
func TestPurchasePlaygroundSpaceInsufficientBalance(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	insertTestUserWithSpace(t, 100, 50, 0) // 50 < 100（1MB 成本）
	router := newPlaygroundSpaceTestEngine(100, common.RoleCommonUser)

	body := bytes.NewBufferString(`{"mb":1}`)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/purchase", body))
	env := playgroundDecodeEnvelope(t, rec)
	assert.False(t, env.Success)
	assert.Contains(t, env.Message, "余额不足")

	user, err := model.GetUserById(100, false)
	require.NoError(t, err)
	assert.Equal(t, 50, user.Quota) // 未扣
	assert.Equal(t, int64(0), user.SpaceCapacity)
}

// TestPurchasePlaygroundSpaceRejectsOutOfRange mb 越界（0 / 超上限）被拒。
func TestPurchasePlaygroundSpaceRejectsOutOfRange(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	insertTestUserWithSpace(t, 100, 10000, 0)
	router := newPlaygroundSpaceTestEngine(100, common.RoleCommonUser)

	for _, mb := range []string{"0", "-1", "2000"} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/purchase", bytes.NewBufferString(`{"mb":`+mb+`}`)))
		env := playgroundDecodeEnvelope(t, rec)
		assert.False(t, env.Success, mb)
		assert.Contains(t, env.Message, "购买容量", mb)
	}
}

// TestSaveAndListPlaygroundConversations 保存/列表 + upsert 幂等。
func TestSaveAndListPlaygroundConversations(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundConversation(t)
	insertTestUser(t, 100, false)
	router := newPlaygroundSpaceTestEngine(100, common.RoleCommonUser)

	put := func(clientId string, messages string) *httptest.ResponseRecorder {
		body := bytes.NewBufferString(fmt.Sprintf(`{"title":"t-%s","messages":%s}`, clientId, messages))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/conversations/"+clientId, body))
		return rec
	}

	rec := put("conv-a", `[{"role":"user","content":"hi"}]`)
	env := playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success, env.Message)

	// 同 client_id 再次 upsert：不重复插，更新内容。
	rec = put("conv-a", `[{"role":"user","content":"hi2"}]`)
	env = playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success, env.Message)

	convos, err := model.ListPlaygroundConversationsByUser(100)
	require.NoError(t, err)
	require.Len(t, convos, 1)
	assert.Contains(t, convos[0].Messages, "hi2")

	// 列表接口透传 messages 原始 JSON。
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/conversations", nil))
	env = playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success)
	items := []map[string]any{}
	require.NoError(t, json.Unmarshal(env.Data, &items))
	require.Len(t, items, 1)
	assert.Equal(t, "conv-a", items[0]["client_id"])
	assert.Contains(t, string(mustMarshal(t, items[0]["messages"])), "hi2")
}

// TestSavePlaygroundConversationRejectsBadMessages 空/超限/非法 JSON 被拒。
func TestSavePlaygroundConversationRejectsBadMessages(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundConversation(t)
	insertTestUser(t, 100, false)
	router := newPlaygroundSpaceTestEngine(100, common.RoleCommonUser)

	put := func(messages string) *httptest.ResponseRecorder {
		body := bytes.NewBufferString(fmt.Sprintf(`{"title":"t","messages":%s}`, messages))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/conversations/conv-x", body))
		return rec
	}

	// 空 messages（null 字面量也被 RawMessage 保留，同样拒绝）。
	env := playgroundDecodeEnvelope(t, put(`null`))
	assert.False(t, env.Success)
	assert.Contains(t, env.Message, "为空")

	// 非法 JSON：外层对象都无法解析，DecodeJson 报「参数错误」。
	env = playgroundDecodeEnvelope(t, put(`[{"role":"user",`))
	assert.False(t, env.Success)
	assert.Contains(t, env.Message, "参数错误")

	// 超过 2MB 的合法 JSON 数组。
	huge := `["` + strings.Repeat("a", maxConversationMessagesBytes) + `"]`
	env = playgroundDecodeEnvelope(t, put(huge))
	assert.False(t, env.Success)
	assert.Contains(t, env.Message, "过大")
}

// TestDeletePlaygroundConversationOwnership 仅本人可删，他人 403。
func TestDeletePlaygroundConversationOwnership(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundConversation(t)
	insertTestUser(t, 100, false)
	insertTestUser(t, 101, false)
	require.NoError(t, model.UpsertPlaygroundConversation(&model.PlaygroundConversation{
		UserId: 100, ClientId: "conv-a", Title: "t", Messages: `[]`,
	}))

	other := newPlaygroundSpaceTestEngine(101, common.RoleCommonUser)
	rec := httptest.NewRecorder()
	other.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/conversations/conv-a", nil))
	assert.Equal(t, http.StatusForbidden, rec.Code)

	owner := newPlaygroundSpaceTestEngine(100, common.RoleCommonUser)
	rec = httptest.NewRecorder()
	owner.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/conversations/conv-a", nil))
	env := playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success, env.Message)

	_, err := model.GetPlaygroundConversationByClientId(100, "conv-a")
	assert.Error(t, err) // 软删后查不到
}

// TestDeletePlaygroundConversationIdempotent 删除幂等：会话不存在 / 重复删除
// 均返回成功（本地新建从未推送的「新对话」删除不应误报「会话不存在」），
// 他人会话仍返回 403。
func TestDeletePlaygroundConversationIdempotent(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundConversation(t)
	insertTestUser(t, 100, false)
	insertTestUser(t, 101, false)
	require.NoError(t, model.UpsertPlaygroundConversation(&model.PlaygroundConversation{
		UserId: 100, ClientId: "conv-idem", Title: "t", Messages: `[]`,
	}))
	require.NoError(t, model.UpsertPlaygroundConversation(&model.PlaygroundConversation{
		UserId: 100, ClientId: "conv-other", Title: "t", Messages: `[]`,
	}))

	owner := newPlaygroundSpaceTestEngine(100, common.RoleCommonUser)

	del := func(clientId string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		owner.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/conversations/"+clientId, nil))
		return rec
	}

	// 从不存在的会话：幂等成功。
	env := playgroundDecodeEnvelope(t, del("never-pushed"))
	require.True(t, env.Success, env.Message)

	// 首次删除：成功。
	env = playgroundDecodeEnvelope(t, del("conv-idem"))
	require.True(t, env.Success, env.Message)

	// 重复删除已软删会话：仍成功。
	env = playgroundDecodeEnvelope(t, del("conv-idem"))
	require.True(t, env.Success, env.Message)

	// 越权语义保留：他人删除存在且属本人的会话 → 403。
	other := newPlaygroundSpaceTestEngine(101, common.RoleCommonUser)
	rec := httptest.NewRecorder()
	other.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/conversations/conv-other", nil))
	assert.Equal(t, http.StatusForbidden, rec.Code)
}

func mustMarshal(t *testing.T, v any) []byte {
	t.Helper()
	data, err := json.Marshal(v)
	require.NoError(t, err)
	return data
}
