# M2 剩余内容续做（2026-10-13）

## 范围和约束

- 继续 M2-04–08；继承 FEATURE_COMPLETION_PLAN.md 的验收条件，不把 M0/M1 或发行门禁补勾。
- 用户最新要求：**不跑全量测试**。仅执行改动模块专项和直接依赖链回归，真实宿主只验证相应缺口；未覆盖范围明确列出。
- 保留工作区已有修改、当前聊天、日常配置、WE 原件和所有失败证据；禁止测试样本 3790869794；不生成或替换发行 EXE。
- 注入源修改 bridge-overrides 后同步；测试不复用会漂移的共享 dist，使用有界 SHA-256 编译快照。
- 证据目录：`out/m2-20261013-completion/`。不写项目或全局记忆。

## 顺序 / 验收

**用户最新收口**：VP8 暂不处理，后续仅 GPU 直绘；不再运行 VP8 专项或实机。快照通用模块继续用于 GPU。此前已运行的 VP8 相关专项作为历史证据保留，不把它们计为 GPU 通过。
当前源码默认已是 `direct-gpu`，包含明确 CSP bypass/恢复刷新流程（见 GPU_DIRECT_SCENE.md）；不沿用旧 VP8 的“未请求 CSP bypass”结论。只操作独立身份核验的测试文档，不触碰当前聊天。

1. **冻结构建**：补齐已有 5 项红测；拒绝已有目的地、越界、链接、超限、复制期间源漂移和快照篡改；production verifier 的 compiled imports / UtilityProcess / CLI 同源，结束复验。补针对性边界测试与代码审查。
2. **生命周期 / 回退**：定位切换取消解码，区分退休接收器与真实 decode 错误，补竞态专项；完整回退、失败保旧、显式 retry 不伪报。
3. **M2-04/06/07**：核对 Scene pointer / 音频、Web shim / API、全部作者属性类型与重启恢复，先补实际缺口，再对应专项和实机。
4. **M2-08**：当前允许样本矩阵、双宿主对应场景、CPU/RSS/GPU/VRAM 采集与有界长时验证；样本覆盖和指标口径逐项声明，不将 ACK 当屏幕 FPS。

TDD 与审查链：同时采用模块测试、直接链路集成测试和人工代码审查，不委派子 Agent。
风格：Node ESM/CJS 延续相邻文件的两空格缩进、固定枚举错误、async/await；无新依赖。

## 检查点

- 起点：M2 3/8；最新 Store 6/6 功能步骤仍含取消解码事件和强制 fixture 收尾；本地 EXE 联运行超时未解决。
- `snapshot-red.tap`：仅已有快照专项 **0/5**，模块未实现；非本轮全量测试。

## 前轮 GPU 续做检查点（M2 未全完成）

### 已实现和专项证据

- 通用 `m2-compiled-snapshot.mjs`：fresh destination、containment、链接/大小边界、源漂移和篡改检测，`snapshot-boundary-green.tap` **23/23**。用于 GPU 隔离构建；不是发行 EXE 证明。
- GPU 共享 slot：暂停/隐藏/未提交/退休静音；恢复用户音量；passive capture 指针及控件拖拽隔离。capture 是防御改进，**不是后续指针误报的根因修复**。定点诊断结果见下。
- GPU 读回：剔除预加载 target，所有 active targets 必须给出一致的合法实际值，写入读回必须匹配。GPU 失败提示不引导 VP8。
- `engine-status` 保留有界 GPU target/尺寸/FPS/completion 数据，不泄露 URL/channel/作者正文。`gpu-controls-02-targeted.tap`：共享 slot、GPU delivery、first-injection、HTTP status **26/26**。
- 实机发现 `AuthorPropertyController` 丢失 `codex-gpu` 来源，新增固定枚举透传；新增 HTTP 红测 **0/1**，`gpu-author-source-green.tap` **11/11**。不接受任意 source 字符串。
- 全程未运行全量测试；沙箱 loopback 失败和对应正常权限专项复验分别保留，不将环境失败称作产品红测。

### 隔离构建 / Store 实机

构建脚本 `out/m2-20261013-completion/gpu-isolated-build.mjs` 只复制 src/scripts/runtime/overrides/package 白名单并前后 SHA-256 校验。每轮使用 fresh workspace，内部再固定 compiled snapshot；开发入口 runtime 来自该独立 workspace，不虚称所有代码均 compiled。未覆盖共享 dist，未打包或替换发行 EXE。

