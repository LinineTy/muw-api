package setting

// Playground image storage settings. These values are the defaults and are
// overridable by an admin through the settings page; model/option.go registers
// them and dispatches changes back into these vars (hot-reloaded by SyncOptions).
const (
	DefaultPlaygroundImageTTLDays             = 3   // 临时附件 TTL（天）
	DefaultPlaygroundImageMaxCountPerUser     = 50  // 临时图片数量上限
	DefaultPlaygroundImageMaxTotalMBPerUser   = 50  // 临时图片总容量上限（MB）
	DefaultPlaygroundImageMaxPermanentPerUser = 100 // 永久收藏图片数量上限
)

var (
	// PlaygroundImageTTLDays is the retention for transient (non-permanent)
	// playground images; expired rows/files are removed by the cleanup job.
	PlaygroundImageTTLDays = DefaultPlaygroundImageTTLDays
	// PlaygroundImageMaxCountPerUser caps transient images per user.
	PlaygroundImageMaxCountPerUser = DefaultPlaygroundImageMaxCountPerUser
	// PlaygroundImageMaxTotalBytesPerUser caps total transient bytes per user.
	PlaygroundImageMaxTotalBytesPerUser = DefaultPlaygroundImageMaxTotalMBPerUser << 20
	// PlaygroundImageMaxPermanentPerUser caps permanent saved images per user.
	PlaygroundImageMaxPermanentPerUser = DefaultPlaygroundImageMaxPermanentPerUser
)
