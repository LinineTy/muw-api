# 上游同步 v3：本 fork 的有意分歧清单

分支 `merge/upstream-20260921`（对齐上游 `9c293e8c0`，本批 75 个提交）。

本文件记录**本 fork 有意与上游不同**的地方，供下次同步时对照。
**这些差异不是漏合并，而是刻意取舍** —— 同步时不要因为"上游有/上游改了"就自动采纳；
遇到冲突先看本文件，没有列到的再按"能采纳就采纳"处理。

代码级的分点说明还有第二层：仓库里 8 个文件带 `MERGE-DECISION:` 行内注释
（`router/api-router.go`、`service/log_info_generate.go`、`web/src/features/channels/constants.ts`、
`web/src/features/models/components/{models-columns,models-dialogs,models-provider,section-registry}.tsx`、
`web/src/features/system-settings/models/upstream-ratio-sync.tsx`）。

---

## 一、本 fork 有意删除、上游仍在维护的文件

| 文件 | 为什么删 | 下次同步怎么做 |
|---|---|---|
| `web/src/features/models/components/dialogs/update-config-dialog.tsx` | 本 fork 的模型页是自建单页卡片流，不挂这个弹窗 | 保持删除（modify/delete 冲突时选删除） |
| `web/src/features/models/components/dialogs/view-details-dialog.tsx` | 同上 | 保持删除 |
| `web/src/features/wallet/components/dialogs/billing-history-dialog.tsx` | 本 fork 钱包页自建，不挂这个弹窗 | 保持删除 |
| `web/src/features/pricing/__tests__/model-cards.test.tsx` | 测的是上游定价卡片组件；本 fork 的卡片是自建版本 | 保持删除 |
| `web/src/features/pricing/__tests__/pricing-controls.test.tsx` | 同上 | 保持删除 |
| `web/src/features/pricing/components/model-perf-badge.tsx` | 卡片性能徽标（延迟/吞吐/成功率 24 小时点条）。本 fork 的定价卡片是自建版、不挂该组件 → 全仓无任何引用，确认不接回后删除 | 保持删除（上游仍在改它，会遇到 modify/delete，选删除） |

> 说明：**上游本批自己也删了** `common/quota.go`（信任额度改为可配置项
> `quota_setting.trust_quota_usd`）、`relay/channel/ali/image.go`、`relay/channel/ali/image_wan.go`
> （图片计费搬到 alibaba 插件）、`setting/model_setting/qwen.go`。这些跟随上游即可，不算分歧。

## 二、本 fork 保留自己实现的文件（上游在同文件有改动，未整份采纳）

| 文件 | 保留原因 | 上游那次改的是什么 |
|---|---|---|
| `web/src/features/keys/components/api-keys-columns.tsx` | 本 fork 的列实现含自研列（批量操作等），整文件取我方 | `9c3d3aeb3` 图标懒加载 + 减少重渲染 |
| `web/src/features/models/components/models-columns.tsx` | 同上（本 fork 供应商列 / 自研厂商管理） | 同上 |
| `web/src/features/users/components/users-columns.tsx` | 同上 | 同上 |
| `web/src/features/pricing/components/model-card.tsx` | 本 fork 的定价卡片是自建布局 | 同上 |
| `web/src/features/pricing/components/model-card-grid.tsx` | 同上 | 同上 |
| `web/src/features/channels/constants.ts` | 渠道编号必须与后端一致：**vLLM/SGLang 用 64/65**（上游定为 62/63，与本 fork 的 OpenCode Zen(62)/Task Plugin(63) 撞号）；同时保留本 fork 的 `CHANNEL_TYPE_BASE_URL_TIPS` / `CHANNEL_TYPE_WARNINGS` 表 | `8529f209c` 新增 vLLM/SGLang 渠道 |
| `web/src/features/system-settings/general/system-info-section.tsx` | 本 fork 该区块没有上游的 `About` / `HomePageContent` / `legal.*`（已迁到站点设置），故只采纳上游新增的 `general_setting.docs_link` 字段 | `3fdf9083d` 文档链接挪到站点设置 |
| `web/src/features/system-settings/site/section-registry.tsx` | 去掉上游对 `legal.*` 的映射（本 fork 的 schema 无该字段） | 同上 |
| `web/src/features/channels/components/model-mapping-editor.tsx` | 采用上游重写后的结构，但保留本 fork 的表头 i18n key（`Request Model` / `Upstream Model`） | `0cde9d94f` 模型重定向工作台 |
| `web/src/features/channels/components/drawers/channel-mutate-drawer.tsx` | 采用上游新的 `useChannelModelDiscovery`（preview/saved 两种请求）结构，本 fork 的 `formPreviewFetcher`/`fetchChannelAvailableModels` 已被等价取代并删除 | `6b638788c` 上游模型预览 |
| `web/src/i18n/static-keys.ts` | 本 fork 去掉上游列表里的重复键（含相邻重复的 `User updated successfully`），保留首次出现 | 上游仍带重复 |
| `web/src/components/ui/combobox-input.tsx` | 包裹层由 `relative` 改为 `relative flex items-center`：上游重写模型重定向行时删掉了行容器的 `items-center`，行高被 `h-10` 删除按钮撑到 40px 而输入框 32px 顶对齐，指示器按包裹层居中 ⇒ 比输入框中心低 4px。改包裹层后同心（实测 delta 4px→0），且输入框在行内回到居中 | `0cde9d94f` / 上游重写 |

**渠道编号对照表（前后端必须一致）**

| 编号 | 本 fork | 上游 |
|---|---|---|
| 61 | SenseNova | SenseNova |
| 62 | OpenCode Zen | vLLM |
| 63 | Task Plugin | SGLang |
| 64 | vLLM（顺延） | — |
| 65 | SGLang（顺延） | — |

改编号时必须同时改 `constant/channel.go` 与 `web/src/features/channels/constants.ts`，
并确认前端一律走 `CHANNEL_TYPE_*` 常量、不要出现硬编码数字。

## 三、测试夹具类适配（不是分歧，但每次同步都会遇到）

本 fork 的组件签名/数据模型与上游不同，上游新增测试常需要就地适配，照旧处理即可：

- `ApiKeysPrimaryButtons` 在本 fork 多两个必填 props（`batchMode` / `onBatchModeChange`，自研"批量操作"开关）；
- `GroupRatioVisualEditor` 在本 fork 多三个 props（`section` / `onSectionChange` / `defaultUseAutoGroupField`）；
- 用量日志的计费来源/订阅字段在本 fork 是订阅窗口模型（无上游的 `amount_total` / `amount_used`）；
- 弹层布局判据以本 fork 的 `@/components/dialog` 基类为准（`overflow-x-hidden` + `overflow-y-auto` + `max-h-(--dialog-available-height)`）。

## 四、本 fork 的自研功能（上游没有的部分）

功能清单与说明见 [`README.muw.md`](../README.muw.md) 的「主要增强」「精简项」两节；
自研文件在首行带 `// @muw-owned` 标记（版权检查脚本据此豁免）。
同步时的原则：**上游新功能一律采纳，本 fork 自研功能一处不丢**，冲突逐处人工判读。
