# 功能补全执行状态

日期：2026-10-15。对应 [全量计划](FEATURE_COMPLETION_PLAN.md)。

## 当前结论

- **2026-10-15 M3 后台收口（最新）**：补工作台视频在loadeddata→首帧之间切为手动/隐藏/电池暂停时卡加载，以及取消/失败回调释放；修复系统媒体helper退出/启动失败后相同设置不能显式重试，保留不自动重启和不重放控制。10文件专项 **74/74**，真实隐藏power-only helper + 编译HTTP保存恢复 **9/9**，两helper自然退出、`forcedStops=0`；内存增长与长期资源测试按用户决定后置。本轮不前置、不下载ffmpeg、不打包EXE、不跑全量；临时验证文件自动删除。M3源码01–06已交付，宿主可见/物理/转码/发行等验收及M3-07仍未完成。见 [M3后台收口](M3_BACKGROUND_CLOSURE_20261015.md)；下面各轮数字独立，不相加。
- **2026-10-15 M3 源码与后台续做（前轮）**：在线歌词状态/取消/本地覆盖竞态、重复媒体回调及关闭后同曲重开修复，10文件专项 **97/97**、真实在线歌词 **6/6**、不前置系统媒体→offscreen Web **14/14**，隔离编译/HTTP通过。恢复原失败已定点确认系统当前会话在远程pause后切换，Web暂停恢复改为独立测试且保持原断言，不控制日常播放器。截图6个F盘测试目录约 **960MiB** 及本轮scratch已清理；只保留小型证据/备份。历史10分钟与最新60秒资源分解已记录，JS/DOM基本稳定但进程内存仍增长，长期资源不标通过。遵从不前置、不下载ffmpeg、不打包EXE、不跑全量；双宿主可见首帧/完整恢复/宿主自然退出、物理电源/设备、真实转码、长期性能和发行仍开放，**M3-07与整阶段未完成**。详见 [M3源码与后台续做](M3_FOLLOWUP_20261015.md)。
- **2026-10-15 M3 前轮剩余项交付（历史）**：修复 GSMTC 封面 COM `Size` 误判及普通视频策略暂停/解码中暂停的就绪竞态，runtime v2 已同步；仅13文件专项 **95/95**，独立压缩/混淆4种 bootstrap 通过。真实系统媒体 **26/26**、不前置的真实系统媒体→offscreen readonly Web 链 **14/14**，封面/歌词/控制/清空/暂停恢复与自建进程自然退出通过，另有约32秒 CPU/RSS/GPU/VRAM原始测量。用户确认之前是手动最小化测试窗口且**不希望前置**，收到后不再恢复/前置 Store/Local；宿主验收新增默认拒绝的前置 opt-in。该轮在线歌词等门禁未验；本轮更新见上，历史证据不拼接为同一次完整通过。详见 [M3剩余项交付](M3_REMAINING_20261015.md)。
- **2026-10-15 M3 前轮历史检查点（本轮更新见上）**：真实 D→F 跨物理盘、Windows 独占失败、`.part`/精确中断/journal/新 owner 恢复及 SHA 校验通过；真实 WASAPI 440/880 Hz、暂停归零、GSMTC 曲目/20秒时间线、本地 LRC、默认关闭控制、显式 pause/play/next/previous 与旧 session 拒绝已有通过证据。Store/Local 身份、隔离环境、应用及 Restore 通过。当时 GSMTC 封面0字节、Store视频 hidden/ready0、Local renderer可见性间歇失败，双宿主首帧、隐藏/恢复/省电和Web音乐回调未通过；两测试宿主未自然退出。后续已修复封面并验证背景Web，用户确认手动最小化；原始失败不覆盖。原M3专项60/60是历史。见 [M3实机验收](M3_LIVE_ACCEPTANCE.md)。
- **2026-10-14 M3-B的04–06源码子项已交付，整阶段未验收**：ffmpeg可选工具/任务/帧率/回退、虚拟Faststart和固定nonce版本Range、marker缓存复制/校验/根切换/中断恢复及工作台面板接通。最终18文件 **112/112**、语法15/15、独立压缩/混淆HTTP与源SHA验证通过。用户确认应未装工具，实际probe缺失，未安装；16MiB结构fixture不是可解码视频或Codex首帧，真实转码/硬件/跨物理盘/占用/强中断/双宿主与M3-07待验，不定义性能阈值。未操作Codex/真实系统媒体或发行EXE。见 [M3视频记录](M3_VIDEO_EXECUTION.md)。
- **2026-10-14 M3-A代码子项已交付，实机未验**：统一播放/隐藏/电池策略、Windows WASAPI/GSMTC producer、Scene/Web频谱、Web/工作台媒体/歌词与默认关闭的控制接通。最终23文件 **228/228**、语法33/33、隔离压缩/混淆4种bootstrap及4组同步SHA通过；当前DLL所有源关闭时协议/自然exit0与合成算法通过。未启用真实系统声音/播放器/在线歌词，未操作Store/Local或发行包；Scene只接频谱，完整Scene媒体API不冒称完成。M3-B后续源码进度见上，M0/M1/M2完整与发行门禁保持开放。见 [M3媒体记录](M3_MEDIA_EXECUTION.md)。
- **2026-10-14 Web缺失接口与目录属性代码已完成**：媒体封面/状态、播放枚举/官方元数据、fetchall目录通知、随机文件及目录选择/受管索引/CAS/重建/清空/默认接通；WE `file:///`安全别名、GPU/预览接线及桌面busy握手通过。最终17文件专项 **157/157**（约2.58秒）、语法40/40、隔离压缩编译/7项跨realm通过。未运行全量/VP8/长时或Store/Local，未改共享dist/发行包/日常配置。该5组代码子项不再列为未实现，实机视觉效果单列；该次M2任务不含OS producer；当前M3源码进度见M3媒体记录。见 [Web接口交付](M2_WEB_APIS.md)。M2整项3/8不是代码完成比例。
- **2026-10-14 文件类属性代码已完成**：真实 File 控件、受管资源 ID、按壁纸/属性保存、GPU/预览接线、重建后读取、热更新/清空/默认恢复及桌面保存握手；相关专项 **130/130**（13文件、约2.45秒）、语法21/21和隔离编译通过。没有跑 Store/Local、全量、VP8或长时测试，没有覆盖共享 dist/发行包。文件类属性不再是未实现项；具体效果实机验收单列，见 [文件属性交付](M2_AUTHOR_FILE_PROPERTIES.md)。M2 3/8仍是整项验收口径，不是代码完成比例。
- **2026-10-13 最新范围：GPU 直绘优先，VP8 暂停；仅相关专项，不跑全量测试。** 当前 Scene 默认 `direct-gpu`，共用工作台 readonly renderer 与 M1 切换；具有独立目标 CSP bypass/刷新/恢复流程，不能套用旧 VP8 的 CSP 结论。当前续做与每轮失败证据见 [GPU 续做记录](M2_COMPLETION_20261013.md)。未覆盖共享 dist、未替换发行 EXE。
- GPU build06 最新定点：Store **6/6**、Local **4/4 功能步骤通过**，同产品集合/compiled digest 的真实 pointer 消费和 Restore 后 CSP 实际拒绝；Local 另有隐藏/显示 **5/5**。已复现并修复隐藏 GPU 页面加载资源却无首帧、强制初始化导致 Apply 失败的同类路径：延后到可见时初始化，仍核验真实帧，并明确 deferredTargets。专项42/42，恢复文档等待验证器专项14/14；原 Apply/Restore 失败全部保留，不逆推旧失败唯一原因。五类作者 UI/实际读回是前轮证据，不能拼成完整双宿主 M2。测试 Codex仍需精确强停，M2仍 **3/8**；最新收尾见 [GPU续做记录](M2_COMPLETION_20261013.md)。
- 已把对照项目的缺口归并为 **23 个补全功能组**，全部保留在 M0–M6 台账中。
- 已执行 **M1-A/B、M2-A PoC 与 M2-B 开发/隔离验收**；M1-05/10 完整双宿主验收未通过。M2-01–03 限定可行性通过（Store/EXE VP8 PoC 各 13/13，M2 仍 **3/8**）。compiled CLI → owned UtilityProcess → native owner → 固定 VP8 → 身份核验 CDP → CPU canvas 已接入既有 M1 prepare/commit/cancel；**源码主链接通不等于完整双宿主验收通过**。M2-04–08整项未完成；M3-A及M3-B的04–06源码/专项已交付，实机与M3-07未验；M4–M6未开始，完整功能组仍 **0 / 23**。
- 用户确认验收目标为 **Store 版 + 本地 EXE 版**，并批准独立测试实例；不得关闭当前聊天或改日常配置。
- 上一轮限定交付为 **先交付 Store 修复**：修正 desktop main 内联 native host 导致的相对资源路径错误，并仅将合法 inject 的客户端等待/服务端 socket idle 扩为有界 60 秒。当时真实 compiled desktop → Store **6/6 功能步骤通过**，但保留一次切换取消解码事件及测试 Codex 强制收尾，**不标整个验收器或自然退出通过**。专项106/106、续做核心16/16；当时全量 **654 pass / 5 fail（659 项）** 是历史，快照缺口已于本轮专项补齐，不重跑全量。本地 EXE VP8 联运行旧失败保留；未生成或替换发行 EXE。
- **build-06 历史基线**：全量 **630/630**、ASAR02 的46 entries/29 unpacked/30 hash comparisons，以及同构建 Store/本地 EXE 限定生产流程各 **12/12/pass** 保留；这些不是本次新构建的双宿主或 packaged executable runtime 证据。原 Store `045435Z` config500 未确认根因，不因本次工作台保存修复而标已解决。`productionSwitchIntegrated=true` 仅源码接线；完整 `codexHostsVerified=false`、`completeM0Gate=false`，M2 仍 **3/8**。
- **M0 历史结果未改变**：两个真实宿主的现有窗口视频生命周期前次通过；后续本地 EXE 控制链路通过，Store 保存/应用/落盘/恢复通过但 safe 应用前媒体引用采集失败。原生托盘、新窗口/renderer 重建与人工输入/滚动的完整门禁仍未通过。
- 用户已要求完成 M2 剩余内容，授权独立可见双宿主测试及测试实例短时发声；此前 M1-A/B 开发例外不变。M0-05 不标通过、不授权发行、不替换当前聊天或日常配置。下一步补完整生产pointer/UI属性/fallback和长期CPU/RSS/GPU/VRAM、OS media；原Store切换500保留为未复现的历史间歇失败，已有固定枚举诊断但根因未确认。检查点见 [M2 引擎执行记录](M2_ENGINE_EXECUTION.md)、[M1 库管理执行记录](M1_LIBRARY_EXECUTION.md) 和 [M1 播放执行记录](M1_PLAYBACK_EXECUTION.md)。