- build01：`out/live-acceptance/m2-gpu-build-f5d464ff/workspace/`。首次 Store Apply 前失败；根因未确认。第二次 `m2-gpu-store-2026-10-13T04-18-25-217Z-f0ca0836/report.json` 前 5 步通过，pointer 失败；实际 GPU Canvas **1575×1080**、裁剪截图变化、**60.19 renderer completed FPS**（包含截图耗时）只属于这轮 build01，**不是物理屏幕 FPS或长时性能**。
- build02：`out/live-acceptance/m2-gpu-build-81283f06/workspace/`。`m2-gpu-store-2026-10-13T04-35-10-841Z-52991632/report.json` 前 4 步通过（Apply、切换/资源、暂停恢复）；pointer 与作者来源断言失败。host capture/bubble 都收到 down/up，Scene accepted/delivered/ack 均为 0，因此“宿主阻断冒泡”假设未获支持。作者 bool 已落盘且读回，因 API 丢来源断言失败；不把它记为完整属性验收。
- build03：`out/live-acceptance/m2-gpu-build-b705316e/workspace/`，source manifest `dbdf02dbf32a0cbc98b519d8c3818551606e1cbbceeaa654af77ac71c3a3a23c`。带来源修复及自有 listener 诊断；最终结果见下。
- build02/03 使用 `--controls-only`：跳过 motion/FPS 截图及 4 次切换 stress；明确记录 notRun。不把旧构建 FPS 绑定到新构建。
- 所有已结束轮次 compiled/source 前后哈希、日常配置、WE manifest、当前聊天保留。多数轮次 desktop/Utility 自然退出、独立 Codex fixture 精确强停，`resourcesClosed=false`、exit1；build03 首轮虽自然收尾，却有验证器断言失败。不能将这些组合成自然退出/托盘门禁通过。

### 定点指针诊断结果（用户选择的优先项）

1. build03 Store `04-45-39-760Z-aef73ea9`：五类作者原生 UI（bool/slider/combo/color/textinput）、保存、实际 Codex GPU 读回、默认值恢复通过；Restore/Apply 通过。最后 Restore 点击时按钮仍 busy，属于验收器未等待 UI 可操作，后续补等待且保留失败。
2. build03 Local `04-51-18-622Z-42d0f658`：**7/7 功能步骤通过**，明确跳过 pointer/FPS。两次 Restore 都验证了新文档及 `frame-src` 实际阻拦，并非仅看 `Page.setBypassCSP(false)` ACK。fixture 强停，整个脚本 exit1。
3. build03 首轮 `04-42-19-852Z-5da74dbd` 因把 3 个窗口的 targets 误当“至多2槽”失败；真实上限是共享 sources 至多2、各窗口各自 M1 槽位。验证器修正并有针对性 VM 回归，不计产品缺陷。
4. `04-57-33-771Z-51662824` 初次 Apply 后的最小事件测试通过；`04-59-58-049Z-36179b35` 调试器作用域观测失败，不能据此判断产品事件被阻断。其后取消此侵入式诊断，使用无坐标/正文的有界接收/转发/拒绝原因计数。
5. **根因在验收器**：`sceneConnection()` 只按 URL 匹配首个 iframe，而不同 Codex 窗口共享同一 readonly Scene URL。build04 的 `05-04-53-518Z-0a13a4af` 显示可见目标已接收并转发 3 个 pointer，读取的另一个 iframe 却是 0。新增重复 URL/目标缺失红测 **0/2**；改为所选宿主 DOM `frameId` + iframe target id + URL 同时匹配，`gpu-owned-frame-green.tap` **5/5**。
6. **build04 Store** `m2-gpu-store-2026-10-13T05-08-18-811Z-07280f6f/report.json`：**6/6 功能步骤通过**（setup/Apply/切换/暂停恢复/真实pointer/最终Restore）。无调试器，精确 frameId 绑定；3 accepted/3 delivered/3 acknowledged，down=1/up=1，leftDown=false；CSP 恢复后新文档真实拒绝 iframe。该轮跳过作者 UI、FPS、Restore/Apply 重复回归；fixture 强停，整体 exit1，不算全验收通过。
7. **build04 Local** `m2-gpu-local-2026-10-13T05-10-12-020Z-b85f921e/report.json`：setup通过，Apply失败（约76秒的操作耗时；日志为 `Renderer DOM application verification failed`）。未进入 pointer/属性步骤，根因未确认，不把 build03 Local 的7/7移作该构建通过证据；不声称已确认首帧超时或GPU故障。

build04 workspace 为 `out/live-acceptance/m2-gpu-build-496bf57b/workspace/`；完整初始 source manifest `10e7de8b40ea3b4e45159a45b43a4c7bad6c489e39fc49e135cc5b7c312ec275`，产品源码集合 SHA-256 `eec9efec5d8e83148f97a554dc2a190d7ef22da1b72241433ff7b41f38cc1406`，compiled snapshot SHA-256 `9ca4c009321297f90dc479efff9147a4c6d08439167886bea7bd18aeb0b0089e`。验证器单独版本化，最新轮次保存 `verifier-source.mjs` 和 SHA；不把修改后的 verifier 冒称初始完整 manifest。

