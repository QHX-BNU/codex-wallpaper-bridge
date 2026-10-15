# M2 引擎执行记录

日期：2026-10-13。用户要求续做 M2，最新收口为 **GPU 直绘、VP8 暂停、仅专项测试**。Scene 默认经身份核验 CDP 注册只读 descriptor，在宿主独立 iframe/GPU 内渲染，复用 M1 prepare/commit/cancel；不逐帧编码/传输。GPU 路径明确进行自有测试文档 CSP bypass/刷新及恢复，不沿用旧 VP8 的无 bypass 结论。保留当前聊天、日常配置、WE 原件和全部失败证据，不覆盖共享 dist、不替换发行 EXE，禁止样本3790869794。

最新专项和隔离构建实机记录集中在 [M2_COMPLETION_20261013.md](M2_COMPLETION_20261013.md)。指针已按所选DOM frameId精确匹配。随后定点复现并修复隐藏GPU页面无实际绘制却被强制首帧初始化的同类Apply失败：延后至可见，不抢焦点、不伪造ready。最新GPU build06 Store6/6、Local指针4/4、Local隐藏/显示5/5功能步骤通过；限定指针/CSP证据同产品集合和compiled digest。五类作者UI/实际读回仍是前轮证据，不能合并成全验收。恢复文档等待验证器已补红/绿测，所有原失败保留、旧文档唯一根因不反推；fixture仍强停。M2仍 **3/8**，M2-04–08、M0/M1完整门禁和发行未通过。下文VP8/PoC/历史build06/旧Store6/6不覆盖新的GPU或长期资源验收。

## Wave 与退出条件

| Wave | 原子任务 / 文件范围 | 验证与门禁 |
|---|---|---|
| A1 | M2-01；锁定 WebWallGL 2.1.0、独立上游及依赖许可，最小 vendoring 清单 | 精确 commit、SHA-256、LICENSE/归属、MPL 源码包和来源；不复制整个 DSH 插件 |
| A2 | M2-02；scene-server、只读资源入口、独立渲染 origin、消息桥、构建和隔离 Electron helper | 正常/失败/路径穿越/Host/Origin/Range/退出回归；真实 scene.pkg 连续动态像素，非预览图或示例动画；暂停/恢复/释放 |
| A3 | M2-03；独立 Store/EXE 目标验证 | 两种真实 Codex 宿主的隔离、加载、控制、失败回退、资源释放；A2 的独立 Electron 不替代本项 |
| B1 | M2-04/05；粒子、puppet、SceneScript、音频、鼠标及首帧/失败链 | **A1–A3 通过后**，分别选具有对应特征的真实样本；复用 M1-07，不另建切换器 |
| B2 | M2-06/07/08；严格 Web shim、作者属性、样本库与长时切换 | 可信消息、类型范围/读回/默认值、资源释放和双宿主回归 |

历史 A1/A2/A3 初轮因 A3 未通过而未扩大到 M2-B；后续 VP8/CPU 限定门禁通过后已继续 B。2026-10-12 owned native provider 路径正式接入 M1 prepare/commit/cancel；scanner 源 manifest 不改，无 provider 的 standalone 路径仍预览回退。源码接线不替代生产全链和日常配置验收。

## 架构决策与影响面

- A1/A2 采用独立只读 loopback origin + 跨 origin iframe + 白名单 postMessage；接受一个额外监听端口和场景加载期内存开销。反选同源 iframe：上游 SceneScript 用 `new Function`，屏蔽变量不等于强安全沙箱；不能让它拥有控制 API origin/令牌。A3 证明直接嵌入受宿主 `frame-src` 限制，此路线不能直接交付到 Codex。
- 不重写 WE 引擎、不粘贴 DSH 宿主层。artifact 来自 DSH `111816a4fc7ae29acf4fce4ed134b84557424515`；WebWallGL 上游 `4ba71c406fbc78f24c99b1bb1edd9d9cef9793c8`（2.1.0）。保留产物哈希与两层来源，不声称本轮已重现上游构建。
- mediabunny 1.56.0 是 MPL-2.0，不能把整个 bundle 描述成纯 MIT。保留其原版发布源码包、LICENSE 和完整性；WE 场景/官方素材只读、不复制入发行包。
- 渲染 origin 无控制/写入/执行接口；CSP 禁止外部网络、表单、弹窗和宿主访问；动态执行只用于独立 origin 的 SceneScript。Node integration 关闭。资源目录 lexical + realpath containment，文件扩展名白名单、只读 GET/HEAD、随机独立资源 capability。
- TDD + test-generation + 完整 code-review；新能力先独立验证，不改 M1 配置 schema、轮播/选择和注入 payload。影响面为新 scene-server/bridge/vendor、build-app、新增测试/helper。已有图谱采用 `--no-rebuild` 只读查询，缺少 M1 新模块；以源码 grep 复核为准，不自动更新用户记忆。
- 并发/退出：限制连接数、传输超时，关闭取消自有传输；服务生命周期串行。失败返回固定类别，不回显磁盘路径/控制 token。有限采样和诊断计数，不打印作者脚本或用户正文。
- 撤销条件：目标 Chromium/隔离/CSP/资源或真实动态帧无法通过；保留失败证据和未完成状态，不以静态动画代替完成。M0/M1 原有保护不放宽。

## 证据与回滚

- 根：`out/m2-20261010-engine/`；改前工作区状态、docs 哈希/`.bak` 均保存。后续源码增量先备份再修改；只撤本轮自有增量，不 reset 整仓。
- 改前同份源码：沙箱 `baseline.tap` 322/366，44 项含临时路径 EPERM/loopback 环境失败；沙箱外 `baseline-unsandboxed.tap` **366/366**。两份记录都保留。
- 禁止修改日常配置、WE 原件、发行 EXE 或当前聊天；不提交/推送。独立 helper 的退出不算原生托盘退出。
- 未通过：Store/EXE 场景加载与后续控制/失败回退门禁；未实现：M1 共用切换接入、完整属性/交互/音频、长时间稳定性。后续成功和失败在本文件追加，不用计划代替验收。

## A1/A2 最终证据

| 项目 | 证据 | 结果与范围 |
|---|---|---|
| 来源及许可 | `bridge-runtime/vendor/webwallgl/vendor-lock.json`、NOTICE、三个 LICENSE、原版 mediabunny 源码包 | 精确 commit/哈希通过；WebWallGL/we-scene MIT，mediabunny MPL-2.0；`reproducedBuild:false` |
| 源码 GPU PoC | `out/m2-20261010-engine/electron-controls-1791599861929/report.json` | 7/7；真实包首帧、连续像素、constructor escape 隔离、伪造消息、暂停恢复、释放、损坏包失败 |
| 构建产物最终 GPU PoC | `out/m2-20261010-engine/electron-delivery-png-1791603410565/report.json` | 7/7；落盘 PNG 解码像素；Electron 44.1.1 / Chromium 152.0.7977.65，实际 WebGL2 / RTX 3050 / ANGLE D3D11；监听关闭。先前 `electron-built-draw-1791600990234` 7/7 保留为历史 |
| 来源适配 TDD | `host-origin-red.tap`、`host-origin-green.tap`（均在证据根） | 改前 17/18；精确 `app://-` 适配后 18/18；拒绝 opaque/null、其他 app origin、凭据、路径和伪造 source |
| 最终全量 / M2 专项 | `out/m2-20261010-engine/delivery-final-node-test.tap`、`delivery-final-scene-unit.tap` | 390/390 全量、24/24 专项，0 fail/skip；含 M0/M1 原有保护、M2、helper 启动前目录防护与像素测量反例 |
| 最终构建 | `out/m2-20261010-engine/delivery-build.log` | 构建前 vendor 完整性检查、scene-server 独立 bundle、bridge 压缩与许可/源码包复制通过；非发行 EXE |

真实样本只读：`D:\steam\steamapps\workshop\content\431960\1778944028\scene.pkg`，1,153,129 bytes，SHA-256 `edfaef0b6e4ffbf7db627262f272e6b1a39065b555c634a22f29e2b3ceee516e`。13 层；没有请求 preview、没有用示例动画代替原场景。最终构建产物三帧相邻像素变化 **28.28% / 12.96%**，暂停后变化 **0**，均以同份落盘 PNG 解码后的像素计算。`frame-b.png` 为仅场景的隔离 Chromium 捕获，不是 Codex 原生 UI 验收截图。

首帧修复：最初构建产物 `electron-built-1791600164384/report.json` 因 `running && fps>0` 门禁超时。FPS 依赖第二帧，静态/idle 场景可能只画一次；改为引擎场景/层/画布存在且实际 WebGL draw 提交大于 0，并补单帧反例。真实连续像素另行核验，不能用 iframe load 或计数本身冒充画面证明。