## Store 桌面应用限定修复（2026-10-13 交付，2026-10-12 实测）

- 资源路径修复只 externalize source main 的确切 `./desktop-engine-host.mjs` import 到已有 compiled/unpacked 模块；不修改 vendor/public 资源、不放宽 CSP、renderer 首帧/身份验证或 CDP 15 秒命令时限。
- 双层等待修复：客户端 inject 默认60秒、其余动作15秒且显式 override 不变；服务端完成 token/方法/Origin/body/action/handler/busy 验证后，仅 inject response 获得60秒 idle，保留全局30秒 idle/10秒 headers。验证失败仍失败，不自动 retry、不清失败缓存。
- 最新实机 `out/live-acceptance/m2-desktop-apply-store-2026-10-12T10-21-38-012Z-c2c1b0a9/report.json`：新独立可见 Store + 实际工作台，Apply → native动态像素 → Scene/Web/Scene → Restore/Apply → 最终Restore，**6/6 功能步骤**。首次Apply约41.2秒、Restore/Apply组合约53.6秒；不是60FPS或完整作者属性/性能验收。
- **未通过边界**：切换期间10:22:53.499Z记录1次 `native-frame-error`，固定分类 `accept/decode`、`output/Unknown`、`cancelled/closed`。不能仅凭随后成功就宣称该事件无害或切换零错误。desktop exit0/UtilityProcess自然退出，但自有Codex需精确强制停止，`resourcesClosed=false`、整个验证器exit1。禁止将fixture收尾算自然退出/托盘门禁。
- 前次Store `09-47-59-596Z-c4b9814d` 在服务端idle修复前亦6/6且无native-frame-error，仅为历史；`09-37-12-565Z-a45db85d` 的15秒fetch失败保留。本地 `09-51-43-035Z-b3d408dc` 和 `10-07-18-618Z-4b063b4d` 仍失败；旧EXE独立CDP快查通过、同Scene工作台环境的只读probe出现 `Page.enable` 超时，具体底层根因未确认，不归为已证实GPU/编码故障。
- 证据根 `out/m2-desktop-native-path-fix-20261012T091512Z/`，deadline/idle后续在 `timeout-followup/`。正常权限全量659项654/5；沙箱560/99及审批服务额度导致一次专项未执行的事实保留。10月13日核心16/16、syntax10/10、compiled CLI help和diff通过；原专项106/106仍保留。5个全量失败均为已有缺失 `scripts/m2-compiled-snapshot.mjs` / production verifier未接 `freezeCompiledBuild`，不删测试、不改无关缺口。
- 10月13日独立只读收尾 `timeout-followup/post-cleanup-final-20261013.json`：11份报告/23个登记身份/测试端口无自有身份或监听残留，身份不可核验0；未停止任何进程。当前聊天精确身份、日常配置哈希保留，10项compiled/38项runtime哈希与最新Store报告一致。仅核查登记身份和端口，不宣称全部历史后代或长期VRAM归零。
- 用户加载方式：重新启动项目壁纸工作台加载新构建，再“应用到 Codex”；当前Codex无需关闭。旧发行EXE未更新，packaged executable runtime未验。排除3790869794、audio=false，WE原件只读；M2仍 **3/8**，M0/M1、完整双宿主/作者类型/长期性能与发行门禁不变。