**旧 FPS 口径修正**：build01 的截图确实取自所选宿主自有图层，画面变化证据保留；但当时 OOPIF 查询尚未绑定精确 frameId，60.19 completion FPS 只保留为旧候选 Scene 观测，不作为选定文档或当前构建的性能门禁。未追加 FPS 全流程来覆盖该缺口。

### 专项与只读收尾

- 最新指针诊断 slot/delivery/HTTP 状态专项 `gpu-pointer-telemetry-green.tap` **15/15**；frame 归属/资源验证器专项 **5/5**；语法 **8/8**、`git diff --check` 通过。各轮专项有重复覆盖，不把各数字相加宣称独立总用例数；未跑全量。
- `post-cleanup-final.json`：**11 份报告、33 个登记进程身份，自有身份残留0、不可核验0、登记监听0，保护聊天身份保留**；此脚本只读，不停止任何进程。范围仅登记 PID/EXE/创建时间和端口，不承诺全部历史后代或长期 GPU/VRAM 归零。

### build04 阶段遗留（后续进展见下）

最新构建本地 EXE Apply 失败、完整双宿主 pointer/作者属性进程重启恢复、完整失败/回退/retry、GPU 长时 CPU/RSS/GPU/VRAM，以及完整允许样本覆盖。Store 指针及两宿主的限定 CSP 恢复已有上述分轮证据，不冒称同构建完整双宿主通过。Web 当前仍沿用旧 VP8 路径，按用户最新要求暂停此方向；不把未运行的 M2-06 自动勾完。M2 仍 **3/8**，M0/M1/发行门禁不变。

## 继续：GPU 隐藏窗口首帧等待（2026-10-13）

### 定点诊断与复现

- 原 build04 Local 日志不是所有页面都失败：两个可见页面已 `injection-ready`，随后隐藏页面在约16秒后 DOM 验证失败。旧报告没有该文档的帧状态，保留旧失败，不反推其唯一根因。
- 同产品字节的 `05-36-23-237Z-895a11fc` Apply-only **3/3 功能步骤通过**，但这轮只有两个可见页面；这不是旧故障已修复的证据。
- `05-38-55-596Z-f9922cc2` 在浏览器窗口协议阶段失败，未到 Apply；属于测试辅助 API 不可用，不能记为 GPU 产品故障。随后改用已有独立 profile/PID/EXE/创建时间/监听/原生进程句柄/HWND 归属校验的 Win32 辅助脚本，不枚举或操作用户窗口。
- build04 `m2-gpu-local-2026-10-13T05-41-19-874Z-3b6d292c/report.json` **复现同类 Apply 失败**：原生最小化一个自有窗口并保留另一个可见窗口。隐藏 Scene 已加载 **13 layers、1575×1080 canvas**，但连续采样 **draws=0、renderCompletions=0、phase=loading、paused=false**；可见 Scene 已 ready。这条可复现路径是隐藏文档首帧门槛不适用，不靠加长超时、关闭 Chromium 后台限制或抢焦点修补。
- `m2-gpu-diagnostics.mjs` 只读有界状态，独立白名单过滤 renderer 响应；每轮先核验 owner，iframe 按 DOM frameId 匹配，最多8文档/每文档2帧。不输出正文、URL、channel、CDP handle 或作者值。最新报告保存验证器和诊断源及 SHA。

### 产品修复与专项

- GPU 有实际 Scene ID 时，隐藏目标保持 deferred，探测连接关闭；不建立 runtime、修改该文档 CSP、分配 Scene 或把隐藏首帧等待误记为资源失败。日常 scan 在页面可见后自动走原身份核验及真实首帧链路。
- `start/update` 返回有界延后数量；CLI `deferredTargets` 和 UI 消息明确显示等待可见页面。全隐藏时 sessions=0，不伪造成功首帧；可见目标的真实失败仍计入 failed。普通媒体的原有隐藏页面初始化行为不变。
- `gpu-hidden-start-red.tap` **0/2**；`gpu-hidden-start-green02.tap` **25/25**；新增可见失败不能被 hidden 延后掩盖的反例。
- 6个直接依赖测试文件按名称筛选，`gpu-hidden-start-focused-chain-normal.tap` **42/42**。此前沙箱轮 **38/42**：3项 loopback `fetch failed`，1项沿用旧 native-cpu 版本断言；只复验这4项为 **4/4**，旧断言改为实际 GPU runtime 版本。未改变产品主题恢复逻辑，全部原失败记录保留。数字有重叠，不相加宣称独立用例总数。
- 全程仅 GPU/直接依赖专项，无全量或 VP8 实机/专项；`sync:bridge` 只同步真源与生成 public bundle，未覆盖共享 dist。