收尾测量修复：`electron-delivery-1791603262207/report.json` 曾报告第二帧全黑，但同份 `frame-b.png` 的实际查看为正常画面，说明 `capturePage()` 返回的懒加载 GPU NativeImage 的 `toBitmap()` 与落盘 PNG 不一致。验证器现只对保存的同份 PNG 重新 CPU 解码并比较，`capturePixelSource=decoded-saved-png`；没有过滤黑帧、放宽像素阈值或重试挑好帧。`capture-pixel-red.tap`、`capture-pixel-green-final.tap`（6/6；中间一次 fixture 缺 report 的失败另存）和最终 7/7 都保留。该错误属于验证器测量，不以统计值覆盖截图证据，也不隐去失败尝试。

## A3 早期真实宿主结果：直接 iframe 受限制，不标通过

新启动器/验证器：`scripts/verify-m2-live-scene.ps1`、`scripts/verify-m2-live-scene.cjs`。没有启动日常工作台；每次新建 profile 和证据目录，连接前沿用 `verifyCdpEndpointOwner` 的 PID、完整 creation、EXE、profile、loopback port、祖先链保护。只选择初始 `app://` 应用 target，不收集正文、标题或认证 URL，不加入额外 target；完整模式仅尝试自有 800×450 场景区域，失败后移除自有 DOM/监听。未使用 CSP bypass、可见性 mock 或同源 SceneScript。

| 宿主 | 当前机器版本 | 只读来源探测 | 可见场景门禁 |
|---|---|---|---|
| 本地 EXE `D:\codex\ChatGPT.exe` | 应用 26.818.32112；Chromium 151.0.7922.170 | `m2-local-20261010T030339Z-85a6849f/scene-report.json`，origin=`app://-` | `m2-local-20261010T032025Z-fb06faf5/scene-report.json`：身份/可见文档/自有 iframe 建立通过，首帧超时、场景资源 0 bytes；未到像素/控制步骤 |
| Store OpenAI.Codex | 包 26.1007.2314.0；应用 26.1007.21434；Chromium 155.0.8059.40 | `m2-store-20261010T030423Z-7a69b6d8/scene-report.json`，origin=`app://-` | `m2-store-20261010T032257Z-f1a1925f/scene-report.json`：同样首帧失败；运行时明确捕获 `parentPolicyViolations:["frame-src"]`，0 bytes |

表中宿主目录均在 `out/live-acceptance/`。独立复核 `out/m2-20261010-engine/codex-static-policy-decoded.json`：两种当前安装的 `webview/index.html` 中 `frame-src` 允许 self/blob 和指定官方 sandbox/外部域，均不允许 `http://127.0.0.1:*`。Store 有运行时策略事件；本地 EXE 的策略同样排除此源，但本次 EXE 没有采集到独立 CSP 事件，不能把 Store 的运行时事件写成 EXE 证据。

Node 的 WHATWG URL 对自定义协议返回 `origin="null"`，而两个实际 Chromium 均返回 `app://-`；server 仅增加这一精确字符串的祖先/消息目标，不接受 `app:*`、`*` 或字符串 `null`。该修复解决消息来源配置，**不能改变父页面的 frame-src**。

未执行到的后续步骤：宿主内三帧像素、constructor escape/Node/control API 隔离、暂停恢复、释放及“损坏包→最后真实帧”回退。验证器虽包含这些步骤，但不可计作宿主通过；独立 Electron 7/7 也不替代它们。`nativeVisiblePlayback=false` 保留，原生 UI/输入/滚动/托盘仍未验收。

### 失败记录与精确收尾

- 隐藏窗口失败：`m2-local-20261010T031553Z-b8c8c199` 未选到可见 renderer；`m2-local-20261010T031827Z-e4c7473d` 的 `Page.bringToFront` 未使隐藏窗口可见。用户明确授权显示后才用 `-Visible`，没有伪造 `document.hidden`。
- 第一个隐藏实例收尾曾遇 WMI 元数据不匹配并安全中止该 PID 的停止；后续独立只读检查确认该树已全部消失、端口关闭、当前聊天保留。未把它推断为确定的 PID 复用根因。启动器现对不匹配项记录并跳过强杀，再完成安全项及最终残留检查；不降低身份要求。
- 可见 EXE/Store 两份 `teardown-result.json`：`remainingCount=0`、`listenerCount=0`、`protectedChatPreserved=true`；场景 server 关闭、自有 overlay 移除。最终另做跨目录独立检查。强制测试清理不计正常/托盘退出通过，profile 与失败证据保留。
- helper 在 `app.setPath/whenReady` 之前就校验真实 workspace/验收 root 和既有 profile，启动器拒绝重解析祖先/复用证据目录。`helper-startup-red.tap` 改前 2/5、`helper-startup-green.tap` 改后 5/5（VM 启动边界反例，不是实际权限证明）；加固后独立只读 `m2-local-20261010T033122Z-b98efe23/scene-report.json` 与收尾通过。跨目录检查（最新 `post-teardown-final-check.json`，早期 `post-teardown-independent-check.json` 保留）确认 7 个验收目录的自有身份、测试端口/helper 均无残留，当前聊天保留。
- 早期默认 `node --test` 曾误发现参考 checkout 的上游测试，失败留在 `wave-a-node-test.tap`；参考源码现放证据根的 `reference-sources/node_modules/` 排除区域，不把外来失败隐藏成最终通过。

## 早期复核与下一 Wave（后续进展见下）

证据类型为命令/原始 TAP、报告与隔离场景截图。完整审查覆盖来源/许可证、跨源权限、路径/链接/Range、错误/超时、串行生命周期、bounded diagnostics、构建及恢复。反例含路径穿越/ADS/junction 越界、Host/Origin/方法拒绝、分级/大文件、重启/在途流关闭、伪造 source/channel、没有场景的假 FPS、单帧无 FPS，以及真实宿主 CSP 拒绝；没有通过例覆盖失败。

仍有交付阻塞：M2-03；仍有范围外未验证：包内粒子/puppet/SceneScript 特征库、音频/鼠标/属性、长时内存/VRAM 与跨场景缓存释放。作者脚本与适配器处于同一场景 origin，遥测不是安全授权，也不单独证明真实像素。`release()` 已验证画布/引擎对象消失，但不宣称 GPU/浏览器缓存立即归零。

下一最小动作：建立 **独立 renderer → 可信帧/媒体数据面 → Codex** 的 M2-03 替代 PoC；不在宿主执行作者脚本，不修改官方包或关闭 CSP。先验实际支持的载体、连续非黑帧、时延/CPU/内存、暂停/释放/断流与失败保旧，再考虑 M1-07 集成。另一候选为宿主官方隔离 sandbox 接口，需先有可用 API/权限证据，不能伪造官方来源。两者都没有在本轮实现或标通过；直接 loopback iframe 路线停止扩大，M2-B 保持未开始。

## A3 后续 Wave：可信真实帧进入双宿主，性能仍未通过

证据根：`out/m2-20261010-frame-transfer/`；规格/权衡/门槛/备份为 `PLAN.md`、`backup/`。新增 PoC-only `scripts/m2-frame-transfer.mjs`、`scripts/verify-m2-frame-transfer.cjs`、`test/m2-frame-transfer.test.mjs`；既有独立 helper / launcher 显式增加 `--frame-transfer` / `-FrameTransfer`，复用同一身份/目录/target/收尾闸门。没有向生产 bundle、scanner、配置或 M1 切换接入新播放器。

### 数据面与支持边界

- 只读复核当前两种安装策略，`carrier-policies.json`：`img-src` 允许 `blob:`/`data:`，`frame-src` 仍不允许 loopback。独立 sandboxed Electron 渲染真实包；可信 main 捕获 PNG，经原有身份核验 CDP 传给宿主自有 canvas。宿主没有 scene HTML、作者脚本、作者 URL、Node/控制令牌或新的网络监听；未使用 CSP bypass 或修改官方包。
- 接收对象只保留为 CDP handle，不挂在 `window`，不监听作者 `postMessage`。固定 PNG/IHDR/800×450、2 MiB 上限、完整图像 decode、单调 sequence、single-flight、无队列；非法 URL/脚本/过期帧拒绝。数据载体的 JS 仅展开 33-byte 头，完整内容由图像解码器校验；主进程 PNG 来自自有捕获，不接收作者提供的任意图片。
- Windows 150% DPI 的实际源/宿主截帧是 1200×675，传输及比较明确归一到 800×450；保留 physical 和 normalized 原始 PNG。来源吻合按同尺寸 RGB 平均绝对误差 `<5/255` 判断，最终均约 1.29–1.31；不能称 DPI 重采样后的逐像素完全相同。动态、暂停与同一宿主失败保旧另作比较。
- 真实 sample 仍为上文同一 13 层 `scene.pkg` 和 SHA-256；未请求 preview。支持范围仅此样本的视觉帧和可信暂停/恢复/释放，未验全场景特征库、鼠标/音频/作者属性、4K/高帧率、长时内存/VRAM。失败文字是自有 DOM 状态读回；截图只采场景区域，不将状态读回算原生文字/完整 UI 验收。

### 最终两种实际宿主（均整体失败，不覆盖为通过）

