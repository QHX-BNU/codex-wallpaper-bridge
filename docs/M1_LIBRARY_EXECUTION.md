# M1-A 导入与库管理执行记录

日期：2026-10-09。对应 [补全计划](FEATURE_COMPLETION_PLAN.md) M1-01–05；当前状态见 [执行状态](FEATURE_COMPLETION_STATUS.md)。

## 1. 范围与检查点

- 用户最新指令：“直接开始执行计划 M1”。本 Wave 实施 M1-A，改变此前先 M0 的**开发顺序**，不把 M0-05、Store/EXE 双宿主验收或发行门禁标为通过；M2 未解锁。
- M1-01–04：**代码与自动化通过**。M1-05：**开发中，部分隔离工作台验证**。M1-B 的 06–10 未开始，M1 整阶段未完成。
- 保留既有未提交的 M0 修改；未提交/推送 Git，未生成/替换发行 EXE，未改日常配置，未连接/启动/关闭真实 Codex，未修改 WE 原始文件。
- `SPEC.md` 的底座场景继续回归；本 Wave 新增业务行为以补全计划 M1-A 为依据，不声称原 SPEC 已完整描述 M1。

## 2. 实现与追踪

| 任务 | 实现 | 主要文件/证据 |
|---|---|---|
| M1-01 | schemaVersion=2；旧配置原文备份；image 模型、媒体路由、选择与解码 | `bridge-runtime/src/config-store.mjs`、`library-policy.mjs`、`media-server.mjs`；配置/HTTP 测试与隔离 renderer |
| M1-02 | JPG/JPEG/PNG/MP4 流式上传；签名/容器/长度校验；SHA-256 去重；进度与取消 | `bridge-runtime/src/asset-library.mjs`、`bridge-runtime/public/app.js`；导入/取消测试与真实 Chromium File input |
| M1-03 | 只操作索引中的受管文件；目录归属、链接与哈希保护；删除暂存与保存失败回滚；目录复制核验后切换 | `asset-library.mjs`；删除/迁移失败、取消、外来目录和变化文件测试 |
| M1-04 | 单张/批量隐藏、单张/全部恢复；分级覆盖与候选统一；选中项失效后协调 | `library-policy.mjs`、`media-server.mjs`、CLI 与注入计划；分级/选择/媒体路由测试 |
| M1-05 | 340 全量测试、构建、隔离 Electron 11 项步骤 | 下方证据；完整重启、视频时间推进、双宿主仍未验证 |

资源库为服务端配置真源。`library` 保存 `directory/assets/hiddenIds/ratings/allowedRatings`，普通配置 API 仅开放内容规则，不接受调用方伪造索引、目录或隐藏元数据。配置保存继续串行，成功落盘后才提交内存，损坏/未来版本不静默覆写。旧无版本/v1 配置首次保存前保留原文 `.legacy-*.bak`。

### 受管文件与迁移

- 默认目录是配置文件旁的 `assets/`。每个库使用 `.cwb-library.json` 归属标记；文件名为 SHA-256 加白名单扩展名，ID 为 `upload:<sha256>`。
- 移除只接受索引中的导入资源，校验目录、普通文件、大小与哈希；先改名暂存，配置保存失败恢复原文件。后续磁盘清理失败返回 `cleanupPending=true`，工作台显示清理未完成，不假报完全删除。
- 迁移输入必须是已有绝对父目录；目标为其中的 `CodexWallpaperBridge-library`。只复制索引文件并核验，成功后切换配置；取消/失败清理本次新文件，原目录有效。外来库、非受管非空目标或同名不同内容文件拒绝。
- **旧目录与副本保留供回退**，迁移不是剪切；未知文件与 WE 项目不动。后续“移除”只删除当前目录的受管副本，不删除迁移旧副本。

### 统一候选与注入边界

