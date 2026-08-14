package service

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
)

const (
	playgroundSpaceOrderCleanupInterval = 10 * time.Minute
)

// StartPlaygroundSpaceOrderCleanup periodically expires pending cloud space orders
// that exceeded the payment grace period (setting.PlaygroundSpacePendingOrderTTLSeconds).
// This frees the capacity reserved by the pending-订单预检, so a stuck pending order
// cannot permanently block later purchases. Only the master instance runs cleanup.
func StartPlaygroundSpaceOrderCleanup() {
	if !common.IsMasterNode {
		return
	}
	go func() {
		expireTimeoutPlaygroundSpaceOrders()
		ticker := time.NewTicker(playgroundSpaceOrderCleanupInterval)
		defer ticker.Stop()
		for range ticker.C {
			expireTimeoutPlaygroundSpaceOrders()
		}
	}()
}

// expireTimeoutPlaygroundSpaceOrders expires pending space orders older than the TTL.
// Failures are logged; the next tick retries.
func expireTimeoutPlaygroundSpaceOrders() {
	ttl := setting.PlaygroundSpacePendingOrderTTLSeconds
	if ttl < 1 {
		ttl = 3600
	}
	cutoff := time.Now().Unix() - ttl
	affected, err := model.ExpireTimeoutPlaygroundSpaceOrders(cutoff)
	if err != nil {
		common.SysError("expire pending playground space orders failed: " + err.Error())
		return
	}
	if affected > 0 {
		common.SysLog(fmt.Sprintf("expired %d timeout pending playground space orders", affected))
	}
}