## Scene 桌面壳 / 作者属性保存历史检查点（2026-10-12）

- 实际三层入口 `cwb-desktop://shell` → loopback 工作台 → 独立 Scene 首帧与动态画面通过；旧 `file:` 外壳与 Scene `frame-ancestors` 不匹配是原 `ERR_BLOCKED_BY_RESPONSE` 根因。内部协议只提供三项静态外壳资源，不允许任意 file 来源、不使用 bypassCSP；native/Codex 路线不放宽。
- 作者保存失败根因：面板读取后，选择/亮度等普通配置写入增加全局 revision，误拒绝作者 CAS。现按壁纸独立 revision；同壁纸并发/重复/ABA、整配置替换和 reload 失效保护仍在，有界 tombstone 达上限时安全失效旧 token，磁盘失败不提交值/版本。
- 工作台 Scene 通过精确 origin/source/channel/sequence 与单飞 request ACK 读取 `getProperties`，不把保存值当实际读回；超时/取消/无有效值均不伪报成功。面板标明 `workbench-preview`，**不代表 Codex 宿主读回验收**。初始化/重载先读面板、后 Scene 就绪的竞态通过合并延后 refresh 修复，不重复保存、不跨选择更新。
- 最终实机：`out/live-acceptance/m2-desktop-shell-2026-10-12T08-29-59-882Z-b05dcf6a/report.json` **7/7/pass**；blocked=0，desktop exitCode=0，UtilityProcess 自然退出，resourcesClosed=true，前后10项 compiled hash 一致。前一构建 `082534Z-bb09c755` 亦7/7；`081937Z-0731b342` 的重载面板未刷新失败及更早 CSP/验证器失败全部保留。
- 独立只读收尾：`author-followup/post-cleanup-final.json` 核查4份报告的8个PID/创建时间身份与8个端口，残留自有身份0/监听0，未停止任何进程。最终仓库diff与15文件增量空白检查通过。
- TDD/备份/最终命令证据：`out/m2-20261012-scene-shell-fix-1791790771949/author-followup/`。`targeted-final.tap` **85/85**；`full-final.tap` **648/653、5 fail**，缺 `scripts/m2-compiled-snapshot.mjs` 且 production verifier 尚未接 `freezeCompiledBuild`，本次未改这些文件。sync/build、syntax17/17、CLI help通过；详见执行记录。
- 仅允许样本1778944028/3444535389、audio=false；未选择3790869794，不改 WE 原件、日常配置、当前聊天、官方 CSP、发行 EXE，不 commit/push/package。M2 **3/8**、M0/M1、完整作者类型/双宿主 UI/长期性能/发行门禁不变。

## 同构建限定生产双宿主历史检查点（2026-10-12，build-06）

- **Store**：`out/live-acceptance/m2-store-20261012T064730Z-84f0333f/scene-report.json` **12/12/pass**；**本地EXE**：`m2-local-20261012T065424Z-0f6f4b94` **12/12/pass**。真实CLI/UtilityProcess/native/M1/CDP主链、短时音频活动、bool/slider落盘/engine-readback/reset、Scene/dark/Web切换、Web暂停恢复、reload、失败候选/源销毁保旧及显式retry、short soak和restore/utility自然退出均通过。完整pointer/属性面板UI/回退层级/WE API/OS media/长期GPU与VRAM仍未验。
- **旧Store500未复现，不标根因修复**。本轮新增固定枚举injection-failed日志只输出target ordinal/category/整数CDP码/mediaState/switchFailure，不记录URL/正文/标题/句柄；本轮诊断里的失败事件对应有意失败候选和cached retry负例，不冒作原属性切回失败复现。
- 数据面 ACK 吞吐：Store **4.68 FPS / p95 471.72ms**，Local **9.75 FPS / p95 71.19ms**；原≥4FPS/p95<750ms门槛未改。observedCompositorFps分别约**0.08/1.90**，同宿主实际截图变化另通过，**ACK不是持续屏幕FPS，更不是60FPS**。short soak分别64.6/64.8秒、4次切换，仅短时资源上限证据。
- `m2-store-20261012T064324Z-dc20f1a7` 传入workshop子目录而不是Steam根目录，扫描0项、启动阶段assert失败，未执行产品步骤。正确根D:/steam只读预检86项且允许样本均在，改参数新profile才复测；原失败/强制收尾保留，不计产品回归。
- 当前matrix metadata为**5Scene/2Web、3轮21次**，由实际数组推导、unit4/4；不冒称已重跑实机matrix，历史8/24不覆盖当前禁止样本策略。禁止3790869794未选择/播放，不改WE原件、日常配置、聊天、官方CSP、发行EXE，不commit/push/package。
- 全量630/630、build06、ASAR02、syntax15/15、CLI help/diff通过；检查点/备份在 `out/m2-20261012-preview-hd-01/`。M2仍**3/8**。

## Scene 高清预览历史检查点（2026-10-12，build-05）

- **测试排除**：不得选择或播放“泰拉身高体检”，ID `3790869794`；测试入口按 ID/归一化标题拒绝，不隐藏或删除日常素材。
- 工作台原图只读核验为 **254×254 preview.gif**。现在通过有界 readonly Scene lease、隔离 origin/WebGL 和 M1 首帧切换显示真实 Scene：Canvas **1920×1083 / DPR 1.5**。三个 fresh profile 各 **5/5**，renderer completion **61.18/61.33/61.01 FPS**（中位 61.18）；最新 build-05 再测 **5/5、61.29 FPS**。不是物理屏幕 FPS，也不是 Codex 数据面 60 FPS。稳定截图为 `workbench-2026-10-12T04-54-04-647Z-64fb8789/scene-workbench-after-sampling.png`，不是 first-submit 加载图。
- 最新本地生产：`out/live-acceptance/m2-local-20261012T045613Z-7a8b119c/scene-report.json` **12/12/pass**。Store：`m2-store-20261012T045435Z-1003a7af` overall fail，属性 bool/slider 保存/engine-readback/reset 均成功，最后切回 Scene 的 config500 原因待有界多 renderer 诊断，不能归为已确认的 source/context 故障。
- Codex 生产仍 **800×450/software VP8/CPU canvas**；Local 数据面 ACK 吞吐 **7.68 FPS / p95 197.72 ms**，Store 部分测量 **8.04 FPS / p95 198.86 ms**。Local observedCompositorFps=0、Store 约1.32，真实截图变化另通过；ACK 统计不是持续显示帧率，不宣传 Codex 端 60 FPS。
- 本轮自动化音频活动不等于新的人工听音确认；用户此前对约 **09:57:49** 的隔离音频和 **10:27:30** 的旧 Store 短时音频均回复“听到了”（旧 Store `022620Z-8fe69571`，`outputStartedAt=02:27:29.705Z`）。OS media 仍未验。
- `post-teardown-independent-check-02.json` 独立核验本轮 5 个生产目录身份、工作台06–10父进程和专用19636–19640监听为0，当前聊天身份保留；01 的 ISO 日期自动转换误报保留并解释。历史 PID22304/17496 的 EXE 身份不可核验，未强停，**不能宣称全部历史目录残留0**。
- 证据根 `out/m2-20261012-preview-hd-01/`；M2 仍 **3/8**，M0/M1、完整属性 UI/pointer/fallback、长期 CPU/RSS/GPU/VRAM 和发行门禁不变。