| 项目 | 本地 EXE | Store |
|---|---|---|
| 证据目录（位于 `out/live-acceptance/`） | `m2-local-20261010T040239Z-af4f8e8e` | `m2-store-20261010T040429Z-9062525b` |
| Chromium | 151.0.7922.170 | 155.0.8059.40 |
| PoC 检查 | 12/13，通过全部功能/隔离/生命周期项；性能项失败 | 同左，12/13 |
| 三次宿主真实截帧的相邻像素变化 | 28.77% / 27.44% | 21.41% / 36.72% |
| 暂停像素变化 | 0，恢复后重新变化 | 0，恢复后重新变化 |
| 实际源窗口终止 / 损坏包 | 自动源终止通知；最后真实帧变化 0；损坏候选未 ready，保留真实帧变化 0 | 同左 |
| 约 6 秒的数据面测量 | 10 帧，1.62 FPS；capture-to-ack p50 262 ms / p95 1334 ms | 11 帧，1.71 FPS；p50 262 ms / p95 446 ms |
| 原先门槛 | ≥4 FPS 且 p95 <750 ms，**失败** | 同一门槛，**失败** |
| 首次场景 ready / 首次 capture-to-ack | 3.28 秒 / 1334 ms | 4.55 秒 / 309 ms |

`live-summary.json` 汇总六次尝试，精确值以两份 `scene-report.json` 为准。capture-to-ack 是采集、PNG/可信像素校验、CDP、解码和 canvas draw 的确认，不是物理显示端到端时延。流测量含三次证据截图/落盘，不声称无记录吞吐极限；没有删除证据采样、排除慢帧或放宽门槛以提高成绩。

两份最终报告都验证：源 release 清除 canvas/引擎对象而宿主保留旧帧；重新真实渲染后，实际销毁源窗口自动触发失败；损坏包再建 PoC 接收器并以最后真实捕获帧初始化，随后候选失败保旧。这不是 M1 prepare/commit/cancel 或跨场景生产切换。宿主只显示测试自有区域，`nativeVisiblePlaybackScope` 明确不等于日常壁纸或完整原生 UI 门禁。

短时指标：helper+独立源进程累计 CPU 增量对应约 **73% / 82% 的一个 CPU 核**，不是整机 CPU 百分比；private memory 快照约 **403→441 MiB / 360→390 MiB**。宿主主线程 task-time 增量约 1.47 秒 / 0.24 秒，JS heap 含官方应用活动与 GC。未测完整宿主多进程 CPU、GPU/VRAM、长期泄漏或无场景基线，不能据此作因果/稳定性结论。

### 失败与修复证据均保留

- `m2-local-20261010T035054Z-db098e1b`：初轮拒绝采集 DPI 尺寸；未把超尺寸 PNG 放入协议。`dpi-red.tap` → `dpi-green.tap`，增加可信采集归一化，协议边界不放宽。
- `m2-local-20261010T035351Z-999c0641`：blob 实际宿主能显示匹配像素，但只有 0.31 FPS / 两次采样，未通过。改用策略明确允许的 PNG data 图像，不执行脚本/URL。
- `m2-local-20261010T035625Z-fcc25638`：data 载体真实动态帧通过，但 2.59 FPS / p95 1482 ms，未通过。性能失败不应掩盖其余功能证据，验证器现完成生命周期后再执行原门槛，总体仍失败。
- `m2-store-20261010T035850Z-d00ad5bb`：动态/拒绝/暂停恢复通过，2.82 FPS 仍不足；release 后重载的首次 capture 得到黑帧（源和宿主原 PNG 保留），该轮 release/restart 步骤失败。引擎 draw 提交不等于 compositor latch；现等待两次真实 parent rAF，并在提交之前验证真实捕获非黑。黑帧会留 artifact、显式失败保旧，不循环挑下一张好帧。`first-paint-green.tap` 含提交前黑帧反例；最终两个宿主的实际重新渲染、断流和损坏链通过，不覆盖早期黑帧失败。
- 既有 helper 测试的 pre-wave `.bak` 对照早期 `delivery-file-hashes.json` 验证 SHA-256 精确一致，保留原有未提交 M0/M1 改动；新协议/首帧反例只在 Node VM 模拟，不替代上述实际两宿主结果。

### 最终回归、审查与收尾

- 最终全量 `final-node-test.tap` **407/407**，M2 专项 `final-m2-unit.tap` **41/41**；接收器/启动/首帧专项 **23/23**。同步、`final-build.log`、JS/PS 语法及 diff 检查通过。原 A2 构建 GPU 7/7 仍是历史独立证据，不替代新宿主门禁。两份最终实际宿主的 overall outcome 均为 `fail`，不是 12/13 就算通过。
- 每次 launcher 强制收尾仅限新建测试树；最终两份 `teardown-result.json` 的 remaining/listener 均为 0，当前聊天身份保留。自有 host DOM、scene server / wrapper listeners 和 source window 释放。`post-teardown-check.json` 独立只读复核 **13 个目录**（本轮 6 + 前次 7）：自有身份/profile/helper/监听均无残留，当前聊天完整 creation/EXE/PID 保留；不计正常退出、托盘或 M0 门禁。首次独立检查因 PowerShell 7.6 `ConvertFrom-Json` 自动把 ISO creation 转为 DateTime、再次隐式转字符串时丢失 offset/fraction 而误报，记录保留在 `post-teardown-check-date-conversion-fail.json`；现以 `-DateKind String` 保留完整 round-trip 时间并重新查询当前 PID，严格身份条件不放宽，该检查没有停止任何进程。
- 审查/自检见 `REVIEW.md`，源码/文档哈希和差异检查保留在本证据根。没有发行、提交/推送、修改 WE 原件/官方包/日常配置或写项目/全局记忆。

### 当时检查点与下一最小动作（历史）

**M2 任务仍为 2/8；M2-03 性能未通过，M2-B 未开始，日常 scene 仍 `playable:false`/预览回退。** 后续先验证低开销的编码媒体/持续数据面（候选 WebM/MSE 或经实测确认的硬件编码），保持作者脚本在独立 renderer，并沿用同一双宿主像素、控制、失败和收尾门槛。PNG data 的性能不足已明确，不继续用参数微调或删截图来宣称达标。编码路径尚未实现/验证；正式接入仍须复用 M1-07，而不是新建生产切换器。

## A3 最新 Wave：可信 VP8 / CPU 数据面通过限定双宿主门禁

证据根：`out/m2-20261010-vp8-transfer/`；决策、预设门槛和备份为 `PLAN.md`、`backup/`，完整审查见 `REVIEW.md`。新增 PoC-only `scripts/m2-vp8-transfer.mjs`、`scripts/m2-vp8-encoder-preload.cjs`、`scripts/verify-m2-vp8-transfer.cjs` 及三份 `test/m2-vp8-*.test.mjs`；原独立 helper / launcher 显式增加互斥 `--encoded-transfer` / `-EncodedTransfer`。未改生产 renderer / scanner / 配置 / M1 切换、官方 CSP 或安装包。

### 路线、来源与隔离

- 独立 sandboxed Electron renderer 渲染相同真实场景，可信 main `capturePage` / native resize 提供固定 800×450 的 1,440,000-byte BGRA。只将原生捕获送入独立 wrapper 的隔离 preload WebCodecs VP8 编码器；作者没有 Node / IPC / contextBridge / parent DOM / 控制 API，编码事件不监听作者 postMessage。main 精确核验 owned webContents / primary frame / wrapper URL / 当前 sequence，不接受作者提供的编码或原始图片。
- VP8 全 keyframe、软件优先、2 MiB 上限；固定 signature / partition bounds / 800×450 / sequence / timestamp，严格 one-flight / 无队列。可信 encoded bytes 通过原有身份核验的 CDP object handle 送宿主 VideoDecoder。解码 flush 后 `copyTo(RGBA)`，再以 CPU-backed ImageData 提交；不注入 scene HTML/作者脚本/任意 URL，不修改官方策略，不宣称硬件编码。
- 首次 VideoFrame GPU YUV draw 在 EXE 实测约 9.3 秒，flush 仅约 11 ms；因此采用 CPU RGBA 提交，不通过预热后剔除慢帧。编码的码率控制会使同一静止 raw 重复编码产生抖动；只有 byte-for-byte 相同才复用前一次 genuine keyframe。动态流 duplicateFrames=0；暂停另证明两次原生源捕获变化 0，再证明宿主变化 0。
- Windows 150% DPI 的源 / 宿主 physical PNG 1200×675，明确归一到 800×450。每个取证样本保留 physical / normalized 源和宿主 PNG、实际传输 `.bgra`、`.vp8`。原生 raw 与落盘 PNG 解码对比误差 0；有损 VP8 + DPI 的宿主来源误差约 2.14–2.17 /255，满足**实测前预设**平均 RGB 误差 `<8`。这是有损来源吻合，不冒称逐像素一致，也不是事后放宽 PNG 的原阈值。
- 每帧原始和解码后都做已知样本的非黑门禁；黑帧失败保旧并保留 artifact，不挑下一张好帧。首次 / 慢帧不剔除。支持范围仍仅同一 13 层 scene.pkg 的视觉/可信控制；未知暗场景的 `<5%` 非黑判据不能直接成为生产通用策略。

