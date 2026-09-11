// @muw-owned
package model

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relaykit/types"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ChannelAccount 渠道与账户的多对多绑定（凭证与渠道解耦，账户 N:N）。
//
// 语义：一个渠道可绑多个账户（用法与渠道自身的多 key 一致——按 AccountOrder 轮询、
// Enabled 单个启停、失败切走），一个账户可被多个渠道绑（同一凭证复用，套餐余量按
// 账户只查一次）。
//
// 与 channels.account_id 的关系：该列是 Phase 2 的单值遗留，本表取代它成为绑定关系的
// 唯一真相源；channels.account_id 只读兼容（迁移完成后删除）。读路径一律走本表。
//
// AccountOrder：轮询顺序（升序；同序号按 id 稳定排序）。Enabled：该渠道是否启用该
// 账户——这是 (渠道, 账户) 维度的状态，不能放在账户上（同一账户在 A 渠道停用、在
// B 渠道仍可用）。不用 gorm default 标签（仓库规则），创建路径显式赋值。
type ChannelAccount struct {
	Id int `json:"id"`
	// 复合唯一键 (channel_id, account_id)：同一渠道对同一账户只能有一条绑定
	// （OnConflict 幂等绑定的前提）。列级 index 供反查。
	ChannelId    int   `json:"channel_id" gorm:"index;uniqueIndex:idx_channel_accounts_pair;not null"`
	AccountId    int   `json:"account_id" gorm:"index;uniqueIndex:idx_channel_accounts_pair;not null"`
	AccountOrder int   `json:"account_order"`
	Enabled      bool  `json:"enabled"`
	CreatedTime  int64 `json:"created_time" gorm:"bigint"`
}

func (ChannelAccount) TableName() string { return "channel_accounts" }

// getChannelAccountBindingsWithDB 按渠道取绑定，返回顺序即轮询顺序（order 升序、id 兜底，
// 保证同序号的相对次序稳定）。
func getChannelAccountBindingsWithDB(db *gorm.DB, channelId int) ([]*ChannelAccount, error) {
	var bindings []*ChannelAccount
	if channelId <= 0 {
		return bindings, nil
	}
	err := db.Where("channel_id = ?", channelId).
		Order("account_order asc, id asc").
		Find(&bindings).Error
	return bindings, err
}

// GetChannelAccountBindings 渠道的账户绑定（按轮询顺序）。
func GetChannelAccountBindings(channelId int) ([]*ChannelAccount, error) {
	return getChannelAccountBindingsWithDB(DB, channelId)
}

// GetBoundAccountIdsByChannel 渠道绑定的账户 id（含停用的，按轮询顺序）。
func GetBoundAccountIdsByChannel(channelId int) ([]int, error) {
	bindings, err := GetChannelAccountBindings(channelId)
	if err != nil {
		return nil, err
	}
	ids := make([]int, 0, len(bindings))
	for _, b := range bindings {
		ids = append(ids, b.AccountId)
	}
	return ids, nil
}