## M2 台账（截至2026-10-14，历史实机按原日期保留）

| 任务 | 当前状态 | 证据与边界 |
|---|---|---|
| M2-01 引擎锁定 | 已通过 | WebWallGL 2.1.0 精确 commit/hash；MIT 与 MPL-2.0 依赖分别保留许可证/归属/原版源码包；不声称重现上游构建 |
| M2-02 隔离渲染 | 真实隔离 GPU PoC 通过 | 独立只读 origin；真实 1,153,129-byte scene.pkg，13 层，最终落盘 PNG 像素变化 28.28%/12.96%，暂停变化 0；源码/构建各 7/7 |
| M2-03 Store/EXE | 限定可行性 PoC 通过 | 可信原生采集 → 隔离 VP8 编码 → CDP → 宿主 CPU 像素，各 13/13；800×450：EXE 6.56 FPS / p95 102 ms、Store 5.66 FPS / p95 119 ms，原 ≥4 FPS / p95 <750 ms 门槛通过；同一 13 层真实场景的视觉/控制/失败链，非完整引擎支持 |
| M2-04 | 开发/隔离验证中 | 45 Scene/3 Web 只读检查；两真实 Scene 特征及无 sleep/barrier 快速输入通过；3233141951 隔离实例 15% 音量约 5 秒，恢复静音且用户确认听到；完整样本库和生产 pointer/音频未验 |
| M2-05 | 双宿主限定生产流程通过，整项未完成 | 同一build06双宿主各12/12覆盖首帧、last-real-frame、候选失败保旧、禁止自动retry、显式retry、paused source销毁及restore；完整fallback层级待验，旧Store500根因未确认 |
| M2-06 | 本轮Web接口代码子项已完成，整项验收未完成 | 媒体封面/状态/播放枚举/官方元数据、目录通知/随机文件/安全资源别名，GPU/暂停/晚注册/退出接通，2026-10-14相关157/157。完整WE兼容及本轮视觉效果未实机验；该次M2任务不含OS producer，当前M3源码进度见M3媒体记录 |
| M2-07 | 文件/目录代码子项已完成，整项验收未完成 | 原五类属性保留分轮证据；2026-10-14补file及directory选择、受管资源/索引、CAS保存、热更新/读盘/清空/默认和桌面busy握手。文件任务130/130、本Web目录任务相关157/157不相加；Web只递送，本轮未跑Store/Local文件/目录效果或同构建完整验收 |
| M2-08 | 开发/隔离验证中 | 历史 5 Scene/3 Web、24 次 native 回归保留；当前排除后 5 Scene/2 Web，不追溯覆盖旧证据。双宿主生产约64.6/64.8秒short soak/4次切换通过，非长期CPU/RSS/GPU/VRAM |

- **B 接线基线证据**：`out/m2-20261010-compatibility/full-tests-sixteenth.tap` **544/544**（exit 0）、`build-seventeenth.log`、`cli-harness-green.tap` **61/61**；feature-14 两 Scene 快速输入 **10/10 + 9/9**。owner-properties-07 **10/10** 增加 failed candidate native 位图前/中/后完全相同、2→1 槽和恢复；native-matrix-02 **8 样本/24 次通过**（含合法暗场景），provider-ipc-02 **5/5** 实际 compiled desktop host/UtilityProcess/owner，host slots/peers=0。新增 CLI VM 依赖缺失的 9 项与沙箱 realpath/loopback 环境失败均保留；main/client 接线不等于 Scene/VP8/生产切换接通。全部失败、短时缓存和未验证项见 M2_ENGINE_EXECUTION.md 最新 B 小节。
- **B encoded 最新续做**：`electron-encoded-provider-03/report.json` **8/8 / pass**；`full-tests-seventeenth.tap` **564/564**、`encoded-raw-native-green.tap` **50/50**、`build-twentieth.log`。固定 native BGRA/VP8/client 路径已实现；真实 bright/dark/Web 的来源、暂停/恢复、2 owner 上限、实际 source 销毁取消和 utility exit 清理通过。01/02 的 PNG 热路径吞吐 2.39/2.42 FPS 失败保留，优化不删首次/截图或改原 ≥4 FPS/p95 <750 ms 门槛。codec 是独立惰性 context，最多 2 source + 2 codec，避免 Web inspector pause 停止编码；不是日常 CDP/宿主/M1 接通。独立收尾 `post-encoded-independent-check.json` 检查 30 目录无残留；下一步固定 VP8 host slot 与 M1 集成。细节、源/decoded PNG、哈希与审查见执行记录最新 encoded 节。

- 最终证据：`out/m2-20261010-engine/delivery-final-node-test.tap` **390/390**、`delivery-final-scene-unit.tap` **24/24**、`delivery-build.log`；源码 GPU 初验 `electron-controls-1791599861929/report.json`、最终构建 GPU `electron-delivery-png-1791603410565/report.json`。helper 启动边界 5/5、像素测量反例及加固后真实只读探测通过；跨目录独立收尾为 `post-teardown-independent-check.json`。
- 可见实机失败：`out/live-acceptance/m2-local-20261010T032025Z-fb06faf5/scene-report.json`、`m2-store-20261010T032257Z-f1a1925f/scene-report.json`。源码/构建 GPU 成功不能覆盖这些失败；本地没有独立运行时 CSP 事件，不冒用 Store 事件。
- 静态策略复核：`out/m2-20261010-engine/codex-static-policy-decoded.json`；EXE 应用 26.818.32112 / Chromium 151.0.7922.170，Store 包 26.1007.2314.0 / 应用 26.1007.21434 / Chromium 155.0.8059.40。
- 两份可见测试 `teardown-result.json` 均为残留/监听 0、当前聊天身份保留；场景 server 关闭、自有 DOM 移除。强制收尾不是原生托盘退出。隐藏/首帧/FPS 门禁、元数据收尾等失败和备份全部保留；详见引擎执行记录。
- **历史 PNG 数据面检查点**：`out/m2-20261010-frame-transfer/final-node-test.tap` 407/407、`final-m2-unit.tap` 41/41、`first-paint-green.tap` 23/23、`final-build.log`。两份当时最终实际报告为 `out/live-acceptance/m2-local-20261010T040239Z-af4f8e8e/scene-report.json`、`m2-store-20261010T040429Z-9062525b/scene-report.json`；功能各 12/13、性能失败不标完整通过。像素变化 28.77%/27.44% 和 21.41%/36.72%，暂停/失败保旧变化 0；各自 DOM/source/listener/test tree 清理，当前聊天保留。
- **失败未隐藏**：初轮高 DPI 尺寸、blob 性能、data 性能和 Store 重载黑帧失败均保留。现在明确进行 DPI 归一、源 compositor 同步、提交前黑帧拒绝，固定门槛不放宽。`live-summary.json` 汇总六次尝试/短时 CPU 内存；跨目录独立收尾见 `post-teardown-check.json`。原生完整 UI/托盘、失败文字可见性、长时 GPU/VRAM 仍未验收。
- **最新 VP8/CPU 数据面检查点**：`out/m2-20261010-vp8-transfer/final-node-test.tap` **433/433**、`final-m2-unit.tap` **67/67**、`pre-live-final.tap` **34/34**、`final-build.log`。两份最终实际报告为 `out/live-acceptance/m2-local-20261010T060651Z-dc302840/scene-report.json`、`m2-store-20261010T060915Z-a34cfcfc/scene-report.json`，各 **13/13**、overall pass。动态像素变化 28.39%/28.10% 和 40.64%/24.70%；暂停源/宿主变化 0，实际断流和损坏包保旧变化 0。首次帧不排除，动态流重复采集数 0；`validated-code-hashes.json` 确认两次最终实测代码未变化。
- **新失败与清理**：首次 VideoFrame GPU draw 慢帧及重复编码暂停抖动失败均保留，现以 CPU copyTo / ImageData 和字节完全相同才复用真实 keyframe 修复。四次尝试见 `live-summary.json`；独立只读收尾 `post-teardown-check.json` 检查 17 个 M2 目录，测试身份/profile/helper/端口无残留、当前聊天保留。短时 CPU/内存、混合许可、未验证项见引擎执行记录；不宣称硬件编码、完整原生 UI 或长期 GPU/VRAM 通过。
- 上述 2026-10-10 PoC/隔离 encoded 数据面为历史证据。2026-10-12 已正式接入身份核验 CDP/固定 VP8/M1；desktop owned-provider 路径以 opaque project ID 选择 native Scene/Web，standalone 无 provider 时保留预览回退，scanner 的源 manifest 不改。生产双宿主尚未完整通过，下一步不是重复接线，而是定位实际首帧/生命周期故障并补全后续验收。官方 CSP、安装包、作者原件、当前聊天与日常配置未改。