### 相同代码的两个实际可见宿主

| 项目 | 本地 EXE | Store |
|---|---|---|
| 最终证据目录（`out/live-acceptance/`） | `m2-local-20261010T060651Z-dc302840` | `m2-store-20261010T060915Z-a34cfcfc` |
| Chromium | 151.0.7922.170 | 155.0.8059.40 |
| PoC 检查 / overall outcome | **13/13 / pass** | **13/13 / pass** |
| 含三次截图/落盘的动态流测量 | 40 帧 / 6.101 秒 / **6.56 FPS** | 34 帧 / 6.012 秒 / **5.66 FPS** |
| capture-to-commit-ack p50 / p95 / max | 54 / **102** / 129 ms | 53 / **119** / 365 ms |
| capture / encode / decode p95 | 32 / 12 / 12 ms | 31 / 10 / 44 ms |
| 首次场景 ready / 首次 capture-to-ack | 3.24 秒 / 99 ms | 4.51 秒 / 119 ms |
| 三次 compositor 样本的相邻像素变化 | 28.39% / 28.10% | 40.64% / 24.70% |
| 源 / 宿主暂停像素变化 | 0 / 0；恢复重新变化 | 0 / 0；恢复重新变化 |
| 原门槛 ≥4 FPS / p95 <750 ms / ≥6 秒 | **通过** | **通过** |

计时包括首次采集、raw resize/验证、IPC/VP8、CDP、解码/RGBA copy 和 ImageData commit acknowledgement；不是物理屏幕端到端时延或生产高帧率承诺。三次取证截图/落盘包含在流吞吐时间内，不移出慢采样以提高成绩。`validated-code-hashes.json` 记录协议、preload、helper、launcher 的 SHA-256，代码最后修改早于两个最终宿主启动、两次之间未变化。

两份实际报告均验证：真实 GPU 和 scene.pkg（没有 preview 请求）、constructor escape/Node/parent/network/control 隔离、非法 URL/脚本/stale frame 拒绝、暂停/恢复、源 release 清空 scene/canvas 与关闭真实编码器、重载新源、实际销毁源窗口自动失败、损坏包 never-ready/保留最后真实帧、host decoder/DOM、IPC listeners、raw/encoded cache、source window、scene-server/wrapper 释放。源终止和损坏后的宿主变化均 0。损坏候选是新 PoC 接收器以最后 genuine keyframe 初始化，**不是** M1 prepare/commit/cancel。

短时指标：helper+独立源进程 CPU 增量对应约 **63% / 56% 的一个 CPU 核**，private memory 约 **402→478 MiB / 407→473 MiB**。范围不含整个宿主多进程/GPU/VRAM，也没有无场景基线；只有约六秒快照，不作因果、泄漏或长期稳定性结论。

### 全部失败、回归与收尾

- `m2-local-20261010T060021Z-9a957521`：原生 / VP8 / 真实宿主来源对比成功，但首次 direct VideoFrame draw 导致 capture-to-ack 9956 ms，仅一次采样，overall fail。原 raw/VP8/PNG 均保留。
- `m2-local-20261010T060247Z-9e27c4b7`：拆分测量确认 flush 约 11 ms / draw 9299 ms；最少三次样本的有界流仍仅 0.27 FPS / p95 9413 ms。暂停时源两份 raw/PNG 完全相同，重复编码后宿主变化 0.715%，步骤失败；不放宽暂停阈值。
- 实机失败之后的 CPU / 精确 raw 重复检测修复，有 `cpu-surface-red.tap` → `cpu-surface-green.tap` 及 preload sequence 反例/修复记录。VM 单测不当作真实宿主证明；最终上述两份各 13/13 才是新路线的可见宿主证据。四次尝试均保留，未删除慢帧/失败目录。
- 初始沙箱基线 31/41 失败来自 Windows `realpath` EPERM；相同未改代码的 native-permission 基线 41/41 通过，不降低完整性校验。首次 full-node-test 433/434 是备份目录中 `.test.mjs` 被 Node 误发现；备份改为 `.mjs.bak`（字节不变），原报告保留。最终默认全量 `node --test` **433/433**、M2 专项 **67/67**、协议/preload/启动/IPC/黑帧/CPU 异步/精确重复边界 **34/34**，同步、编译/混淆构建、JS/PS 语法和 diff 检查通过。
- 每份 launcher 强制清理仍仅限新测试树，remaining/listener=0、当前聊天身份保留。最新 `post-teardown-check.json` 独立只读核验 **17 个目录**（前次 13 + 本轮 4），测试 identity/profile/helper/端口无残留；本轮 protected chat 精确 PID/EXE/UTC creation 未变。强制清理不计正常/托盘退出，测试 profile 不递归删除。
- 无发行 EXE 替换、commit/push/PR、WE 作者原件或官方包修改、账户切换、日常配置/当前聊天接入、项目/全局记忆写入。WebWallGL/we-scene MIT 和 mediabunny 1.56.0 MPL-2.0 的原锁定与归属不变；新增载体不增加依赖。

### 当时检查点与下一 Wave（历史 VP8 PoC）

**M2 任务 3/8；M2-01–03 的限定可行性门禁通过，M2-B 尚未开始。** 下一步 M2-04 粒子/puppet/SceneScript/包内音频/鼠标特征样本库、记录支持和降级，再做 M2-05–08。正式接入必须复用 M1-07；日常 scene 仍 `playable:false` / 预览回退，不把此 PoC 标为完整 F06 或日常播放已完成。

仍未验证：完整特征/音频/鼠标/作者属性、跨场景 M1 切换、4K/高帧率、长时 CPU/内存/GPU/VRAM、完整官方 UI/失败文字可见性/原生托盘/M0-M1 门禁。首帧新路线由实际 capture-to-ack 与来源/非黑证明；源启动、shader/资产 ready 与传输耗时分开，不把先启动后持续帧时延混称“立即切换”。

## B 最新 Wave：兼容性、原生资源 owner 与作者属性（进行中）

证据根：`out/m2-20261010-compatibility/`；规格、边界与恢复计划见 `execution-plan.md`，改前备份为 `before/`、`before-resume/`、`before-native-suspension/`、`before-render-ack/`。不改 WE 原件、上游 vendor 原文件、官方 CSP/安装包、日常配置或发行 EXE；不提交/推送，不写项目/全局记忆。

### 实现与支持范围

- 有界随机读取 Scene 包的 inspector、只读路径/大小/深度/类型检查；本机库存 **45 Scene + 3 Web** 检查无失败（`sample-inventory-verified.json`）。这不是 48 个均可渲染的证明。
- `EngineRendererOwner` 管理非持久 session、只读服务、独立 source window、decoded 原生首帧、心跳、失败记忆/显式 retry 与释放。复用 M1 `createMediaSwitcher`，不是另建选择/轮播状态机。作者消息与原生像素证据分开；未知暗场景不使用 >5% nonblack 作为通用首帧判据。
- 桌面 main 已给自有 preview UtilityProcess 绑定 trusted native host；CLI 仅在固定 parentPort/env 身份下创建 client，stop 清理 client，standalone Node 返回 null。只读 resolver 每次重新读取隔离/既有磁盘配置且不写入，路径仅来自 scanner；跨 peers 全局两资源上限包含 lookup/closing。runtime 明确记录 providerConfigured 与 nativeSceneSelectionIntegrated=false；并未启用日常 Scene/VP8 或新建切换状态机。
- 属性 schema=4，旧 v3 配置原文备份；每壁纸作者属性上限 128 壁纸/256 字段/128 KiB。专用 GET/POST API 校验注册项目/类型/范围，普通 config 写入禁止绕过。真实面板区分 saved 与 live；Scene 为实际引擎属性读回，Web 仅 author-delivery，不冒称效果读回。
- 独立非持久 session 的网络、navigation/redirect、popup、download、permissions deny；Scene/Web wrapper 与作者资源 origin 分离，Node/任意文件/命令/宿主控制均未开放。Web API shim 的本地供给/属性递送已开发，系统音频/媒体数据源和可听输出未验收。
- 只读 HTTP 服务对精确锁定的 MIT host glue 响应做 `scene-render-overlay`；原件 **1,071,482 bytes**、SHA-256 `7d4cf1bc13ce49153169d072772f22cd705467195d6cd1c5451d5af13269d566` 不变。hash/锚点不符或重复 patch fail closed；HEAD/Range 使用适配后 bytes。回执位于实际 `beginFrame`/文本更新之后，只证明输入消费时序，不是可信像素证明。
- 指针队列上限 64，同按钮相邻 move 可合并，down/up 按渲染完成回执推进；没有 pointer timer/microtask/adapter rAF 计时猜测。独立隐藏 source 使用真实 offscreen native 30 FPS 时钟；不保存 paint images，也不拿 paint event 代替 decoded 首帧。
- Web 暂停以 source-owned inspector 的 Animation rate=0、`Debugger.paused` 回执和实际 native captures 稳定门控；恢复原 rate，等待 `Debugger.resumed` 与 fresh heartbeat，串行控制/poll epoch 防止旧任务复活。没有保存作者 call frames/脚本/正文；视频/GIF/任意作者资源的普遍冻结仍未验证。