// GetEnabledBoundAccountIdsByChannel 渠道可轮询的账户 id（enabled 且账户未被全局禁用）。
// Phase B 的选路入口，Phase A 只用于取"主账户"。
func GetEnabledBoundAccountIdsByChannel(channelId int) ([]int, error) {
	bindings, err := GetChannelAccountBindings(channelId)
	if err != nil {
		return nil, err
	}
	if len(bindings) == 0 {
		return nil, nil
	}
	enabledIds := make([]int, 0, len(bindings))
	for _, b := range bindings {
		if b.Enabled {
			enabledIds = append(enabledIds, b.AccountId)
		}
	}
	if len(enabledIds) == 0 {
		return nil, nil
	}
	accounts, err := GetAccountsByIds(enabledIds)
	if err != nil {
		return nil, err
	}
	usable := make(map[int]bool, len(accounts))
	for _, acc := range accounts {
		if acc.Status == common.ChannelStatusEnabled {
			usable[acc.Id] = true
		}
	}
	ids := make([]int, 0, len(enabledIds))
	for _, id := range enabledIds {
		if usable[id] {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

// GetPrimaryBoundAccountId 渠道的"主账户"= 轮询顺序里第一个启用且可用的绑定。
// Phase A 用它保持单账户行为与 Phase 2 完全一致；无绑定（迁移未跑到）时回退
// channels.account_id，保证迁移过程中不断流。
func GetPrimaryBoundAccountId(channelId int) (int, error) {
	if channelId <= 0 {
		return 0, nil
	}
	ids, err := GetEnabledBoundAccountIdsByChannel(channelId)
	if err != nil {
		return 0, err
	}
	if len(ids) > 0 {
		return ids[0], nil
	}
	var accountId int
	if err := DB.Model(&Channel{}).Select("account_id").Where("id = ?", channelId).
		Scan(&accountId).Error; err != nil {
		return 0, err
	}
	return accountId, nil
}

// BindChannelAccountWithDB 幂等绑定：不存在则插入，已存在则只更新轮询顺序（保留该渠道
// 对账户的启停状态，不覆盖）。
func BindChannelAccountWithDB(db *gorm.DB, channelId, accountId, order int) error {
	if channelId <= 0 || accountId <= 0 {
		return nil
	}
	binding := &ChannelAccount{
		ChannelId:    channelId,
		AccountId:    accountId,
		AccountOrder: order,
		Enabled:      true,
		CreatedTime:  common.GetTimestamp(),
	}
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "channel_id"}, {Name: "account_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"account_order"}),
	}).Create(binding).Error
}

// BindingSpec 一条绑定的写入意图（顺序即轮询顺序，Enabled 为渠道内启停）。
type BindingSpec struct {
	AccountID int
	Enabled   bool
}

// ReplaceChannelAccountBindingsWithSpecs 覆盖式写入（带渠道内启停状态）：列表里的绑定
// 按其 Enabled 落库（已有绑定也会被显式更新，与 ReplaceChannelAccountBindings 的
// "保留原状态"不同——这是 UI 显式提交的场景）。
func ReplaceChannelAccountBindingsWithSpecs(channelId int, specs []BindingSpec) error {
	if channelId <= 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := replaceChannelAccountBindingsWithDB(tx, channelId, specAccountIDs(specs)); err != nil {
			return err
		}
		for _, spec := range specs {
			if spec.AccountID <= 0 {
				continue
			}
			if err := tx.Model(&ChannelAccount{}).
				Where("channel_id = ? AND account_id = ?", channelId, spec.AccountID).
				Update("enabled", spec.Enabled).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func specAccountIDs(specs []BindingSpec) []int {
	ids := make([]int, 0, len(specs))
	for _, spec := range specs {
		if spec.AccountID > 0 {
			ids = append(ids, spec.AccountID)
		}
	}
	return ids
}

// ReplaceChannelAccountBindings 覆盖式写入渠道的绑定列表（新建/编辑渠道的写入口）：
//   - 列表里已有的绑定：保留其 Enabled 状态，只更新轮询顺序；
//   - 列表里新增的：Enabled=true；
//   - 不在列表里的：删除（渠道不再使用该账户）。
//
// 顺序即传入顺序（account_order = 下标）。
func ReplaceChannelAccountBindings(channelId int, accountIds []int) error {
	if channelId <= 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		return replaceChannelAccountBindingsWithDB(tx, channelId, accountIds)
	})
}

func replaceChannelAccountBindingsWithDB(tx *gorm.DB, channelId int, accountIds []int) error {
	existing, err := getChannelAccountBindingsWithDB(tx, channelId)
	if err != nil {
		return err
	}
	keep := make(map[int]int, len(accountIds))
	for i, id := range accountIds {
		if id > 0 {
			keep[id] = i
		}
	}
	// 删除不再使用的绑定（含重复项：同一 account 只留一条）
	seen := make(map[int]bool, len(existing))
	for _, b := range existing {
		_, wanted := keep[b.AccountId]
		if !wanted || seen[b.AccountId] {
			if err := tx.Delete(&ChannelAccount{}, "id = ?", b.Id).Error; err != nil {
				return err
			}
			continue
		}
		seen[b.AccountId] = true
	}
	for _, b := range existing {
		order, wanted := keep[b.AccountId]
		if !wanted {
			continue
		}
		if b.AccountOrder != order {
			if err := tx.Model(&ChannelAccount{}).Where("id = ?", b.Id).
				Update("account_order", order).Error; err != nil {
				return err
			}
		}
	}
	for i, id := range accountIds {
		if id <= 0 {
			continue
		}
		if err := BindChannelAccountWithDB(tx, channelId, id, i); err != nil {
			return err
		}
	}
	return nil
}

// DeleteChannelAccountBindings 删除渠道的全部绑定（渠道删除时调用）。
func DeleteChannelAccountBindings(db *gorm.DB, channelId int) error {
	if channelId <= 0 {
		return nil
	}
	return db.Delete(&ChannelAccount{}, "channel_id = ?", channelId).Error
}

// GetChannelsBoundToAccount 反查：引用了某账户的渠道（换绑/删除账户前的确认视图、
// 账户类型同步）。按绑定表查，替代原先扫 channels.account_id。
func GetChannelsBoundToAccount(accountId int) ([]*Channel, error) {
	if accountId <= 0 {
		return []*Channel{}, nil
	}
	var channels []*Channel
	err := DB.Model(&Channel{}).
		Joins("JOIN channel_accounts ON channel_accounts.channel_id = channels.id").
		Where("channel_accounts.account_id = ?", accountId).
		Order("channels.id asc").
		Find(&channels).Error
	return channels, err
}

// CountChannelsBoundToAccount 账户被多少渠道引用（删除账户前校验）。
func CountChannelsBoundToAccount(accountId int) (int64, error) {
	var count int64
	if accountId <= 0 {
		return 0, nil
	}
	err := DB.Model(&ChannelAccount{}).Where("account_id = ?", accountId).Count(&count).Error
	return count, err
}

// CountChannelAccountBindingMap 全量账户引用计数（账户列表展示用：id -> 引用渠道数）。
func CountChannelAccountBindingMap() (map[int]int64, error) {
	type row struct {
		AccountId int   `gorm:"column:account_id"`
		Count     int64 `gorm:"column:count"`
	}
	var rows []row
	err := DB.Model(&ChannelAccount{}).
		Select("account_id, count(*) as count").
		Group("account_id").Find(&rows).Error
	if err != nil {
		return nil, err
	}
	res := make(map[int]int64, len(rows))
	for _, r := range rows {
		res[r.AccountId] = r.Count
	}
	return res, nil
}

// ── 迁移：建表 + 存量绑定回填 ──────────────────────────────────

// ensureChannelAccountsTable 幂等建 channel_accounts 表（含唯一键）。理由同其它
// ensure*：DB 已是最新迁移戳时启动走"跳过 AutoMigrate"路径，需显式补表。
func ensureChannelAccountsTable(db *gorm.DB) error {
	if db.Migrator().HasTable(&ChannelAccount{}) {
		return nil
	}
	if err := db.Migrator().CreateTable(&ChannelAccount{}); err != nil {
		return err
	}
	// 唯一键：同一渠道对同一账户只能有一条绑定（CreateTable 按 struct tag 建索引，
	// 复合唯一键这里显式补，老库/分支库都收敛到同一形状）。
	if !db.Migrator().HasIndex(&ChannelAccount{}, "idx_channel_accounts_pair") {
		if err := db.Exec("CREATE UNIQUE INDEX idx_channel_accounts_pair ON channel_accounts (channel_id, account_id)").Error; err != nil {
			common.SysLog(fmt.Sprintf("create idx_channel_accounts_pair failed: %v", err))
		}
	}
	return nil
}

// ensureChannelAccountBindings 存量绑定回填：channels.account_id>0 但绑定表里没有记录的
// 渠道，补一条绑定（顺序 0、启用）。幂等；单渠道失败记日志继续，下轮启动重试。
// 迁移完成后 channels.account_id 删除，本函数随之失效（保留一个版本周期）。
func ensureChannelAccountBindings(db *gorm.DB) error {
	if !db.Migrator().HasTable(&ChannelAccount{}) || !db.Migrator().HasColumn(&Channel{}, "account_id") {
		return nil
	}
	type pending struct {
		ChannelId int
		AccountId int
	}
	var rows []pending
	if err := db.Model(&Channel{}).
		Select("channels.id as channel_id, channels.account_id as account_id").
		Where("channels.account_id > 0").
		Where("NOT EXISTS (SELECT 1 FROM channel_accounts ca WHERE ca.channel_id = channels.id)").
		Scan(&rows).Error; err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}
	failed := 0
	for _, r := range rows {
		err := db.Transaction(func(tx *gorm.DB) error {
			return BindChannelAccountWithDB(tx, r.ChannelId, r.AccountId, 0)
		})
		if err != nil {
			failed++
			common.SysLog(fmt.Sprintf("channel account binding backfill failed: %v", err))
		}
	}
	if failed > 0 {
		common.SysLog(fmt.Sprintf("channel account binding backfill: %d bound, %d failed (will retry on next startup)", len(rows)-failed, failed))
	} else {
		common.SysLog(fmt.Sprintf("channel account binding backfill: %d channels bound", len(rows)))
	}
	return nil
}