## M1-B 最新检查点（2026-10-10）

| 任务 | 当前状态 | 最新证据 |
|---|---|---|
| M1-06 参数与复位 | 代码/隔离 UI 通过 | XY/缩放/倍速/镜像/声音参数/对比度/透明度；schema=3，v2 原文备份；有声可听、双宿主待验 |
| M1-07 统一切换 | 代码/隔离 UI 通过 | prepare/ready/commit、失败保旧、revision 取消、同媒体热更新、restore 释放 |
| M1-08 列表与轮播 | 代码/HTTP/隔离 UI 通过 | CRUD/排序/WE File input、顺序/随机/间隔/暂停、过滤/失效、CAS 反馈和 single-flight 轮询 |
| M1-09 七种过场 | 代码/实际 Electron 帧通过 | cut/fade/push/wipe/iris/zoom/stripes、方向/时长、系统与显式减动态效果、打断/restore 两槽位约束 |
| M1-05/10 完整验收 | 未通过，不标完成 | 本地实机动态查询/视频步骤失败，Store 扫描/控制页启动超时；完整重启、双宿主新增流程与原生退出待验 |

- 成功：`out/m1-20261010-playback/final-node-test.tap` **366/366**、`build-final.log`；`electron-1791594479668/report.json` **11 项**，正常媒体服务清理。
- 失败：本地 `m1-local-20261010T010816Z-e057ea97`、`m1-local-20261010T011659Z-3ba21d27` 与 Store `m1-store-20261010T012100Z-9e9e2938`（均在 `out/live-acceptance`）。新启动器保持可验证父进程存活，但没有放宽产品保护；后续本地实际恢复通过不等于整体实机通过。具体视频/Store 超时底层原因尚未证实。
- 备份、失败详情、下一 Wave 与边界见播放执行记录。未提交/推送或覆盖发行 EXE；当前聊天和日常配置不作为测试目标。
- 本轮独立测试树已精确收尾，`live-teardown.json`：残留/测试监听均为 0，当前聊天身份保留。此为强制测试清理，不计原生托盘或正常退出验收。

## M0 检查点

| 任务 | 状态 | 本轮证据 |
|---|---|---|
| M0-01 全量台账/优先级/依赖/回滚 | 已完成 | `FEATURE_COMPLETION_PLAN.md`，F01–F23、M0–M6 |
| M0-02 注入与兼容层同生命周期 | 代码与自动化通过 | 可信脚本 builder、刷新/新 target、safe/adaptive、恢复停止重装；CLI 与 session 队列；旧扫描生命周期保护 |
| M0-03 配置保护 | 代码与自动化通过 | M0 schemaVersion=1，M1-A 升至 2；旧配置原文备份、损坏/未来版本阻止覆写、成功落盘后提交内存、load/write 共用队列 |
| M0-04 回归与构建 | 已通过 | 历次 105/105、242/242、315/315；M1-A 后最终 `node --test` **340 / 340**，0 fail/skip；同步、编译/混淆构建、编译 CLI `--help`、`git diff --check` 通过 |
| M0-05 双宿主完整交互 | 部分实机通过 | 前次两类宿主现有窗口视频链路通过；本轮本地控制链路通过、Store 控制部分通过；Store safe/引用、原生托盘、新窗口/重建、人工输入滚动仍未验证 |

### M0 已增加的失败路径覆盖

- 注入部分 target 失败不能报告成功；恢复失败继续清理但返回失败。
- 断连恢复先重新确认当前目标，通过仅恢复连接重新接入，保留 hook 清理元数据；无目标或目标覆盖不完整不得报告恢复成功，失败可重试。
- 在途 reload/update/target scan 与 restore/close 不得在清理后重新安装。
- 新 target attach 在登记前追上最新计划，避免模式切换时新窗口停留在旧 adaptive 状态。
- 真实 Store 调参发现缓存的主题刷新请求会反复触发 reload，已修复为每轮文档生命周期只消费一次；实测 DOM/媒体引用保留。
- CLI 的 inject/restore/configChange/rescan/play/pause/退出共用串行边界，避免两个 injector 交叉恢复。
- renderer 更新失败不能通过配置/播放/重新扫描路径假报成功。
- HTTP 返回保留经过白名单裁剪的 per-target compatibility 结果，不透传脚本或正文。
- 配置失败保存、并发 patch、返回快照隔离、加载与写入竞争、修复后显式重新加载。

## M1-A 检查点（最新 Wave）

| 任务 | 状态 | 证据与边界 |
|---|---|---|
| M1-01 资源模型与 image 全链路 | 代码与自动化通过 | schema=2，旧配置迁移/原文备份；图片媒体路由、选择与受控 renderer 解码 |
| M1-02 导入与长任务 | 代码与自动化通过 | JPG/PNG/MP4 流式导入、SHA-256 去重、校验、进度、取消、失败/正常退出清理；强杀/断电未覆盖 |
| M1-03 移除与目录迁移 | 代码与自动化通过 | 目录归属/链接/哈希保护，删除保存失败回滚；迁移复制核验后切配置，旧文件保留；不动 WE 与未知文件 |
| M1-04 隐藏/恢复与分级规则 | 代码与自动化通过 | 网格、选择、CLI 重扫和媒体入口共用规则；隐藏不删源文件；轮播入口已复用并补测试 |
| M1-05 自动化与真实工作台/宿主验收 | 开发中 | 340 单测 + 隔离 Electron 11 项步骤通过；完整程序重启、MP4 可见播放、Store/EXE 同步/恢复未验收 |
| M1-06–10 播放、轮播与过场 | 06–09 代码/隔离通过，10 实机待验 | 见上方 2026-10-10 检查点；M1 整阶段不得标完成 |

