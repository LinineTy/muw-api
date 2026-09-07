/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package model

import (
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// TestSQLiteConcurrentReadThenWriteNoBusy 用生产 SQLitePath 的查询参数（WAL +
// busy_timeout + _txlock=immediate）验证并发「事务内先读后写」不会产生 SQLITE_BUSY。
// 回归：DSN 缺 _txlock=immediate 时，多连接在 WAL 下因读快照过期会瞬间报
// database is locked(5/517)——busy handler 对该场景无效，表现为订阅/计费写库失败。
func TestSQLiteConcurrentReadThenWriteNoBusy(t *testing.T) {
	_, query, ok := strings.Cut(common.SQLitePath, "?")
	require.True(t, ok, "SQLitePath 应带查询参数")
	dsn := fmt.Sprintf("file:%s?%s", filepath.Join(t.TempDir(), "race.db"), query)

	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	defer sqlDB.Close()
	sqlDB.SetMaxOpenConns(8)
	sqlDB.SetMaxIdleConns(8)
	require.NoError(t, db.AutoMigrate(&UserSubscription{}))

	sub := &UserSubscription{UserId: 1, PeriodUsed: 0, Status: "active"}
	require.NoError(t, db.Create(sub).Error)

	var errCount int64
	var wg sync.WaitGroup
	const workers = 8
	const perWorker = 50
	for g := 0; g < workers; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < perWorker; i++ {
				err := db.Transaction(func(tx *gorm.DB) error {
					var s UserSubscription
					if err := tx.First(&s, sub.Id).Error; err != nil {
						return err
					}
					s.PeriodUsed++
					return tx.Save(&s).Error
				})
				if err != nil {
					atomic.AddInt64(&errCount, 1)
				}
			}
		}()
	}
	wg.Wait()
	require.Zero(t, errCount, "并发事务内先读后写不应产生 SQLITE_BUSY（DSN 需带 _txlock=immediate）")
}
