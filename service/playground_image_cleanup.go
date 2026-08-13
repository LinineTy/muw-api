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

// cleanupPlaygroundImages hard-deletes expired rows and best-effort removes their
// files. Batched to bound lock/memory; stops on the first DB error and retries
// on the next tick. Files are removed first so a surviving orphan file is harmless.
func cleanupPlaygroundImages() {
	ttlDays := setting.PlaygroundImageTTLDays
	if ttlDays < 1 {
		ttlDays = 1
	}
	cutoff := time.Now().Add(-time.Duration(ttlDays) * 24 * time.Hour).Unix()

	for {
		rows, err := model.ListExpiredPlaygroundImages(cutoff, playgroundImageCleanupBatchSize)
		if err != nil {
			common.SysError("failed to list expired playground images: " + err.Error())
			return
		}
		if len(rows) == 0 {
			return
		}

		ids := make([]int, 0, len(rows))
		for _, row := range rows {
			ids = append(ids, row.Id)
			filename := fmt.Sprintf("%d.%s", row.Id, row.Ext)
			if err := os.Remove(filepath.Join(common.PrivateUploadDir, "playground-images", filename)); err != nil && !os.IsNotExist(err) {
				common.SysError(fmt.Sprintf("failed to remove playground image file %s: %s", filename, err.Error()))
			}
		}

		if _, err := model.HardDeletePlaygroundImagesByIds(ids); err != nil {
			common.SysError("failed to hard-delete expired playground images: " + err.Error())
			return
		}
		if len(rows) < playgroundImageCleanupBatchSize {
			return
		}
	}
}