### 最新证据

- 全量自动化：`out/m1-20261009-library/delivery-node-test.tap`，**340 pass / 0 fail / 0 skip**。本 Wave 前相同源码的沙箱外基线 315/315；沙箱内 291/315 的 24 个环境失败记录保留，不作为源码回归结论。
- 构建：`out/m1-20261009-library/final-build.log`；同步、编译/混淆构建、关键入口语法、编译 CLI `--help` 与 diff 检查通过。未生成/替换发行 EXE。
- 隔离 UI：`out/m1-20261009-library/electron-1791539851579/report.json`，`outcome=pass`，**11 项步骤**；Electron 44.1.1 / Chromium 152.0.7977.65，测试 helper 退出码 0，媒体服务已关闭。
- UI 覆盖 Chromium File input 的 PNG/JPG 导入/解码、去重、实际卡片/管理控件、隐藏恢复、未分级过滤、迁移、新工作台 + 新 ConfigStore 读盘、删除；只读复制真实 WE MP4 样本后导入 **713019 bytes**，Range 通过。不是 MP4 解码/时间推进证明，也不是完整程序重启。
- 相同 sandbox flags、无 `allow-modals` 的 iframe 内，HTML `<dialog>` 确认/取消和资源写入通过；最终采用**同源测试 wrapper**，未验收实际 file-origin 桌面 IPC 全链路。截图：同目录 `embedded-workbench.png`。
- 早期夹具/初始化/缺报告及额外 iframe 卡住记录保留，不能将“进程退出 0 但无报告”计通过。卡住的具体 native 调用未证实；澄清见 `electron-1791539339767/harness-failure-clarification.json`，原失败文件不覆盖。
- 自有 helper 精确收尾；只读复核 `out/m1-20261009-library/post-helper-check-20261009T100409821Z.json`，helperCount=0。未连接、启动或关闭真实 Codex，未改日常配置、WE 原件、发布包，未提交/推送。

任务状态只保存在内存，未实现断点续传或强杀/断电后的残留回收；目录迁移会保留旧副本，占用额外磁盘。资源索引最多 10000 项、单文件最多 20 GiB、任务记录最多 64 项，网页每次显示 60 张。库索引/目录不进入 CDP payload，原 bootstrap <100 KiB / apply <10 KiB 边界回归通过。

## 真实宿主记录（以下为 M0 历史证据）

### 2026-10-09 再续做：身份修复与限定控制验收

#### 修复、影响面与回滚

- `src/cdp-owner.mjs`：查询失败只返回固定阶段/类别/数值代码，拒绝原始 stderr、脚本、命令行与 profile 回显；启动拒绝和超时也有固定提示。
- 已证实 Windows 活进程祖先链可能终止于已退出的 Explorer 父进程。现在以完整 UTC ticks 证明边界：查到一个创建时间严格早于测试 target 的祖先，就能排除 target 为其祖先；逐边检查父进程不能晚于子进程，防止 PID 复用改走无关链。缺失日期、未证明的断链、同 tick、循环和过深仍失败；目标 PID 检查仍在时间边界前。
- **同一真实本地测试 target 的改前/改后只读对比**：旧查询拒绝且命中 `Cannot verify query process ancestry`；新查询通过且端口/PID 匹配。证据：`out/live-acceptance/resume-workbench-local-20261009T074024Z-bc752992/owner-before-after.json`。这证明祖先边界缺陷，但不把上次所有 CIM 访问失败都归为同一原因。
- `src/process-creation.mjs` 与 `src/acceptance-context.mjs`：共享 7 位小数 round-trip creation 校验，保留原始 tick/时区，完整日期/偏移与 PID 上界校验在写验收目录前进行；不再让 3/6 位时间通过初始化后在下一层失败。
- 影响面经当前源码引用复核：`acceptance-context / cdp-owner → main / launch-flow → renderer 保存与恢复`，新增 helper 由两入口共同引用；包含 actual main/renderer 回归，不以旧图谱代替当前 grep 和运行验证。
- 修改前备份：`out/live-acceptance/m0-20261009-identity-backup/`。备份测试以 `.bak` 后缀保留，避免被 Node 自动测试发现；回滚仅撤销本轮增量，不覆盖原有未提交改动。未改日常配置、WE 原始文件或发布 EXE，未提交/推送 Git。

#### 本轮真实结果及未通过项

新增显式 `--scope control-only`，默认 `full` 不变；报告/截图继续 `wx`，同名不能覆盖。该范围不激活宿主、不测可见时间推进、不静默修改 `pauseWhenHidden`，仍真实点击配置/应用/恢复并验证目标两层。没有媒体引用证据时明确未验证，已有引用证据不允许以空集合通过。

| 项目 | 本地 EXE | Store |
|---|---|---|
| 新测试 PID/独立配置/端口身份 | 通过 | 通过 |
| 实际工作台选择/媒体卡片 | 通过，22 个视频候选 | 通过，22 个视频候选 |
| brightness input 后立即 apply，busy→success | 通过 | 通过 |
| API 与隔离磁盘配置一致 | 通过 | 通过 |
| 全目标 wallpaper/compatibility 两层与 adaptive 模式 | 通过 | 通过，采样 3 个目标 |
| safe 重新应用、配置一致、全部目标模式 | 通过 | **未验证**：应用前媒体引用采集不稳定，尚未发起该次 safe 操作 |
| 工作台截图与 1040 px 模拟布局 | 通过，仅控制范围证据 | 未执行到此步骤 |
| 工作台恢复清理两层 | 通过 | 通过，失败后仍完成恢复 |
| 本轮可见播放时间推进/媒体引用保留 | **未通过/未验证**：完整模式失败于隐藏页面；限定控制范围未测 | **未验证**：有真实视频尺寸/readyState 采样，但未测时间推进；引用未取得稳定证据 |
| 完整 M0-05、原生托盘、新窗口、renderer 重建、人工输入/滚动 | **未通过/未验证，人工延后** | **未通过/未验证，人工延后** |

