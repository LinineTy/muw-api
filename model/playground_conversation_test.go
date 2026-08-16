package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func openPlaygroundConversationTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	prevType := common.MainDatabaseType()
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() { common.SetMainDatabaseType(prevType) })

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&PlaygroundConversation{}))

	prevDB := DB
	DB = db
	t.Cleanup(func() { DB = prevDB })
	return db
}

// TestPlaygroundConversationUpsertOnConflict 同 (user_id, client_id) upsert 不重复插，
// 只更新 title/messages/updated_time；不同用户同 clientId 是独立行；软删后查不到。
func TestPlaygroundConversationUpsertOnConflict(t *testing.T) {
	openPlaygroundConversationTestDB(t)

	require.NoError(t, UpsertPlaygroundConversation(&PlaygroundConversation{
		UserId: 100, ClientId: "conv-a", Title: "t1", Messages: `[]`,
	}))
	// 同键再次 upsert。
	require.NoError(t, UpsertPlaygroundConversation(&PlaygroundConversation{
		UserId: 100, ClientId: "conv-a", Title: "t2", Messages: `[{"role":"user","content":"hi"}]`,
	}))

	convos, err := ListPlaygroundConversationsByUser(100)
	require.NoError(t, err)
	require.Len(t, convos, 1)
	assert.Equal(t, "t2", convos[0].Title)
	assert.Contains(t, convos[0].Messages, "hi")

	// 不同用户同 clientId 是独立行。
	require.NoError(t, UpsertPlaygroundConversation(&PlaygroundConversation{
		UserId: 101, ClientId: "conv-a", Title: "t3", Messages: `[]`,
	}))
	convos, err = ListPlaygroundConversationsByUser(100)
	require.NoError(t, err)
	require.Len(t, convos, 1)
	convos101, err := ListPlaygroundConversationsByUser(101)
	require.NoError(t, err)
	require.Len(t, convos101, 1)

	// 软删后查不到。
	affected, err := DeletePlaygroundConversationByClientId(100, "conv-a")
	require.NoError(t, err)
	assert.Equal(t, int64(1), affected)
	_, err = GetPlaygroundConversationByClientId(100, "conv-a")
	assert.Error(t, err)
	// 软删不波及他人。
	_, err = GetPlaygroundConversationByClientId(101, "conv-a")
	assert.NoError(t, err)
}

// TestPlaygroundConversationMessagesBytes 保存时记录消息字节数；汇总只算本人活跃会话。
func TestPlaygroundConversationMessagesBytes(t *testing.T) {
	openPlaygroundConversationTestDB(t)
	msg1 := `[{"role":"user","content":"hello"}]`
	require.NoError(t, UpsertPlaygroundConversation(&PlaygroundConversation{
		UserId: 100, ClientId: "conv-bytes", Title: "t", Messages: msg1,
	}))
	conv, err := GetPlaygroundConversationByClientId(100, "conv-bytes")
	require.NoError(t, err)
	assert.Equal(t, int64(len(msg1)), conv.MessagesBytes)

	// 更新同 client_id 后字节数随新消息刷新。
	msg2 := `[{"role":"user","content":"hello world again"}]`
	require.NoError(t, UpsertPlaygroundConversation(&PlaygroundConversation{
		UserId: 100, ClientId: "conv-bytes", Title: "t2", Messages: msg2,
	}))
	conv, err = GetPlaygroundConversationByClientId(100, "conv-bytes")
	require.NoError(t, err)
	assert.Equal(t, int64(len(msg2)), conv.MessagesBytes)

	// 汇总只算本人活跃会话；软删的会话不计入。
	sum, err := SumPlaygroundConversationSizesByUser(100)
	require.NoError(t, err)
	assert.Equal(t, int64(len(msg2)), sum)
	other, err := SumPlaygroundConversationSizesByUser(101)
	require.NoError(t, err)
	assert.Equal(t, int64(0), other)

	require.NoError(t, UpsertPlaygroundConversation(&PlaygroundConversation{
		UserId: 100, ClientId: "conv-bytes2", Title: "t3", Messages: msg1,
	}))
	sum, err = SumPlaygroundConversationSizesByUser(100)
	require.NoError(t, err)
	assert.Equal(t, int64(len(msg1)+len(msg2)), sum)
	_, err = DeletePlaygroundConversationByClientId(100, "conv-bytes2")
	require.NoError(t, err)
	sum, err = SumPlaygroundConversationSizesByUser(100)
	require.NoError(t, err)
	assert.Equal(t, int64(len(msg2)), sum)
}
