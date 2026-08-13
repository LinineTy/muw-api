package setting

// Playground image storage settings. These values are the defaults and are
// overridable by an admin through the settings page; model/option.go registers
// them and dispatches changes back into these vars (hot-reloaded by SyncOptions).
const (
	DefaultPlaygroundImageTTLDays = 3 // 临时附件 TTL（天）

	// Deprecated: 统一容量模型后不再强制按数量/单类字节设限（见下）。
	// 保留默认值仅供存量 DB option 行解析，业务已改用 UserSpace* 容量。
	DefaultPlaygroundImageMaxCountPerUser     = 50
	DefaultPlaygroundImageMaxTotalMBPerUser   = 50
	DefaultPlaygroundImageMaxPermanentPerUser = 100

	// 用户云空间容量模型：
	// 每用户容量 = 初始容量（管理员全局统一，不看分组）+ 购买容量（余额 quota 购买）。
	// 临时+永久图片合并计到这一个总空间；root 无限制。
	DefaultUserSpaceInitialMB     = 20     // 每用户初始容量（MB）
	DefaultUserSpacePurchaseRatio = 0.0002 // 每 MB 展示货币价格（默认 $0.0002/MB，≈旧 100 quota/MB）
	DefaultUserSpaceMaxPurchaseMB = 1024   // 单次购买容量上限（MB）
	DefaultUserSpaceGlobalMaxMB   = 20480  // 云空间总分配量（红线）：固定分配，如服务器 50G 给云空间划 20G

	// 设置上界：防止 time.Duration 溢出与 MB<<20 字节换算溢出（validateOptionValue 校验用）。
	MaxPlaygroundImageTTLDays      = 3650   // TTL 天数上限（10 年），防 Duration 溢出把全部临时图误清
	MaxPlaygroundImageMaxCount     = 100000 // 兼容存量 option 行的宽松上界
	MaxPlaygroundImageMaxTotalMB   = 1 << 20
	MaxPlaygroundImageMaxPermanent = 100000
	MaxUserSpaceInitialMB          = 1 << 20
	MaxUserSpaceMaxPurchaseMB      = 1 << 20
	MaxUserSpaceGlobalMaxMB        = 1 << 20
)

var (
	// PlaygroundImageTTLDays is the retention for transient (non-permanent)
	// playground images; expired rows/files are removed by the cleanup job.
	PlaygroundImageTTLDays = DefaultPlaygroundImageTTLDays

	// Deprecated: 统一容量模型后不再强制，保留仅为兼容存量 DB option 行。
	PlaygroundImageMaxCountPerUser     = DefaultPlaygroundImageMaxCountPerUser
	PlaygroundImageMaxTotalBytesPerUser = DefaultPlaygroundImageMaxTotalMBPerUser << 20
	PlaygroundImageMaxPermanentPerUser = DefaultPlaygroundImageMaxPermanentPerUser

	// UserSpaceInitialMB 每用户初始容量（MB）。0 视为用全局默认，容量取
	// SpaceCapacity>0 ? SpaceCapacity : InitialMB<<20。
	UserSpaceInitialMB = DefaultUserSpaceInitialMB
	// UserSpacePurchaseRatio 每 MB 的展示货币价格（如 $X/MB 或 X tokens/MB）。
	// 扣减时按展示货币→原始额度换算（见 controller/playground_space.go）。
	UserSpacePurchaseRatio = DefaultUserSpacePurchaseRatio
	// UserSpaceMaxPurchaseMB 单次购买容量的上限（MB），管理员可调。
	UserSpaceMaxPurchaseMB = DefaultUserSpaceMaxPurchaseMB
	// UserSpaceGlobalMaxMB 云空间总分配量（红线）：全部用户云空间文件总字节达到
	// 该值即拒绝普通用户上传（固定分配，非磁盘剩余空间）。图床（image_assets）不计入。
	UserSpaceGlobalMaxMB = DefaultUserSpaceGlobalMaxMB
)
