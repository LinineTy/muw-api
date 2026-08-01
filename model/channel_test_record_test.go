package model

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAggregateChannelTestRecords(t *testing.T) {
	records := []ChannelTestRecord{
		{Id: 1, ChannelId: 1, ChannelName: "A", ModelName: "gpt-4o", Success: true, ResponseTime: 100, CreatedAt: 1000},
		{Id: 2, ChannelId: 1, ChannelName: "A", ModelName: "gpt-4o", Success: false, ResponseTime: 300, ErrorReason: "upstream 500", CreatedAt: 2000},
		{Id: 3, ChannelId: 1, ChannelName: "A", ModelName: "gpt-4o", Success: true, ResponseTime: 200, CreatedAt: 3000},
		{Id: 4, ChannelId: 1, ChannelName: "A", ModelName: "gpt-4o-mini", Success: false, ResponseTime: 500, ErrorReason: "timeout", CreatedAt: 1500},
		{Id: 5, ChannelId: 2, ChannelName: "B", ModelName: "gpt-4o", Success: true, ResponseTime: 50, CreatedAt: 2500},
	}

	rows := AggregateChannelTestRecords(records)
	require.Len(t, rows, 3)

	byKey := map[string]ModelHealthRow{}
	for _, row := range rows {
		byKey[fmt.Sprintf("%d|%s", row.ChannelId, row.ModelName)] = row
	}

	// Channel 1 × gpt-4o: 3 tests, 2 success, avg (100+300+200)/3=200.
	rowA := byKey["1|gpt-4o"]
	assert.Equal(t, 3, rowA.TestCount)
	assert.Equal(t, 2, rowA.SuccessCount)
	assert.InDelta(t, 66.7, rowA.SuccessRate, 0.1)
	assert.Equal(t, 200, rowA.AvgResponseTime)
	assert.Equal(t, 200, rowA.LastResponseTime) // newest probe succeeded at t=3000
	assert.Equal(t, int64(3000), rowA.LastTestTime)
	assert.Equal(t, "upstream 500", rowA.LastError) // most recent failure
	require.Len(t, rowA.Trend, 3)
	assert.False(t, rowA.Trend[1].Success)

	// Channel 1 × gpt-4o-mini: 1 test, failed.
	rowMini := byKey["1|gpt-4o-mini"]
	assert.Equal(t, 1, rowMini.TestCount)
	assert.InDelta(t, 0, rowMini.SuccessRate, 0.001)
	assert.Equal(t, "timeout", rowMini.LastError)

	// Channel 2 × gpt-4o: 1 test, success.
	rowB := byKey["2|gpt-4o"]
	assert.Equal(t, 1, rowB.TestCount)
	assert.InDelta(t, 100, rowB.SuccessRate, 0.001)
	assert.Equal(t, "", rowB.LastError)
}

func TestAggregateChannelTestRecordsTrendWindow(t *testing.T) {
	var records []ChannelTestRecord
	for i := 1; i <= 30; i++ {
		records = append(records, ChannelTestRecord{
			Id:           i,
			ChannelId:    1,
			ChannelName:  "A",
			ModelName:    "gpt-4o",
			Success:      i%2 == 0,
			ResponseTime: i,
			CreatedAt:    int64(1000 + i),
		})
	}

	rows := AggregateChannelTestRecords(records)
	require.Len(t, rows, 1)
	require.Len(t, rows[0].Trend, 20)
	// Trend keeps the newest probes (ids 11..30, ResponseTime == id).
	assert.Equal(t, 11, rows[0].Trend[0].ResponseTime)
	assert.Equal(t, 30, rows[0].Trend[19].ResponseTime)
	// Counts still reflect the whole window.
	assert.Equal(t, 30, rows[0].TestCount)
	assert.Equal(t, 15, rows[0].SuccessCount)
}

func TestAggregateChannelTestRecordsEmpty(t *testing.T) {
	rows := AggregateChannelTestRecords(nil)
	assert.Empty(t, rows)
}

func TestAggregateChannelTestRecordsUserTrafficSource(t *testing.T) {
	records := []ChannelTestRecord{
		{Id: 1, ChannelId: 1, ChannelName: "A", ModelName: "deepseek-chat", Success: true, ResponseTime: 100, Source: ChannelTestSourceUser, CreatedAt: 1000},
		{Id: 2, ChannelId: 1, ChannelName: "A", ModelName: "deepseek-chat", Success: false, ResponseTime: 400, ErrorReason: "upstream 500", Source: ChannelTestSourceUser, CreatedAt: 2000},
		{Id: 3, ChannelId: 1, ChannelName: "A", ModelName: "deepseek-chat", Success: true, ResponseTime: 150, Source: ChannelTestSourceTest, CreatedAt: 3000},
		{Id: 4, ChannelId: 1, ChannelName: "A", ModelName: "deepseek-chat", Success: true, ResponseTime: 120, Source: "", CreatedAt: 4000}, // legacy rows have no source
	}

	rows := AggregateChannelTestRecords(records)
	require.Len(t, rows, 1)
	row := rows[0]
	// UserTrafficCount counts only source == "user"; TestCount stays the total.
	assert.Equal(t, 4, row.TestCount)
	assert.Equal(t, 2, row.UserTrafficCount)
	// Success rate and latency still mix all records.
	assert.Equal(t, 3, row.SuccessCount)
	assert.InDelta(t, 75, row.SuccessRate, 0.1)
	assert.Equal(t, 193, row.AvgResponseTime) // round((100+400+150+120)/4) = 193
	// The most recent failure comes from the user-traffic record.
	assert.Equal(t, "upstream 500", row.LastError)
}

func TestAggregateChannelTestRecordsOrderIndependent(t *testing.T) {
	records := []ChannelTestRecord{
		{Id: 1, ChannelId: 1, ChannelName: "A", ModelName: "m", Success: true, ResponseTime: 100, CreatedAt: 2000},
		{Id: 2, ChannelId: 1, ChannelName: "A", ModelName: "m", Success: false, ResponseTime: 300, ErrorReason: "e", CreatedAt: 1000},
		{Id: 3, ChannelId: 1, ChannelName: "A", ModelName: "m", Success: true, ResponseTime: 200, CreatedAt: 3000},
	}
	shuffled := []ChannelTestRecord{
		records[2], records[0], records[1],
	}
	ordered := AggregateChannelTestRecords(records)
	unordered := AggregateChannelTestRecords(shuffled)

	require.Len(t, ordered, 1)
	require.Len(t, unordered, 1)
	a, b := ordered[0], unordered[0]
	assert.Equal(t, a.TestCount, b.TestCount)
	assert.Equal(t, a.SuccessCount, b.SuccessCount)
	assert.Equal(t, a.AvgResponseTime, b.AvgResponseTime)
	assert.Equal(t, a.LastResponseTime, b.LastResponseTime)
	assert.Equal(t, a.LastError, b.LastError)
	assert.Equal(t, a.LastTestTime, b.LastTestTime)
	require.Len(t, a.Trend, 3)
	require.Len(t, b.Trend, 3)
	assert.Equal(t, a.Trend[0].CreatedAt, b.Trend[0].CreatedAt)
	assert.Equal(t, a.Trend[2].CreatedAt, b.Trend[2].CreatedAt)
}