### 最新实际隔离验收（不替代 Store/EXE）

| 证据 | 结果与边界 |
|---|---|
| `electron-features-14/report.json` | Scene `3233141951` **10/10**、`3553574985` **9/9**，overall pass；真实包动态像素、粒子/puppet/脚本/鼠标、音频 media clock、属性、暂停/恢复/释放及 navigation deny；不是可听输出或生产宿主验收 |
| 同报告快速输入 | 各连续发送 **54 条**，没有 verifier sleep/draw barrier；**27 down + 27 up**，pending=0、全部 acknowledged；2260/2358 ms，原 10 秒门槛不变；真实作者 cursor 回调增量 59/61 |
| `electron-owner-properties-07/report.json` | **10/10**，在 05 的 9/9 基础上增加真实 native 损坏候选 M1 prepare/commit：准备 2 槽、失败 1 槽、旧 Web native bitmap 前/中/后完全相同，旧 owner 恢复继续运行；候选独立 1000 ms 负例超时且资源关闭，不改成功门槛。resourcesClosed=true、remainingWindows=0 |
| `electron-native-matrix-02/report.json` | **8 样本、24/24 切换**（5 Scene/3 Web、3 轮），复用 M1，每次最多 2 槽、完成后 1 槽/1 source、退休 owner 关闭；最终 0 窗口。约 45 秒，不是长时稳定性。暗样本 3444535389 的 native changedRatio=0.003044、nonblackRatio=0.008556，decoded 首帧与动态通过，不以 >5% 亮度冒充通用门槛 |
| `electron-provider-ipc-02/report.json` | **5/5**，实际 compiled desktop host/UtilityProcess/owner：真实 scanner 86 个注册项目、隔离磁盘属性、真实采集 hash 对齐、Web 暂停恢复、全局 2 owner 上限、取消待首帧和 child 自然退出清理；host closed/slots=0/peers=0、所有 owner 关闭/0 窗口。01 历史报告保留；这不是完整日常 Scene/VP8/宿主主链 |
| `full-tests-sixteenth.tap` / `build-seventeenth.log` | 接线基线 **544 pass / 0 fail / 0 skip**，退出码 0；CLI/provider/main 专项 **61/61**（cli-harness-green.tap），包含 provider 等待/幂等关闭/清理失败；mock/VM 单测不替代上表真实隔离证据。历史 533/533 报告保留，最新 encoded Wave 见下节 |

### 部分失败全部保留

- `electron-features-01/02` 未生成最终报告，启动日志/自有进程记录保留；`03–07` 的暗场景亮度、属性/脚本回调和 Web 动态/作者 listener 等失败均保留，不将检测到特征当成支持证明。暗样本的最新 native 动态通过仅对应 matrix-02，不追溯覆盖历史失败或泛化脚本/可听输出。
- `electron-features-08–11` 的计时排队路线未通过快速序列；用户选择精确回执后不继续同路线调参数。`12` 回执时序正确但普通隐藏窗口约 1 FPS，原 10 秒仅消费 11 条、43 pending；`13` 的 frame subscription presentations=0，无改善。该无效 demand 模块已移除；`14` 的 offscreen native clock 才通过，所有失败目录/原门槛保留。
- `electron-owner-properties-01` 面板操作失败，`02` 证明 lifecycle frozen 没停止作者 rAF；隐藏截图不变不能冒充暂停。诊断 `native-freeze-diagnostic-01–03` 保留，最终仅按上述 native suspension 支持子集报告。
- `electron-owner-properties-03` 真实销毁后读取 destroyed BrowserWindow getter；修复为生存期内保存 debugger emitter。`04` 证明 M1 会替换可变 slot.identity，失败缓存 key 漂移导致 cached retry 未拒绝且漏窗口；修复为私有不可变 engineIdentity，helper 跟踪所有 owner 清理。`05` 是修复后实际通过证据，不覆盖失败。
- 新 `electron-native-matrix-01` 因 verifier 把真实 manifest 的 `Scene` 大小写误判失败；按已有 scanner 归一化后新目录 `02` 才通过，原报告/门槛保留。sandbox 直接 owner-06 无实际启动/report，按原生权限 owner-07 才为证据；`build-fifteenth.log` sandbox vendor 完整性失败，同份代码原生权限 build-sixteenth 通过，不放宽 vendor/hash 校验。
- main/CLI 接线后 `full-tests-fourteenth.tap` 为 534/543、9 项失败：CLI VM harness 删除 import 却没注入新 openNativeEngineProvider。`cli-harness-red.tap` 稳定复现 18/27；仅补依赖并加退出清理反例，61/61 专项与原生权限全量 544/544 通过。沙箱全量 `full-tests-fifteenth.tap` 465/544 含 Windows realpath EPERM/loopback/vendor 环境失败，同份代码原生权限 sixteenth 通过；不删失败或放宽校验。

### 接线检查点（后续 encoded Wave 见下节）

**M2 仍 3/8，M2-04–08 开发/隔离验收进行中，不勾整项完成。** failed candidate 保旧、8 样本/24 次短时切换与桌面 trusted host/client 接线已完成本轮限定验证；下一步是 owner → VP8 → 身份核验 CDP → 宿主 decoded canvas，并复用 M1 切换。productionSwitchIntegrated=false，日常 Scene 不启用；完整可听音频/OS 媒体、最新 Store/EXE B 功能、长时 CPU/内存/GPU/VRAM、M0/M1 原生交互仍未验收。短时 matrix 收尾 GPU/renderer 进程缓存并未归零，不把 resourcesClosed 当成 VRAM/泄漏证明。

## B 最新续做：native VP8 / UtilityProcess 数据面

规格/恢复：同一证据根 `encoded-provider-plan.md`、`before-cli-harness/`、`before-provider-docs/`、`before-encoded-provider/`；审查 `encoded-provider-review.md`。未修改生产媒体选择、官方 CSP、作者/上游原件、日常配置、发行 EXE 或项目/全局记忆。

- 新 `engine-vp8-encoder`、sandboxed preload、固定 VP8 envelope；native owner 的 `captureEncoded` 和 owned RPC 的 `capture-vp8` 已实现。请求仍只有 opaque handle，不接受原始像素、URL、脚本、路径、codec/config 或 timeout 参数；VP8 全 keyframe/800×450/2 MiB 上限/软件优先，sender + exact main frame + wrapper URL + sequence/timestamp 验证。原 PNG diagnostic capture 保留。
- 编码器在每 owner 惰性创建的独立、encoding-only `/codec` context，不与 Web 作者的 inspector 暂停上下文混用。codec 独立非持久 session、只允许精确自有 wrapper URL，拒绝作者资源/权限/导航/下载；无 contextBridge/window/postMessage API。两个 owner reservation 最多 **2 source + 2 codec**，不是过去单个 source window 的成本；helper 另有 1 个可信解码窗口，实际最多 5 窗口。长时资源/VRAM 不宣称通过。
- 一次一帧、无队列、5 秒编码上限；关闭先封闭 IPC/异步 support query/flush，清除 cache/listeners，再销毁 native window/session。只有完整 native BGRA 字节相同才复用前次 genuine keyframe；暗场景无 >5% 门槛。NativeImage/BGRA 保留于可信 parent，RPC 仅返回固定 encoded envelope。

### 真实 compiled 验收与失败

