package opencodezen

const ChannelName = "opencodezen"

// PublicApiKey 是 OpenCode Zen 免费额度的匿名哨兵 key。
// 渠道未填密钥时使用该 key 访问免费套餐。
const PublicApiKey = "public"

// ModelList 留空：OpenCode Zen 免费/付费模型集合会变动，
// 通过上游 /v1/models 动态获取。
var ModelList = []string{}