### 隔离构建和新鲜实机

- build05 `m2-gpu-build-88ae79a4` 沙箱构建失败：直接 `realpath` 为 EPERM，vendor lock 的9文件原始哈希均一致，未放宽完整性门禁。失败目录保留。
- 正常 Windows 权限下 fresh build06 `out/live-acceptance/m2-gpu-build-49d26b37/workspace/` 构建通过；与 build05 相同初始源码 manifest SHA `059847898a792701de4355c12799b7873f38d33e0b4fcd23159a320aeb0a4108`。产品源码集合 SHA `c3a330c907c11c475fda735e128cc96e096735bbc3e4b68bf926f9c642d27e7a`，compiled snapshot SHA `fce0af67e5f7a2e7b2f9b46748a1377f61419661dd7f49fe2f0baeeea8313dba`。验证器后续可单独版本化并留 SHA，不冒称全部 runtime 是 compiled 或完整初始 manifest 未变。
- Local `m2-gpu-local-2026-10-13T05-47-01-949Z-1c306a57/report.json` **5/5 功能步骤通过**：真实最小化、Apply、隐藏窗口无 runtime/root/iframe、准确 HWND 恢复后两文档真实帧、最终 Restore 新文档/CSP 实际拒绝。跳过 pointer/作者/切换/暂停/FPS。
- Store `m2-gpu-store-2026-10-13T05-49-40-141Z-055f5a7a/report.json` **6/6 功能步骤通过**：相同隐藏/显示流程，加精确 frameId 的真实 move/down/up；3 accepted/delivered/ack，down=1/up=1、leftDown=false，CSP 实际恢复通过。未重复作者/切换/暂停/FPS。
- Local `m2-gpu-local-2026-10-13T05-51-57-517Z-4727fa4c/report.json` 的 Apply/pointer 通过，最后 Restore 验证 operation_failed；实际服务随后完成恢复。该失败保留，原报告没有具体 CDP 错误，不能声称已唯一确认其原因。源码另发现验证器只等 root 消失、没有同时等待新文档：补 `waitForRestoreDocument()`，不可读 context 不算成功，GPU 必须 marker 消失/body 就绪/root 移除后再验证 CSP。红测 **0/2**，`gpu-restore-readiness-green.tap` **14/14**；不是产品恢复逻辑改动。
- 同产品字节、单独版本化验证器的 Local `m2-gpu-local-2026-10-13T05-56-23-973Z-31076685/report.json` **4/4 功能步骤通过**：Apply、精确自有 frame 的3 accepted/delivered/ack、down/up 消费、leftDown=false，最终新文档和实际 CSP 拒绝。没有重复隐藏/作者/切换/暂停/FPS。最新 Store/Local 的限定指针与 CSP 证据同产品集合/compiled digest，不移作完整双宿主 M2 通过。
- 以上轮次功能 outcome=pass，但测试 Codex 仍需精确强停、resourcesClosed=false、脚本 exit1；不算自然退出、完整 M0/M1 或发行验收。

### 最终只读收尾

- `gpu-continue-summary.json` 复核 Local隐藏/显示5/5、Store6/6、Local指针4/4的相同产品/compiled digest、前后来源校验、指针及实际CSP读回。真源/runtime 两份 injector/CLI SHA 一致，语法6/6、最终 `git diff --check` 通过。所有执行会话已结束；未打包、commit/push或改记忆。
- `post-cleanup-continue-final.json` 覆盖全部18报告/54登记身份：自有身份残留0、不可核验0、登记监听0，但历史保护身份53472已不存在，protectedPreserved=false。保留该失败，**不把全历史审计称为通过**。
- 本轮首次实测前，保护基线已是51932（创建时间05:24:38Z），旧53472未列在本轮任何 protectedBefore 中；不能据此推断其退出原因。另有 `post-cleanup-current-turn.json` 专门核验本轮7报告/21登记身份：残留0、不可核验0、监听0、**本轮初始保护身份保留**。只读脚本没有停止进程，范围不包括所有历史后代或GPU/VRAM分配。

### 未覆盖边界

完整同构建作者属性 UI/实际读回与进程重启恢复、全部失败保旧/回退/retry、全部允许样本、长期 CPU/RSS/GPU/VRAM、正在等待首帧期间才变隐藏的竞态、完整生命周期和发行 EXE 仍需后续验收。旧05:10隐藏文档已退出，不能补采其当时状态；本轮只确认并修复已复现的同类触发路径。Web/VP8继续暂停，M2仍 **3/8**。