| 证据 | 结果 |
|---|---|
| `electron-encoded-provider-01/report.json` | 功能 **7/8**、overall fail；PNG 热路径 **2.39 FPS / p95 687 ms**，未达 ≥4 FPS。亮/暗来源、Web 暂停恢复、capacity、实际 source 销毁与 child exit 清理通过；不把功能子步骤当整项通过 |
| `electron-encoded-provider-02/report.json` | 相同 compiled 代码仅增加分段计时，功能 **7/8**、overall fail；**2.42 FPS**。native capture p50 **250 ms**，parent encode 总计 p50 264 ms，CPU decode ack p50 12 ms。未删首次/慢帧或降低门槛；瓶颈位于 PNG 采集序列化路径 |
| `electron-encoded-provider-03/report.json` | 优化为可信 native BGRA 固定帧后 **8/8 / overall pass**；真实 bright Scene、合法 dark Scene 和 Web。35 帧 / 6.121 秒，**5.72 FPS / p95 290 ms / max 467 ms / 首次 467 ms**；原 ≥4 FPS / p95 <750 ms 门槛不变，首次和三次取证截图/落盘均计入。native capture p50 47 ms。范围是本地隔离数据面，不是 Codex/CDP/物理屏幕端到端时延 |
| 同报告来源与生命周期 | 10 组实际 native 源/解码 PNG，原始 BGRA 与同一 capture 的 saved PNG RGB 误差 **0**；有损 VP8 解码平均 RGB 误差约 **0.98–4.46 /255**，<8。亮场景两次 compositor 变化约 60%/59%，暗场景 nonblack≈0.0087、decoded 动态≈0.00293；Web native pause 原始/encoded hash 相同、解码帧变化 0，恢复变化≈70%。实际 source 销毁期间无晚到 keyframe。两个 owner 上限和 live source/codec 的 utility 自然退出清理通过 |
| `encoded-raw-native-green.tap` / `full-tests-seventeenth.tap` / `build-twentieth.log` | 编码/owner/RPC/host 专项 **50/50**，默认全量原生权限 **564/564**、0 fail/skip，退出码 0；同步与构建通过。TDD 缺模块/缺方法红测试、support query 关闭/flush/外来 sender/重放/非法帧/超时/晚结果等反例保留；mock 不替代上表 native 证明 |
| `post-encoded-independent-check.json` | 独立只读检查 **30 个兼容性 helper 目录**：精确 native identity/profile/后代/helper/owned listener 无残留，未停止任何进程；调用方 Codex/ChatGPT 祖先精确 PID/EXE/creation 留证。每次 helper resourcesClosed=true、remainingWindows=0，最终 encoder listeners/cache 清除、decoder closed。不是 GPU/VRAM 归零或泄漏证明 |

`encoded-validated-code-hashes.json` 保留本轮源码/compiled owner/host/preload 的 SHA-256；人工视觉复核 bright source/decoded PNG 内容、取景一致，1200×675 physical decoded PNG 归一到 800×450 比较。Scene/Web 的最终数据面报告未改动原 quick pointer 输入门槛。

### 最新门禁与下一步

**M2 仍 3/8，M2-04–08 不勾整项。** 日常 native provider client 尚未把 encoded 数据面用于选择/注入，`nativeSceneSelectionIntegrated=false`；最新 B `codexHostsVerified=false`、`productionSwitchIntegrated=false`。下一最小动作：在身份核验的实际 injector/session 中安装固定 VP8 CPU 接收槽，复用既有 M1 prepare/commit/cancel 和过场/重载/恢复清理；再做独立 Store/EXE B 回归。可听音频/OS 媒体、长时 CPU/内存/GPU/VRAM、M0/M1 原生交互仍待验；新增 build assets 的发行 allowlist/ASAR 门禁尚未补验，不运行打包或替换发行 EXE。


## 2026-10-12 最新检查点：Scene 高清工作台 / build-05 / 本地生产通过

证据根：`out/m2-20261012-preview-hd-01/`，计划/恢复见 `execution-plan.md`、`before/`、`before-docs-02/`。用户明确禁止选择/播放“泰拉身高体检”（3790869794）；按ID/归一化标题双重测试拒绝，不删除日常素材。M2仍3/8，M0/M1/发行门禁不变。

### 工作台模糊根因与真实验证

原 `preview.gif` 只读核验254×254；GPU Scene lease/API/隔离iframe复用M1首帧切换，实际Canvas1920×1083、DPR1.5。07/08/09三个fresh profile各5/5，连续renderer completion为61.18/61.33/61.01FPS，中位61.18，非物理屏幕帧率。最新build05 `workbench-2026-10-12T04-54-04-647Z-64fb8789/report.json` 5/5、61.29FPS、resourcesClosed=true；稳定全窗口截图 `scene-workbench-after-sampling.png` 已视觉复核，真实纹理清晰，教程文字是素材自带内容。first-submit截图只代表初始提交，不冒作稳定成品。环境和三次细节见 `workbench-summary.json`、`benchmark-environment.json`。

隐藏验证04/06失败保留：04禁用backgroundThrottling使document.hidden未变；06首帧前隐藏却等待隐藏页首帧超时。后续拆分真实draw之后过场被隐藏（收尾一个iframe）与首帧前隐藏（旧Scene保留，显现后仍需新draw），不mock hidden或绕过首帧。restricted05 GPU DLL 0xC0000135/FATAL0x80000003未进入UI，不当源码失败。

### 本轮代码 / TDD / 构建

- 普通图片/视频/Web准备超时5秒；只有Scene GPU预览用90秒，可信loadTimeoutMs范围(0,90000]；`timeout-visibility-green.tap`17/17，红测试保留。
- verifier先检查HTTP状态，不把固定plain-text500误报JSON语法错误、不读取错误正文；select/显式retry等待实际M1过场与host1槽settle，不能200ms过场中立即断言槽位。
- injector真源在bridge-overrides：CDP仅整数cdpCode=-32000且精确 `Cannot find object with given id` / `Cannot find context with specified id` 触发对应私有receiver退休、同步封闭lease和session重建；不毒化共享源或清真实源failure memory。相似非协议错误仍fatal需显式retry。`receiver-retirement-green-02.tap`41/41。
- `sync-05.log`、`full-05.tap` **626/626，0 fail/skip、exit0**、`build-05.log`通过。full04为625/626：未先sync导致字节一致性失败，补sync后通过，没有修改门槛。
- `asar-01/report.json` **pass**：真实归档46entries/29unpacked，对全部指定compiled unpacked/preload/许可共30文件hash比较；releaseExeGenerated=false/packagedExecutableRuntimeVerified=false，不替代发行EXE运行验收。hash01属于较早build04，不冒称所有最新代码哈希。

### 真实生产：本地12/12，Store完整流程失败

所有目录在 `out/live-acceptance/`，只用允许样本、新profile/端口/config，官方CSP不改。

| 目录 | 结果与边界 |
|---|---|
| m2-store-20261012T040613Z-0be40efb | 前8步通过；第9步plain-text500被旧verifier误作JSON语法错误，失败保留 |
| m2-store-20261012T041427Z-f05643d9 | 前7步通过；reload旧receiver故障被记source failure，失败保留 |
| m2-local-20261012T041735Z-448d2d1d | 前8步通过；candidate显式retry实际已执行，slots2过场时序断言失败 |
| **m2-local-20261012T045613Z-7a8b119c** | **build05、12/12/pass**，首帧/来源/性能、暂停恢复、短时音频、bool/slider磁盘保存/engine-readback/reset、Scene/dark/Web两轮切换、Web暂停恢复、reload、failed candidate保旧/禁止自动retry/显式retry、paused source真实销毁/last-real-canvas冻结/owned失败label/同IDretry、约64.8秒short soak/4次切换/上限、restore与utility自然退出 |
| **m2-store-20261012T045435Z-1003a7af** | 前4步通过；第5步bool/slider保存/readback/reset均成功，最后select(1778944028)的configHTTP500。主目标新Scene sequence2/ready/slots2/visible，三个renderer仅两个injection-ready，nativeFailureEvents为空；第三个renderer具体原因待固定枚举诊断，不归为已确认的属性暂停/context故障 |

生产仍固定800×450/software VP8/CPU drawing。Local数据面7.68FPS/p95 197.72ms，Store部分8.04FPS/p95 198.86ms；为每capture至少一个真实ACK统计，不是连续屏幕FPS。Local observedCompositorFps=0，Store约1.32，截图变化另通过，尤其不能宣称Codex端60FPS。Web895116177本地生产暂停/恢复已通过，不再说完全未验证；pointer/完整UI属性、fallback层级、长时CPU/RSS/GPU/VRAM、OS media和完整双宿主仍待补。

本轮audio.outputActivity自动证据humanConfirmed=false，不算新人工听音。此前用户对09:57:49隔离音频及10:27:30旧Store音频均回复“听到了”；后者对应旧 `m2-store-20261012T022620Z-8fe69571` 的outputStartedAt=02:27:29.705Z。旧compiled owner11/11为继承历史记录，未在本轮重新定位其report、不重跑依赖禁止样本的旧入口。

### 收尾 / 恢复 / 下一步

最新两生产report均resourcesClosed=true/windows0/utility自然退出；launcher teardown自有树/端口0。`post-teardown-independent-check-02.json`独立只读核验本轮5生产目录登记身份0、workbench06–10父进程0、19636–19640监听0、受保护聊天精确身份保留。01误报因ConvertFrom-Json把ISO转DateTime，重新解析本地显示字符串丢时区/小数；02用-DateKind String修正，原01及protected-chat-independent-recheck均保留。

历史PID22304、17496的EXE路径仍不可核验，未停止；不宣称所有历史目录残留0。下一步给Store多renderer config500补有界固定枚举失败分类，定位后TDD/新build复测，不盲目重复整套、不记录认证URL/标题/正文/CDP capability/作者异常正文。当前允许矩阵5Scene/2Web，旧8/24保留为历史，不泛称当前覆盖。所有新增检查点写docs/out，不写项目或全局记忆、不commit/push/package。


## 2026-10-12 最新检查点：build06同构建限定生产双宿主12/12

