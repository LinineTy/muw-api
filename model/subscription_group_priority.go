package model

import (
	"encoding/json"
	"strings"
	"sync"
)

// 订阅组优先级：组名 → 优先级（数字越大越高，未配置 = 0）。
// 统一不变量（maintainer 2026-09-08 拍板"都大于等于"）：
//   - 购买/切换改组：priority(目标) ≥ priority(当前) 才改——低级订阅不拉低当前组，
//     同级放行（跟随用户主动选择）；高买低照常升级。
//   - 过期/取消降级：priority(目标) ≥ priority(当前) 一律不降（同级也拦）；
//     其他活跃订阅撑着更高组时，优先降到那个组而不是底组。
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
