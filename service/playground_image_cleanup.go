package service

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
)

const (
	playgroundImageCleanupInterval  = time.Hour
	playgroundImageCleanupBatchSize = 500
)

// StartPlaygroundImageCleanup periodically removes transient playground images
// older than the configured TTL (setting.PlaygroundImageTTLDays). Permanent
// (user-saved) images are never touched. Only the master instance runs cleanup.
func StartPlaygroundImageCleanup() {
	if !common.IsMasterNode {
		return
	}
	go func() {
		cleanupPlaygroundImages()
		ticker := time.NewTicker(playgroundImageCleanupInterval)
		defer ticker.Stop()
		for range ticker.C {
			cleanupPlaygroundImages()
		}
	}()
}

// cleanupPlaygroundImages runs the scheduled TTL cleanup. Failures are logged;
// the next tick retries.
func cleanupPlaygroundImages() {
	ttlDays := setting.PlaygroundImageTTLDays
	if ttlDays < 1 {
		ttlDays = 1
	}
	if ttlDays > setting.MaxPlaygroundImageTTLDays {
		ttlDays = setting.MaxPlaygroundImageTTLDays
	}
	cutoff := time.Now().Add(-time.Duration(ttlDays) * 24 * time.Hour).Unix()
	if _, err := RunPlaygroundImageCleanup(cutoff); err != nil {
		common.SysError("playground image cleanup failed: " + err.Error())
	}
}

// RunPlaygroundImageCleanup hard-deletes transient playground images older than
// cutoff and best-effort removes their files, in batches. Returns the number of
// rows deleted. Used by the scheduled ticker and the admin cleanup endpoint.
func RunPlaygroundImageCleanup(cutoff int64) (int64, error) {
	var total int64
	for {
		rows, err := model.ListExpiredPlaygroundImages(cutoff, playgroundImageCleanupBatchSize)
		if err != nil {
			return total, err
		}
		if len(rows) == 0 {
			return total, nil
		}

		ids := make([]int, 0, len(rows))
		for _, row := range rows {
			ids = append(ids, row.Id)
		}

		affected, err := model.HardDeletePlaygroundImagesByIds(ids)
		if err != nil {
			return total, err
		}
		total += affected
		// 行删除成功后再删文件：若反过来（先删文件后删行），DB 删失败会导致
		// 「文件已丢、行仍在」的 404 残留且行仍占容量。先删行后删文件，DB 删
		// 失败时文件完整保留；文件删失败仅留下不占配额的孤儿文件，下次清理重试。
		for _, row := range rows {
			filename := fmt.Sprintf("%d.%s", row.Id, row.Ext)
			if err := os.Remove(filepath.Join(common.PrivateUploadDir, "playground-images", filename)); err != nil && !os.IsNotExist(err) {
				common.SysError(fmt.Sprintf("failed to remove playground image file %s: %s", filename, err.Error()))
			}
		}
		if len(rows) < playgroundImageCleanupBatchSize {
			return total, nil
		}
	}
}