- 本地最终控制报告：`out/live-acceptance/resume-workbench-local-20261009T074024Z-bc752992/control-only-serial.json`，`outcome=pass`、`restoreComplete=true`、`completeM0Gate=false`。
- Store 最后报告：`out/live-acceptance/resume-workbench-store-20261009T074548Z-4349085b/control-only-stable.json`，`outcome=fail`、`restoreComplete=true`、`completeM0Gate=false`；失败为 `visible_media_reference_capture_not_stable`。不能把它解释成已经证实 safe 应用会重建媒体：失败发生在应用前的采集阶段，仍需区分目标生命周期变化与验证入口问题。
- 失败证据全部保留：本地 `report.json`（完整模式可见播放失败）、两宿主 `control-only.json`（并发测试期间查询保护触发失败，但末次身份复核通过）、Store `control-only-serial.json`（临时 CDP 操作失败）。并发失败根因不凭之后串行通过推定；验证入口已补固定超时/CDP 分类与有限稳定采集，不无限重试。
- 本轮工作台截图仅是控制页面捕获，不采集 Codex 正文，也不替代原生窗口、控件当前状态和人工可读性验收。
- 沙箱内基线临时目录 `realpath/junction` EPERM 记录和中途 PowerShell 语法/备份测试误发现的验证失败均保留于上述备份目录，后续修正重跑；不以这些尝试替代最终测试结果。

该 M0 Wave 停止实机重试，当时 M1 未开始、M2 未解锁。最新 M1-A 开发顺序已在本文顶部更新；Store safe/媒体引用问题及下方双宿主人工清单仍未完成。

#### 最终验证与精确收尾

- 最终全量：`out/live-acceptance/m0-20261009-identity-backup/final-delivery.tap`，**315 pass / 0 fail / 0 skip**。同步、编译/混淆构建、编译 CLI `--help` 与 diff 检查通过。限定验证入口 17/17 单测也保留于 `verifier-final.tap`。
- 本地/Store 收尾前分别保存 20/22 个自有测试树进程身份。协议关闭前精确身份核验通过，仍驻留的自有后代按 PID/EXE/完整 creation 重核后逐项停止；没有按 EXE 路径批量关闭。Store 控制器也在最后精确停止清单中，**不把此操作标成正常退出或托盘退出通过**。
- 两个测试目录的 `teardown-result.json` 均为 `remainingCount=0`、`testListenerCount=0`、`protectedChatPreserved=true`。独立 `post-teardown-independent-check.json` 再次确认两组主 PID/端口消失、隔离 `runtime.json` 已移除、当前聊天路径和创建时间不变。两份 profile 与所有成功/失败记录保留，不自动删除。

### 2026-10-09 续做：工作台与退出底座

- 已修复工作台 `return Promise` 提前进入 finally 的竞态：busy 持有至 flush/IPC 完成，保存/恢复异常统一返回错误，重复操作被拒绝；恢复透传所选安装。
- 已增加 CDP 与所选安装一致性：loopback、唯一 OwningProcess、EXE、实际 argv 调试端口；ready 和新启动均必须在注入前通过，错误版本/端口不接入。
- 独立工作台采用显式 `CWB_ACCEPTANCE_ROOT`，仅允许源码工作区 `out/live-acceptance` 下的普通目录；隔离 userData/桥接 config-state/log，并要求 `target.json` 的 PID、7 位精度创建时间、端口、EXE、隔离 profile。创建时间在 .NET UTC Ticks 层比较，支持等价时区表示且不丢 tick。
- 常驻服务用统一串行 session：记录启动中的 child、同端口复用、换端口先确认旧进程 exit、退出立即封闭、失败可重试但不重新开放 launch/close/inject。Windows UtilityProcess 通过固定父消息触发既有 CLI stop，而非直接强杀；等待实际 exit，非零清理结果不伪报成功。
- 退出行为明确：沿既有 CLI 清理流程恢复仍注入的壁纸，但不会关闭 Codex；关闭/最小化工作台仍驻留托盘。此流程代码与自动化通过，**不是实际托盘点击验收通过**。
- 错误诊断采集前重新核验所选目标；未核验目标不采集，保存报告排除 target URL、probe href/title，防止错误端口导致读取其他宿主。
- 新增实际源码运行时回归、PowerShell/native argv fixture、配置目录 containment 和退出失败回归。最终全量 **242 pass / 0 fail**：`out/live-acceptance/resume-final-node-test.tap`；build/sync/CLI help/diff 通过。原沙箱内 12 个环境失败及沙箱外原 105/105 复核记录均保留。
- 已补装原锁定依赖 Electron **44.1.1** 的缺失开发运行时至本项目 node_modules，没有新增依赖、替换稳定版 EXE 或生成新发行包。

#### 本次实机尝试（尚未通过）

- 本地 EXE 独立测试 PID **13224**、CDP **19335**；隔离工作台 PID **32436**、CDP **19435**，工作台实际运行 Electron 44.1.1；两者独立身份核验通过，当前聊天排除通过。
- 实际工作台载入、发现目标、选择真实 WE 库视频 card 通过（22 个视频候选，源文件只读）；随后的“亮度 input → 立即真实点击应用”与恢复未通过，提示 Windows CDP 进程查询失败。没有以单测替代这项失败。
- 完整失败报告：`out/live-acceptance/workbench-local-20261009T062500Z-b6e735f5/report.json`，outcome=fail，completeM0Gate=false。首次缺 Electron 二进制和 PowerShell 日期对象/字符串误判也保留为本轮环境记录；安装后已真实启动工作台，未覆盖该失败报告。
- 新入口 `scripts/verify-live-workbench.mjs` 只接入明确的已启动测试实例，不启动/关闭应用；可用 `--output-name` 写新的 wx 报告和同名截图，旧证据不覆盖。仅可见 cohort 的视频推进可计验收，隐藏页、原生托盘、新窗口、renderer 重建及人工输入/滚动仍独立标未验证。
- Store 本轮新增工作台交互尚未实测；前次两宿主视频生命周期成功记录仍保留，但不作为本轮新增完整工作台流程通过证明。
- 本轮测试已精确收尾：收尾前保存 **21 个**自有测试树进程身份；Browser.close 请求前双身份复核通过，桌面及其工具进程自然退出（未强制停止桌面树），原 CLI 日志记录收到 SIGTERM 清理，隔离 runtime.json 已移除。本地宿主仍驻留的已核验后代逐 PID 停止。`teardown-result.json` 与 `post-teardown-independent-check.json` 均通过：测试树残留 0、19335/19435 监听 0、当前聊天路径和创建时间不变。**不把协议退出/强制宿主收尾算作原生托盘退出验收**；未删除 profile 或失败证据。

本轮实际查询失败的最终根因尚未确认：不能仅以沙箱内 CIM 访问失败推断正常桌面环境故障，也不能拿 PowerShell fixture 通过替代真实工作台查询。后续先区分执行上下文/Windows 查询权限与代码路径，再在全新测试 PID 下重测。

| 项目 | 本地 EXE | Store |
|---|---|---|
| 路径 | `D:\codex\ChatGPT.exe` | `C:\Program Files\WindowsApps\OpenAI.Codex_26.1002.7124.0_x64__2p2nqsd0c76g0\app\ChatGPT.exe` |
| 版本口径 | EXE ProductVersion `151.0.7922.170` | Store 包 `26.1002.7124.0`；EXE/Chromium `155.0.8059.27` |
| 发现/独立启动 | 通过 | 通过，可与当前聊天并存 |
| CDP 所有权 | 通过：19335，测试 PID 42284 | 通过：19336，测试 PID 39524；原聊天 PID 38680 保留 |
| 媒体应用/切换/调参 | 通过：真实视频出帧、时间推进、换第二视频、调参保留媒体引用 | 通过：真实视频出帧、时间推进、换第二视频、调参保留媒体引用 |
| safe/adaptive 与刷新重装 | 通过：adaptive→safe，实际 Page.reload 后保留 safe 与壁纸 | 通过：adaptive→safe，实际 Page.reload 后保留 safe 与壁纸 |
| 恢复后刷新不重装 | 通过：两层清理，实际刷新后不重装 | 通过：两层清理，实际刷新后不重装 |
| 新窗口/renderer 重建 | 未验证 | 未验证 |
| 工作台保存握手/托盘/退出交互 | 未验证 | 未验证 |
| 完整 M0-05 门禁 | **未通过** | **未通过** |