- Everyone / PG13 / Mature / 未分级共四种规则；默认全部允许，导入默认未分级。WE 元数据可由本地分级覆盖，但不改 WE 源文件。
- 网格、直接选择、CLI 默认选择/重扫、注入计划和媒体入口共用候选规则；隐藏/禁用分级项不能绕过选择接口播放。未来 M1-08 的轮播必须复用，**轮播尚未实现**。
- 资源索引/目录是控制面状态，不进入 CDP。仍保持 bootstrap <100 KiB、apply <10 KiB，大媒体走 token-scoped loopback Range。
- override 同名文件是权威修改源，包含 `bridge-overrides/public/electron-host.js`；同步后的 runtime 一致性有测试。CLI/注入计划在两种源码位置共用 `library-policy.mjs`。
- 工作台保存串行；资源 POST/PUT 和任务忙碌状态参与“应用到 Codex”握手。移除/迁移用 HTML `<dialog>`，不调用会被桌面 iframe sandbox 阻止的 `window.confirm()`。

### 选择与取舍

| 决策 | 采用方案与代价 | 未采用方案 / 后续条件 |
|---|---|---|
| 大文件导入 | Chromium File 直接上传、Node 流式写入/哈希，有背压和进度；任务记录不持久化 | 不读完整 arrayBuffer/Base64，不将字节塞入 CDP；强杀残留回收和续传须另补实现/证据 |
| 目录迁移 | 复制→校验→配置切换，保留旧目录；代价为额外磁盘空间 | 不直接移动或清空旧目录，避免中途占用/失败影响回退；自动清理旧库须单独设计与验收 |
| 候选规则 | 服务端统一库策略，多个入口共享 | 不只在 UI 隐藏卡片；若后续列表/轮播旁路策略，必须补回归再计完成 |
| 内嵌确认 | HTML dialog，不扩宽 iframe sandbox 权限 | 不添加 `allow-modals` 来绕过原隔离边界；完整 file-origin 桌面 IPC 待真实验收 |

## 3. 工作台操作

1. 运行当前源码 `npm start`，点击“导入 JPG / PNG / MP4”。需要分级时先展开“库管理与内容规则”，设置“导入默认分级”。可多选，逐文件执行；取消停止当前任务与后续文件，已完成项目保留。
2. 用卡片的管理勾选框和“隐藏所选”管理显示；勾选“已隐藏”进入恢复视图，支持单张恢复或“恢复全部隐藏”。隐藏不是删除。
3. 在卡片选择分级，或设置允许显示/播放的分级。当前壁纸失效时选择合法候选；无候选时进入空态。
4. 导入资源卡片的“移除”确认后删除当前受管副本；原始 WE 卡片不提供此删除能力。
5. 输入已有绝对父目录，点击“复制、验证并切换目录”，确认后观察进度。成功后查看“实际资源目录”，旧目录保留供回退。

上限：单文件 **20 GiB**、资源索引 **10000 项**、任务记录最多 **64 项**；网格每次显示 **60 张**并支持“显示更多”。API 批量管理每次最多 100 个已有 ID。MP4 只校验文件/容器，不保证编码支持。

### 资源 API 契约摘要

所有路径位于本次服务的 token-scoped base path 下；写请求拒绝跨 Origin。上传不走 JSON/Base64。

| 方法 / 相对路径 | 输入与行为 |
|---|---|
| `GET api/library` | 返回实际目录与 busy；目录只供控制页，不注入到 CDP |
| `POST api/library/jobs` | `{kind:"import", filename, size, rating}` 或 `{kind:"migrate", directory}`；返回 202 与 job |
| `PUT api/library/jobs/{id}/content` | `application/octet-stream` 原始文件流；若声明 Content-Length，必须与任务 size 一致 |
| `GET api/library/jobs/{id}` | 读取 status/bytes/total/result/error/cancellable；completed/failed/cancelled 是终态 |
| `POST api/library/jobs/{id}/cancel` | 取消未进入 committing 的任务；提交阶段不允许中途破坏一致性 |
| `POST api/library/manage` | hide/restore/restore-all/rating/remove，传 ids；remove 只允许单个导入 ID |