// syncPrimaryBindingFromChannelColumn 把 channels.account_id 的单值镜像进绑定表。
//
// Phase A 双写：controller 的绑定/换绑/复制/新建路径照旧写 channels.account_id，由这里
// 收敛出对应绑定行，使绑定表成为读路径真相源。
//   - 渠道还没有绑定 → 建一条 order=0、启用的绑定；
//   - 恰好一条绑定且指向别的账户 → 换成新账户（保留原 order/enabled）；
//   - 已有多条绑定 → 不动（多账户的写入口在后续阶段收敛到绑定表，这里不能误删用户配置）。
func syncPrimaryBindingFromChannelColumn(channelId, accountId int) error {
	if channelId <= 0 || accountId <= 0 {
		return nil
	}
	bindings, err := GetChannelAccountBindings(channelId)
	if err != nil {
		return err
	}
	if len(bindings) == 0 {
		return BindChannelAccountWithDB(DB, channelId, accountId, 0)
	}
	if len(bindings) == 1 && bindings[0].AccountId != accountId {
		old := bindings[0]
		return DB.Transaction(func(tx *gorm.DB) error {
			if err := tx.Delete(&ChannelAccount{}, "id = ?", old.Id).Error; err != nil {
				return err
			}
			binding := &ChannelAccount{
				ChannelId:    channelId,
				AccountId:    accountId,
				AccountOrder: old.AccountOrder,
				Enabled:      old.Enabled,
				CreatedTime:  common.GetTimestamp(),
			}
			return tx.Create(binding).Error
		})
	}
	return nil
}