测试 profile 和原始本机证据保留于 `out/live-acceptance/`（gitignored），不进入发行包。**验收 JSON/日志**仅记录版本、状态、样式与媒体数值，不采集正文、认证 URL 或 session token；profile 是私有用户数据，不应分享。实际视频从现有 WE 库只读加载，未移动/修改源文件。

### 可追踪证据与测试边界

- 最终单测：`out/live-acceptance/final-node-test.tap`，105 pass / 0 fail。
- 本地 EXE：`out/live-acceptance/local-20261009T050123Z-135f50f4/10-lifecycle-visible-final.json`，outcome=pass，2026-10-09 05:27:17–05:28:06 UTC。
- Store：`out/live-acceptance/store-20261009T050427Z-d1f96da5/09-lifecycle-cohort-final.json`，outcome=pass，2026-10-09 05:29:41–05:30:41 UTC。
- Store 初始目标集合 3 个，其中 1 个关闭；后续对仍存在的初始窗口完成检查。另观察到 1 个新目标，只记录数量，**不将其计入新窗口/重建完整验收**。
- 早期失败记录保留：本地隐藏窗口的视频一直 loadstart，唤醒同一测试实例后通过；Store 主题反复刷新与验收脚本死连接误判分别修复后重测通过。未删除失败证据或用一次单测覆盖失败结论。
- 自动化入口：`scripts/verify-live-host.mjs`。必须提供 fresh 输出路径、真实测试 PID、EXE、profile、port；运行前验证 loopback listener、精确 argv、当前聊天祖先排除与 PID 创建时间。脚本不负责启动/关闭 Codex，不使用日常配置；只停止自己创建的 CLI。

### 测试实例收尾

- 两份 `teardown-result.json` 均为 `teardownPassed=true`；本地 PID 42284 和 Store PID 39524 的已核验测试进程树无残留，19335 / 19336 无监听。
- `Browser.close` 已确认，但两个测试主进程仍驻留；随后仅按重新核验的 PID、创建时间和测试后代树逐项停止。没有按 EXE 路径批量关闭，也没有使用这次强制收尾作为“从托盘完全退出”验收证据。
- 原聊天 PID 38680 和工具祖先 PID 37460 的路径、创建时间保持一致。收尾后的独立只读复核再次确认：两测试 PID 已不存在，测试端口无监听，当前聊天与工具仍在。
- 未删除文件；两份测试 profile 与成功/失败记录保留。收尾证据分别位于两个上述测试目录的 `teardown-result.json`。

## 功能组状态（补全口径）

以下状态指**缺口补全**，并不表示起点已有基础能力被删除。

| 阶段 | 功能组 | 补全状态 |
|---|---|---|
| M1-A | F09 导入、F12 隐藏恢复 | 代码与自动化通过；隔离工作台部分验证，双宿主未验收 |
| M1-A/B | F13 内容分级 | 库/选择/媒体/列表规则代码通过，完整双宿主验收未通过 |
| M1-B | F02 取景、F10 轮播、F11 过场、F14 倍速镜像、F15 声音、F16 效果 | 代码/隔离验证通过，完整双宿主验收未通过 |
| M2 | F01 完整 Web、F06 实时 Scene、F07 WE 作者属性 | GPU直绘主链已接，file/directory及本轮Web缺口代码已完成；2026-10-14相关157/157，不是完整视觉/双宿主验收。M2整项3/8；VP8暂停，历史可行性证据保留 |
| M3 | F04 省电、F08 系统音乐、F17 视频性能、F23 缓存迁移 | 源码01–06已交付；本轮工作台就绪/媒体进程重试专项74/74，隐藏power-only恢复9/9。历史缓存迁移、封面、系统媒体、在线歌词和offscreen Web证据保留。完整双宿主首帧/恢复/宿主Web/自然退出、物理电源/设备、ffmpeg和发行未验；内存及长期资源后置，M3-07未完成 |
| M4 | F03 分区玻璃、F18 字体光标、F19 主题联动 | 未开始 |
| M5 | F20 吉祥物、F21 个性化、F22 多语言 | 未开始 |
| M6 | F05 跨平台 | 未开始 |

## 继续与回滚

1. 最新从 [M3后台收口](M3_BACKGROUND_CLOSURE_20261015.md) 续做。已补可后台验证的工作台就绪和helper恢复缺口；**不再自动恢复/前置窗口，也不继续内存定位或长测**。剩余为用户允许后逐项进行Store/Local可见首帧/完整暂停恢复/宿主Web链与托盘退出、物理电源/设备、ffmpeg真实转码和发行回归；不重复整套M3，不将暂停项目标通过。
2. M0-05 人工清单、Store safe/媒体引用问题和 M1 双宿主同步/恢复仍待验收；M2-A 先行授权不覆盖这些门禁，不授权发行，Scene 预览图不计实时引擎完成。
3. 本轮修改仍仅为runtime源码/UI和专项工具，具体源码SHA、验证与编译证据见最新交付文档。未覆盖共享 `dist/`、生成/替换发布EXE、commit/push或创建PR；旧EXE不包含本轮修复。
4. 回滚只撤销任务自有增量，保留原M0/M1/M2/M3-A/file修改；M3-B改前备份在 `out/m3-b-20261014/before/`，前Web备份在其原目录。旧Wave/失败证据、配置备份/profile均保留，WE源文件只读。不写或修改项目/全局记忆。

尚未覆盖：多进程同时写配置、外部程序修改配置、Windows 文件占用与断电持久性；本轮自动化通过不代表这些场景已验收。

### M0-05 剩余人工检查（Store / EXE 各一份）

- [ ] 从实际工作台选择正确目标和其 CDP 端口，真实调参后立即点击应用，验证保存握手与错误提示。
- [ ] 通过 Codex 的真实菜单打开新窗口；不再点击应用也能自动接入，safe/adaptive 与当前壁纸一致。
- [ ] 真实 renderer 重建后重新接入；不能仅用 Page.reload 代替这一项。
- [ ] 最小化/关闭工作台后驻留托盘，视频持续；托盘应用与恢复走同一流程。
- [ ] 从托盘完全退出，媒体服务/子进程和重新注入均停止；当前聊天和其他 Codex 版本不被关闭。
- [ ] 两个版本完成上述检查，记录 UI 可读性、输入/滚动/点击与完整恢复后，才标 M0-05 通过；M1/M2-A 的先行开发授权不替代此门禁或发行验收。