证据根仍 `out/m2-20261012-preview-hd-01/`。新增固定枚举update失败分类，TDD `store-diagnostics-red.tap`8/10→`store-diagnostics-green.tap`26/26；仍要求所有renderer完成验证，不自动retry源/清failure memory。输出最多8个ordinal/category/整数CDP码/mediaState/switchFailure，不保存任意renderer/作者异常、URL/正文/标题或私有CDP句柄。

`matrix-metadata-red.tap`0/2→`matrix-metadata-green.tap`4/4（含policy）；native configuredSamples/cycles/switches改由实际5Scene/2Web推导3轮21次，feature实际子集同样推导，不冒称新矩阵实机覆盖或把旧8/24算当前禁止样本策略。

**自动化/构建**：sync06、full06 **630/630、0 fail/skip、exit0**、build06、syntax06 **15/15**、compiled CLI help、diff-check06通过。ASAR02为46entries/29unpacked/30逐文件hash通过，releaseExeGenerated=false/packagedExecutableRuntimeVerified=false；仍非打包发行EXE运行验收。hash02保存21源/编译/验证器文件（当时live pending），随后live报告另留新hash证据，不覆盖旧01/02。

### 本轮独立宿主

| 目录（out/live-acceptance下） | 结果 |
|---|---|
| m2-store-20261012T064324Z-dc20f1a7 | 启动读取样本时assert失败、产品步骤0；误把workshop/content/431960子目录传给production模式，scanner把参数当Steam根，扫描0项。正确D:/steam只读预检86项/允许样本均在后才新profile复测；原fail、强制收尾保留，不计产品回归 |
| **m2-store-20261012T064730Z-84f0333f** | **同build06、12/12/pass**；resourcesClosed=true/windows0/utility自然退出。实际首帧/来源/固定性能、暂停恢复/短时音频活动、bool/slider落盘/engine-readback/reset、Scene/dark/Web切换、Web暂停恢复、reload、failed candidate保旧/禁止自动retry/显式retry、paused source销毁/最后实际canvas不变/owned label/同IDretry、约64.6秒short soak/4次切换、restore和所有权/codec释放通过 |
| **m2-local-20261012T065424Z-0f6f4b94** | **同build06、12/12/pass**，同上限定12步骤；约64.8秒short soak，resourcesClosed=true/windows0/utility自然退出 |

**旧Store045435 config500本轮未复现，根因没有确认，也未声称修复**。本轮injectionFailureEvents只出现有意失败候选/cached retry负例所需的renderer-dom-not-ready/media-load-or-decode/native-source-failed；不是原属性返回Scene错误的复现。旧所有失败继续保留，未来复现时使用新增固定枚举诊断。

数据平面Store **4.678FPS/p95 471.717ms**，Local **9.746FPS/p95 71.195ms**，原≥4FPS/p95<750ms门槛不变；observedCompositorFps **0.082/1.900**。每capture至少一ACK统计不等于持续屏幕FPS；同宿主截图变化另通过，不宣传Codex端60FPS。工作台高清/约61renderer completion仍对应build05实测，不混用两个链路。

本轮短时音频outputActivity=true/humanConfirmed=false，旧用户听音确认不能改写为新人工确认。WE原件/日常配置/CSP/聊天/发行EXE未改，禁止3790869794未选择/播放，不commit/push/package。M2仍3/8：完整pointer/UI属性/全部类型与重启恢复/fallback层级/WE API/OS media/长期CPU/RSS/GPU/VRAM和M0/M1/发行门禁待补。64秒及自然exit/resourcesClosed不是长时泄漏或VRAM归零证明。

## 2026-10-12 Scene 桌面壳与作者属性修复

证据根：`out/m2-20261012-scene-shell-fix-1791790771949/`；作者后续在 `author-followup/`。修改前逐文件SHA-256与`.bak`留存；备份测试不再被node默认发现。未覆盖此前工作区修改、不写项目/全局记忆、不生成发行EXE。

### 根因 / 改动

1. 实际桌面入口原为file外壳→HTTP工作台→HTTP Scene。Scene的frame-ancestors校验整个祖先链，file外壳不在allowlist，旧compiled入口真实复现blocked=1。`desktop-origin`/`desktop-renderer-protocol`改为固定standard/secure内部来源`cwb-desktop://shell`；无bypassCSP、仅index/renderer/styles三项静态资源、精确URL/GET/HEAD/realpath containment/大小上限。main加载与IPC caller校验同步改为精确内部URL；仅工作台Scene lease增加该确切ancestor，直接父级消息origin和native/Codex默认边界不变。
2. `selectProject`先展示并读取作者属性，再保存selectedId；普通效果保存也会增长global revision。原author CAS因此必然或偶发误拒绝旧面板。`ConfigStore.authorPropertiesRevision(id)`与专用作者API改为按壁纸版本；全部写入在磁盘成功后追踪该壁纸变化；显式同值写仍使旧token失效。普通配置/其他壁纸不失效，同壁纸并发、ABA、generic author replacement与reload仍拒绝旧值；128项有界tombstone耗尽时失效所有旧token，而不是淘汰后恢复旧版本。无配置schema迁移。
3. GPU工作台与nativeDelivery是独立路径；之前API只查询native，所以仅本地预览时actual未取得。复用严格Scene消息链增加单飞属性request/ACK与3秒上限，ACK来自实际getProperties并逐字段类型验证，绝不回显保存值充当实际读回。取消/超时/全无有效值不伪报成功。面板明确source=`workbench-preview`，不算Codex宿主效果或全部作者脚本支持。
4. 初始化/重载未await Scene首帧，面板先读完且同ID select直接返回，Scene迟就绪不会更新readback。M1 commit通知`refreshWhenIdle`，busy时合并一次延后读取、选择变化清除请求；不自动重试保存、不跨选择更新、不清除真正的CAS冲突。

### TDD / 验证证据

- 作者初次红测40 pass/8 fail→47/1（mock timer清理负例）→48/48。迟就绪红测6/8→50/50；无有效读回红测6/7→最终组合`targeted-final.tap` **85/85**。包含普通配置/另壁纸不失效、真实并发/ABA/generic replacement/reload、磁盘失败不变、容量失效、origin/source/channel/request/sequence拒绝、单飞/超时/取消、不伪造读回、延后合并与选择隔离。
- 最终`sync-final.log`、`build-final.log`通过，syntax **17/17**，compiled CLI help通过。`full-final.tap` **653项：648 pass/5 fail、exit1**。所有5 fail来自本轮开始前已有`test/m2-compiled-snapshot.test.mjs`：4项缺`scripts/m2-compiled-snapshot.mjs`，1项production verifier未接freezeCompiledBuild；没有删测试、放宽断言或声称全量通过。第一次full-01误发现3个备份测试的失败保留；后续备份改`.bak`，最新不再发现。

### 实际编译桌面入口（非替代BrowserWindow / 非Codex宿主）

| 目录（out/live-acceptance下） | 结果与边界 |
|---|---|
| m2-desktop-shell-2026-10-12T07-52-00-015Z-5dc1bba0 | 旧入口明确复现desktop_scene_blocked_by_response，blocked=1；失败保留 |
| m2-desktop-shell-2026-10-12T08-01-01-346Z-b24c804e | 新入口前4步通过：实际首帧/动态画面/6次切换；reload泛化错误未计通过，原失败保留，不追认根因 |
| m2-desktop-shell-2026-10-12T08-19-37-808Z-0731b342 | 新作者保存/checkbox/slider/落盘/readback/reset通过；reload实际Scene已ready，但属性面板未更新导致timeout，推动迟就绪修复；正常自然收尾 |
| m2-desktop-shell-2026-10-12T08-25-34-484Z-bb09c755 | 迟就绪修复后fresh profile **7/7/pass**；blocked=0、resourcesClosed=true |
| **m2-desktop-shell-2026-10-12T08-29-59-882Z-b05dcf6a** | **最终构建7/7/pass**；实际compiled desktop隔离启动、三层/WebGL首帧、实际draw completion/截图变化、真实UI六次切换、普通效果保存后checkbox/键盘slider落盘及工作台getProperties读回、reset、再保存并重载恢复。blocked=0，10项compiled前后hash相同，desktop exit0/UtilityProcess自然退出/resourcesClosed=true |

`verify-m2-desktop-shell.mjs`只创建并查询本次自有桌面、loopback端口和隔离acceptance root。target sentinel为验证器自身Node，不启动/连接/注入Codex；reload用新document marker排除退休control frame，不把Scene必定当OOPIF；错误仅固定枚举与白名单metadata，不保存capability URLs/作者异常正文。只选1778944028/3444535389，audio=false，排除3790869794。最终截图`desktop-author-properties.png`/`desktop-after-reload.png`留存。

独立只读收尾`author-followup/post-cleanup-final.json`：4个本次报告、8个登记PID/精确创建时间/EXE身份、8个调试/控制端口，remainingOwnedIdentityCount=0/remainingListenerCount=0/processesStopped=false；自然退出不代表原生托盘交互验收或VRAM归零。`diff-check-final.log`与15文件增量空白检查通过，25项source/compiled/docs SHA-256在`final-hashes.json`。