// DeleteChannelAccountBindingsForChannels 批量删除渠道的绑定（批量删除渠道时调用）。
func DeleteChannelAccountBindingsForChannels(db *gorm.DB, channelIds []int) error {
	if len(channelIds) == 0 {
		return nil
	}
	return db.Delete(&ChannelAccount{}, "channel_id IN ?", channelIds).Error
}

// ── 多账户选路（Phase B）──────────────────────────────────────

// channelAccountRotation 账户层轮询游标（渠道维度、进程内）。与"多 key 轮询索引"不同，
// 账户轮询没有跨重启需要保持的语义，进程内自增即可，不产生 DB 写。
var channelAccountRotation sync.Map // channelId -> *atomic.Int64

func nextAccountRotation(channelId, n int) int {
	if n <= 0 {
		return 0
	}
	value, _ := channelAccountRotation.LoadOrStore(channelId, new(atomic.Int64))
	counter, ok := value.(*atomic.Int64)
	if !ok {
		return 0
	}
	seq := counter.Add(1)
	if seq <= 0 {
		return 0
	}
	return int((seq - 1) % int64(n))
}

// getNextKeyAcrossAccounts 账户层轮询：从渠道游标起，按绑定顺序找第一个能给出可用 key 的
// 账户；跳过被全局禁用的账户（渠道内停用的绑定在挂载时已剔除）。
//
// 全部不可用 → 返回 no available key 错误。调用方（middleware/distributor）据此把渠道
// 置为不可用，语义与单账户渠道"key 全废"一致——即"绑定的账户全不可用，渠道才不可用"。
func (channel *Channel) getNextKeyAcrossAccounts() (string, int, *types.NewAPIError) {
	accounts := channel.BoundAccounts
	n := len(accounts)
	if n == 0 {
		return "", 0, types.NewError(errors.New("no bound accounts"), types.ErrorCodeChannelNoAvailableKey)
	}
	start := nextAccountRotation(channel.Id, n)
	for i := 0; i < n; i++ {
		account := accounts[(start+i)%n]
		if account == nil || account.Status != common.ChannelStatusEnabled {
			continue
		}
		key, keyIndex, apiErr := account.GetNextEnabledKey()
		if apiErr != nil {
			// 该账户的 key 全不可用：换下一个账户（不在这里改账户状态，交给既有
			// 多 key 失败计数/套餐自动启停逻辑处置）。
			continue
		}
		// 空 key 对"允许空密钥"的渠道（如 OpenCode Zen 免费套餐）是合法凭证，
		// 不能当"没可用 key"跳过，否则这类渠道挂上账户后必然报 no available account keys。
		if strings.TrimSpace(key) == "" && !constant.ChannelTypeAllowsEmptyKey(channel.Type) {
			continue
		}
		return key, keyIndex, nil
	}
	return "", 0, types.NewError(errors.New("no available account keys"), types.ErrorCodeChannelNoAvailableKey)
}