常见拒绝：400 输入/文件校验、403 跨 Origin、404 任务或资源不存在、409 库忙碌/退出、413 大小或索引上限、415 非二进制上传、429 任务记录上限。资源元数据落盘后 Codex 同步失败返回 502 与 `saved=true`，不能误称文件回滚。上传内容接口返回 HTTP 200 时仍须检查 `job.status`，不以 HTTP 成功代表导入成功。

## 4. 验证证据

证据根目录：`out/m1-20261009-library/`，本机保留且 gitignored。无截图、mock 或单测被计入真实 Codex 双宿主通过。

| 验证 | 命令 / 记录 | 结果 |
|---|---|---|
| 改前基线 | `node --test`；`baseline-unsandboxed.tap` | 315/315；沙箱内 `baseline.tap` 为 291/315，24 个环境失败保留 |
| 最新全量 | `node --test`；`delivery-node-test.tap` | **340 pass / 0 fail / 0 skip**，退出码 0 |
| 同步与构建 | `npm run sync:bridge`、`npm run build:app`；`final-build.log` | 通过，仅构建 dist，未生成发行 EXE |
| 语法与编译入口 | `node --check`、`node dist/bridge-runtime/src/cli.mjs --help`、`git diff --check` | 通过，不接入 Codex |
| 隔离 Electron | `node_modules/electron/dist/electron.exe scripts/verify-m1-library-ui.cjs`；`electron-1791539851579/report.json` | **11 项步骤通过**，退出码 0，mediaServerClosed=true |
| helper 收尾复核 | `post-helper-check-20261009T100409821Z.json` | 只读查询 helperCount=0；未停止任何真实 Codex |

新增回归集中在 `test/asset-library.test.mjs`、`library-policy.test.mjs`、`library-http.test.mjs`、`electron-host-library.test.mjs`，并扩展配置与 CLI 生命周期回归。反例包括扩展名伪装、截断 MP4、超大/空文件、流长度不符、取消中断、配置保存失败、变化内容、外来目录/链接、目标冲突、伪造配置索引、跨 Origin 与宿主同步失败。

### 隔离 UI 的 11 项步骤

环境：Electron **44.1.1** / Chromium **152.0.7977.65**；全新隔离 profile/config/assets/fixture renderer，不连接真实 Codex。

1. 真正 Chromium File input 导入有效 PNG/JPG，通过 HTTP 流式写入。
2. 同内容再次导入去重，不增加第二个资源。
3. 实际点击卡片，工作台图片解码成功。
4. 生产 bootstrap/apply 在受控 renderer 的媒体子页面解码图片，restore 释放节点。
5. 实际 UI 批量隐藏与单张恢复，原始文件不删除。
6. 未分级 checkbox 排除并恢复候选。
7. 实际 UI 迁移，核验新副本/目录切换与旧副本保留。
8. 工作台重新加载和**新 ConfigStore 读盘**保留索引/位置/策略；不是完整程序重启。
9. 实际 UI 移除确认只删除当前索引的受管副本。
10. 只读复制真实 WE MP4 到隔离夹具，经 File input 导入 **713019 bytes**，视频 Range 206/内容校验通过；**不证明播放时间推进**。
11. 同桌面 sandbox flags、无 allow-modals 的 iframe 中，HTML dialog 确认/取消及资源写入通过。采用**同源测试 wrapper**，不是实际 file-origin 桌面 IPC 全链路。

最终截图：`electron-1791539851579/embedded-workbench.png`，已检查 IMAGE / VIDEO 卡片与库管理布局；截图不作为可见播放或真实双宿主证据。报告明确 `videoPlaybackVerified=false`、`codexHostsVerified=false`、`completeM0Gate=false`。

### 失败与排除记录

