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
			filename := fmt.Sprintf("%d.%s", row.Id, row.Ext)
			if err := os.Remove(filepath.Join(common.PrivateUploadDir, "playground-images", filename)); err != nil && !os.IsNotExist(err) {
				common.SysError(fmt.Sprintf("failed to remove playground image file %s: %s", filename, err.Error()))
			}
		}

		affected, err := model.HardDeletePlaygroundImagesByIds(ids)
		if err != nil {
			return total, err
		}
		total += affected
		if len(rows) < playgroundImageCleanupBatchSize {
			return total, nil
		}
	}
}
