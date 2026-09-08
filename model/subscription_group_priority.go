package model

import (
	"encoding/json"
	"strings"
	"sync"
)

// 订阅组优先级：组名 → 优先级（数字越大越高，未配置 = 0）。
//
// 功能是配置驱动的两态：
//   - legacy 态（SubscriptionGroupPriorities 为空，SubscriptionGroupPrioritiesEnabled()=false）：
//     购买时组无条件切到套餐 upgrade_group；到期/取消按各订阅的 downgrade_group /
//     prev_user_group 逐订阅 legacy 回退（有其他活跃升级订阅撑组则保组），无优先级比较。
//   - 锚点态（已配置组优先级）：组 = 现存最高锚点。锚点来自 active 订阅的
//     upgrade_group 与"自然到期但仍锚"的钉子订阅（upgrade_group == downgrade_group，
//     永久档）；cancelled/deleted 不贡献。生命周期事件后由 settleUserSubscriptionGroupTx
//     重算，彻底无锚时按 ended 订阅降级目标兜底。统一语义：
//   - 购买/切换改组：priority(目标) ≥ priority(当前) 才改——低级订阅不拉低当前组，
//     同级放行（跟随用户主动选择）；高买低照常升级。
//   - 钉子（升 X 降 X）订阅自然到期不掉档，用户钉在该档；同互斥组买降级目标更低
//     的订阅替换、管理端作废或立即取消才解钉。
//   - 非钉子订阅到期只释放自己，组回落到其余现存最高锚点；彻底断档按它的
//     downgrade_group → prev_user_group → default 兜底。
//
// 运营在系统设置 SubscriptionGroupPriorities 配 JSON，如 {"v2":30,"v1":20}。
var (
	subscriptionGroupPriorityMu sync.RWMutex
	subscriptionGroupPriorities = map[string]int{}
)

// SetSubscriptionGroupPrioritiesFromJSON 从 JSON 字符串加载组优先级（option 热更新入口）。
func SetSubscriptionGroupPrioritiesFromJSON(jsonStr string) error {
	m := map[string]int{}
	if s := strings.TrimSpace(jsonStr); s != "" {
		if err := json.Unmarshal([]byte(s), &m); err != nil {
			return err
		}
	}
	subscriptionGroupPriorityMu.Lock()
	subscriptionGroupPriorities = m
	subscriptionGroupPriorityMu.Unlock()
	return nil
}

// SubscriptionGroupPriorities2JSONString 导出当前配置（option 读取入口）。
func SubscriptionGroupPriorities2JSONString() string {
	subscriptionGroupPriorityMu.RLock()
	defer subscriptionGroupPriorityMu.RUnlock()
	data, err := json.Marshal(subscriptionGroupPriorities)
	if err != nil {
		return "{}"
	}
	return string(data)
}

// GroupPriority 返回组优先级，未配置的组 = 0（含 default）。
func GroupPriority(group string) int {
	subscriptionGroupPriorityMu.RLock()
	defer subscriptionGroupPriorityMu.RUnlock()
	return subscriptionGroupPriorities[group]
}

// SubscriptionGroupPrioritiesEnabled 运营是否配置了组优先级。未配置 = 功能整体关闭：
// 降级路径必须跳过全部优先级比较（含"同级拦"），组回退走 legacy 语义——否则"未配置
// 全为 0"会把"同级不降"误伤成"过期永不回退"，用户被永久卡在升级组（2026-09-09
// LazyExpire 系列测试在 main 上暴露的存量回归）。
func SubscriptionGroupPrioritiesEnabled() bool {
	subscriptionGroupPriorityMu.RLock()
	defer subscriptionGroupPriorityMu.RUnlock()
	return len(subscriptionGroupPriorities) > 0
}
