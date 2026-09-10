// @muw-owned
package model

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"
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
	Id           int   `json:"id"`
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