### 交付 / 未完成项

源码/dist已重建；需要重启源码工作台加载新main/renderer，旧发行EXE未替换，不需要关闭Codex。该轮源码不能套用build06历史双宿主/ASAR通过结论；该轮未重新验收Store/本地EXE生产属性面板、所有作者类型或长期CPU/GPU/VRAM。M2仍 **3/8**、M0/M1与发行门禁不变；既有compiled-snapshot缺口与历史Store config500根因仍未完成。

## 2026-10-13 交付：Store 桌面“应用到 Codex”限定修复

用户截图为“一个或多个 Codex renderer 未能完成注入验证”；用户允许可见独立profile实机测试，随后明确选择“先交付Store修复”。本轮保留所有renderer身份/首帧验证，不将提示改成无条件成功。证据根 `out/m2-desktop-native-path-fix-20261012T091512Z/`；deadline后续在 `timeout-followup/`，源码改动与实机发生于10月12日，10月13日续做回归/只读复核/交付。

### 三项已确认原因与最小修复

1. **模块相对资源基址**：desktop main打包时内联native host→owner→scene-server，`import.meta.url`变成 `dist/main.mjs`，vendor/public资源路径不再相对native模块。新增 `scripts/desktop-main-build.mjs`，只处理source main的确切 `./desktop-engine-host.mjs` import，externalize到已有 `./bridge-runtime/src/desktop-engine-host.mjs`。不全局externalize同名导入，不加机器绝对资源配置，不手改dist；原compiled host本来就在unpacked清单中。TDD原1pass/2fail→3/3，含实际main输入图、真实relocated fixture资源URL及无关entry反例。
2. **客户端总等待过短**：可见Store实际Apply15秒fetch超时，但服务端随后完成两个renderer的native/DOM初始化，无native-frame-error。`src/bridge-runner.mjs`仅inject默认60秒，restore/其他动作仍15秒；显式override/abort/失败响应保留。TDD8/9→9/9。
3. **服务端socket idle不匹配**：原媒体服务全局30秒idle会在60秒客户端预算内、尚无响应字节时断开合法长inject。`bridge-runtime/src/media-server.mjs`在token、方法、Origin、body/action、handler与library busy验证之后，仅inject `response.setTimeout(60_000)`；30秒全局idle、10秒headers和其他操作不变。实际HTTP测试把idle缩为20ms、handler延迟60ms，原3/4→修复4/4；restore/非法请求/GET/跨来源不获得额外预算，第二次验证失败仍传播。

没有扩CDP命令15秒、放宽CSP/身份/首帧验收、清除源失败缓存或自动retry。60秒是有界等待，不代表任意renderer数量/机器负载均可完成。源备份、红/绿测试、sync/build日志均保留；`restore-m2-owned-window.ps1`与修复前backup hash一致，未引入EnumWindows。未新增依赖、不改日常配置/WE原件/官方安装包、不生成发行EXE、不commit/push、不写项目或全局记忆。

### 实际 compiled desktop UI 到真实宿主

以下目录均位于 `out/live-acceptance/`，不以替代provider或隔离Electron mock充当真实Store证据。

| 目录 | 结果与边界 |
|---|---|
| `m2-desktop-apply-store-2026-10-12T09-37-12-565Z-a45db85d` | Apply外层15秒fetch失败，后续native/DOM附件成功、无native-frame-error；失败报告保留 |
| `m2-desktop-apply-store-2026-10-12T09-47-59-596Z-c4b9814d` | 客户端修复后6/6功能步骤，无native-frame-error；服务端idle修复前的历史成功，fixture Codex强制收尾，不算自然退出 |
| **`m2-desktop-apply-store-2026-10-12T10-21-38-012Z-c2c1b0a9`** | **最新双层deadline构建6/6功能步骤**；首次Apply约41.2秒，native sequence77→78/800×450实际canvas hash变化，Scene→Web→Scene，Restore/Apply组合约53.6秒及最终Restore移除自有runtime/DOM。10compiled/38runtime前后哈希一致，聊天/日常config/3样本manifest保留；存在下述取消解码及fixture自然退出缺口，不能称整个验证器pass |
| `m2-desktop-apply-local-2026-10-12T09-51-43-035Z-b3d408dc` | fetch失败，后续CDP Runtime.evaluate超时；desktop/Codex精确强制收尾，失败保留 |
| `m2-desktop-apply-local-2026-10-12T10-07-18-618Z-4b063b4d` | 服务端idle修复后仍CDP Page.enable超时，尚未进入native初始化；desktop/Utility自然退出，Codex精确强制收尾，未解决 |
| `m2-local-cdp-entry-probe-2026-10-12T10-13-43-850Z-89a47e44` | 旧本地EXE单独启动、不运行工作台、不注入；Runtime.evaluate5ms/Page.enable2ms/Runtime.enable3ms通过，非壁纸验收 |
| `m2-desktop-cdp-probe-local-2026-10-12T10-19-23-268Z-dc29e48f` | 同样source CdpSocket在实际compiled Scene工作台运行环境、不注入壁纸，单app page的Page.enable15秒超时。仅证实环境差异相关，不能归因为已确认GPU/资源竞争/VP8故障 |

更早隐藏窗口无可核验HWND、expectedProcess schema或protected-chat前置失败全部保留，不计产品步骤。本地probe脚本仅在证据目录，不属于交付产品代码；按用户选择本轮不再扩大本地专项。

**最新Store未通过边界**：10:22:53.499Z（Scene/Web切换步骤内）记录单个固定枚举native-frame-error：stage=accept/reason=decode、decodeStage=output/decodeKind=Unknown、diagnostic signal=cancelled/decoderState=closed/queueSize0/outputs0/documentHidden=false。该步骤和后续显式切回成功，但未确认此事件无害，不能标零解码错误或完整切换稳定性已通过。没有修改处理逻辑掩盖该事件。

最新报告outcome=pass指6个功能步骤；desktop自然exit0、UtilityProcess自然退出，自有Codex在Browser.close后仍驻留，精确强制停止 `forcedOwnedStops=[codex]`，因此resourcesClosed=false/整个验证器exit1。Restore通过、自有测试树最终无残留与自然退出/托盘门禁是不同结论，不混用。

### 回归、续做与只读收尾

- root `build-boundary-red.tap`/`build-boundary-green.tap`：1/3→3/3；followup `deadline-red.tap`/`deadline-green.tap`：8/9→9/9；`socket-red.tap`/`socket-green.tap`：3/4→4/4。`targeted-server-green.tap` **106/106**、`sync-server.log`/`build-server.log`通过。
- root早期全量656项651/5；最新正常权限 `timeout-followup/full-final-normal.tap` **659项654pass/5fail、exit1**。4项缺 `scripts/m2-compiled-snapshot.mjs`、1项production verifier未接freezeCompiledBuild，均为已有 `test/m2-compiled-snapshot.test.mjs`，未删测试或扩大本次范围。沙箱 `full-final.tap` 560/99含Windows realpath/temp EPERM，保留并用同源码正常权限复核，不误报99个源码缺陷。
- 一次后续专项审批因审批服务额度故障未执行，不是安全拒绝，未绕过审批。10月13日用户“继续”后仍经正常审批，`targeted-final-20261013-normal.tap` **16/16、exit0**；`syntax-final-20261013.json` **10/10**，compiled CLI help和仓库/增量diff检查通过。
- `timeout-followup/post-cleanup-final-20261013.json`只读核验11份本轮报告、23登记PID/7位创建时间/EXE与测试端口：remainingOwnedIdentityCount=0/unavailableIdentityCount=0/remainingListenerCount=0/processesStopped=false；受保护聊天精确身份、日常config哈希与最新实测一致。10项compiled/38项runtime哈希无漂移，10月13日不冒称新实机测试。仅登记身份/端口检查，不算全部历史后代、原生托盘或长期VRAM归零证明。
- 最终增量变更/哈希/收尾在根 `result.md`、`result.json`、`changes.patch`、`final-hashes.json`；这些是限定修复证据，不是发行包。

### 交付范围与下一步

已重建项目源码/dist，用户需重新启动项目壁纸工作台加载新main，再“应用到Codex”；无需关闭当前Codex，旧发行EXE未生成或替换，packaged executable runtime未验。最新Store只支持上述已验证的限定流程；仍有切换取消解码事件、fixture自然退出缺口与旧本地EXE联运行问题。取消事件、本地CDP和既有编译快照缺口分别作为后续任务，不用60秒等待修复宣称它们全部解决。

只使用允许Scene3025975631/1778944028与Web3785016842、audio=false；禁止3790869794未选择/播放。M2仍 **3/8**、完整功能组0/23；M0/M1、完整作者类型/双宿主UI/WE API/fallback/OS media/长期CPU/RSS/GPU/VRAM及发行门禁不变。