// HasUsableBoundAccount 渠道是否还有可用账户（渠道内启用的绑定 + 账户未被全局禁用）。
// 套餐自动启停据此决定"要不要把渠道也置为不可用"：账户烧完只让渠道选路跳过它，
// 只有当绑定账户全废时渠道才不可用（避免一个账户拖垮共享它的其它渠道）。
func HasUsableBoundAccount(channelId int) (bool, error) {
	ids, err := GetEnabledBoundAccountIdsByChannel(channelId)
	if err != nil {
		return false, err
	}
	return len(ids) > 0, nil
}

// BoundAccountView 绑定关系视图（渠道抽屉回显用）：绑定本身的启停状态 + 账户摘要。
// 与 BoundAccounts（只含启用项、供选路）不同，这里含停用项，前端才能把开关恢复。
type BoundAccountView struct {
	AccountId int     `json:"account_id"`
	Enabled   bool    `json:"enabled"`
	Name      string  `json:"name"`
	Type      int     `json:"type"`
	Status    int     `json:"status"`
	KeyMasked string  `json:"key_masked"`
	BaseURL   *string `json:"base_url"`
	// 编码套餐配置在账户上：渠道侧的余量卡据此判断该渠道是否在监控、自动控制开没开。
	CodingPlanProvider    *string `json:"coding_plan_provider,omitempty"`
	CodingPlanAutoControl bool    `json:"coding_plan_auto_control,omitempty"`
}

// buildBoundAccountViews 按绑定顺序构造视图（账户缺失时保留绑定行、摘要素空，
// 让前端能看见这张"坏绑定"并删除）。
func buildBoundAccountViews(bindings []*ChannelAccount, accounts map[int]*Account) []BoundAccountView {
	if len(bindings) == 0 {
		return nil
	}
	views := make([]BoundAccountView, 0, len(bindings))
	for _, b := range bindings {
		view := BoundAccountView{AccountId: b.AccountId, Enabled: b.Enabled}
		if acc := accounts[b.AccountId]; acc != nil {
			view.Name = acc.Name
			view.Type = acc.Type
			view.Status = acc.Status
			view.KeyMasked = acc.KeyMasked
			view.BaseURL = acc.BaseURL
			view.CodingPlanProvider = acc.CodingPlanProvider
			view.CodingPlanAutoControl = acc.CodingPlanAutoControl != nil && *acc.CodingPlanAutoControl
		}
		views = append(views, view)
	}
	return views
}

// LoadBoundAccountViews 单渠道填充视图（详情接口路径）。
func (channel *Channel) LoadBoundAccountViews() {
	bindings, err := GetChannelAccountBindings(channel.Id)
	if err != nil || len(bindings) == 0 {
		return
	}
	ids := make([]int, 0, len(bindings))
	for _, b := range bindings {
		ids = append(ids, b.AccountId)
	}
	accounts, err := GetAccountsByIds(ids)
	if err != nil {
		return
	}
	byId := make(map[int]*Account, len(accounts))
	for _, acc := range accounts {
		prefillAccountMasked(acc)
		byId[acc.Id] = acc
	}
	channel.BoundAccountViews = buildBoundAccountViews(bindings, byId)
}