- 最早 helper 初始化卡住；一次 PNG 夹具无效使 JPEG 输出为空，修正夹具后重测。记录保留，不删除早期失败。
- 一次窗口自动退出虽返回 0，但没有最终报告，**不计完整通过**。helper 已显式处理 window-all-closed，最终必须写 report 再退出。
- `electron-1791539339767` 在额外 iframe 验证阶段未完成，另一次 `Page.captureScreenshot(fromSurface=false)` 产生黑图。具体卡住的 native 调用未证实；原 `harness-failure.json` 原文保留，独立 `harness-failure-clarification.json` 撤销确定根因表述。后改为有限超时、两次原生截图和同源 wrapper，最终通过仅覆盖已列范围。
- 卡住的自有 Node/Electron 树按脚本、工作区二进制、创建时间与父子关系精确停止，未按 EXE 路径批量关闭 Codex。最终成功 helper 自行销毁窗口、关闭媒体服务并 exit(0)。
- 沙箱内 Windows CIM 复核曾不可访问，不将查询失败当作“无残留”；同一只读查询在沙箱外得到 helperCount=0，并保存独立记录。

## 5. 未完成与恢复

**2026-10-10 更新**：以下未开始口径是 10 月 9 日 M1-A 交付时的历史快照。现 M1-06–09 已完成代码与隔离验证（366/366 全量、播放/列表/过场 Electron 11 项）；M1-05/10 完整重启和双宿主验收未通过。最新实现、实机失败、保留证据与续做位置以 [M1 播放执行记录](M1_PLAYBACK_EXECUTION.md) 为准，不以旧快照判断当前状态。

- M1-B 全部未开始：取景/缩放/数值复位、倍速/镜像/声音、扩展效果、统一 prepare/commit/cancel、播放列表/WE 列表导入、轮播及七种过场。
- M0-05 剩余人工流程、Store safe/媒体引用采集问题，以及 M1 新增流程在 Store/EXE 的同步/恢复/完整程序重启未验收。
- 任务状态只在内存；已测常规取消、正常 close 和失败清理，**未实现/验证强杀、断电残留回收或断点续传**。跨盘/Windows 文件占用/磁盘断电及多进程同时写配置也未实机验收。
- 未验证所有 MP4 编码或视频可见时间推进；导入校验、Range 和图片区解码不能替代此证据。
- 未执行完整编译桌面程序的实机回归或发行验收。下一 Wave 从 M1-06 开始，再串行实施 M1-07–10；M0 与新增双宿主验收仍须闭环。

### 回滚与保留

- 改前代码/文档备份在 `out/m1-20261009-library/before/`，文档收尾前另备份于 `before-docs/`，原工作区状态见 `before-status.txt`。不要整仓 reset 或直接用 HEAD 覆盖原有 M0 修改；只撤销本 Wave 自有差异，再同步/构建/回归。
- schema v1 程序不能直接读 v2 配置；降级前保留当前 v2 配置和受管资源，再按原文 `.legacy-*.bak` 恢复旧配置。备份不包含迁移后新增的所有状态，不自动丢弃新资源。
- 旧迁移目录、隔离 profile、成功/失败记录均保留；不自动递归删除，不自动写入 `.ai-memory`。

## 6. 资料来源

- `docs/FEATURE_COMPLETION_PLAN.md` / M1-A：本 Wave 验收边界；`SPEC.md` / Scenario 4、6、8、10：底座注入/恢复/握手/payload 回归。
- `bridge-runtime/src/config-store.mjs:10`：schema 与默认值；`bridge-runtime/src/library-policy.mjs:46`：分级/隐藏策略。
- `bridge-runtime/src/asset-library.mjs:79`、`:148`、`:334`：资源归属、导入任务与迁移。
- `bridge-runtime/src/media-server.mjs:805`：资源 API；`bridge-runtime/public/app.js:692`、`:727`：保存状态与内嵌确认。
- `bridge-overrides/src/injection-plan.mjs:60`：库策略与精简 payload；`bridge-overrides/public/electron-host.js:64`：资源任务保存握手。
- 上述测试、最终 TAP、Electron report 与 helper 只读收尾记录：结果与未验证项的直接证据。
