# M3-A 媒体与播放策略（2026-10-14）

## 2026-10-15 最新后台收口

新增工作台普通视频首帧等待中暂停/取消的就绪与释放保护，及helper退出/启动失败后相同设置保存重试；10文件专项74/74，编译HTTP→真实隐藏power-only helper恢复/自然退出9/9，`forcedStops=0`。不采音频、不读播放器、不操作物理电源；不替代宿主或设备切换验收。**内存增长定位和长期资源按最新用户决定后置**，继续不前置、不下载ffmpeg、不打包、不全量。详见 [后台收口](M3_BACKGROUND_CLOSURE_20261015.md)。

## 2026-10-15 前轮源码与后台续做

在线歌词查询状态/工作台反馈、取消/本地覆盖竞态、媒体快照去重与同曲重新开启已修复；10文件专项97/97，真实在线歌词服务6/6，不前置系统媒体→offscreen Web14/14，隔离编译/HTTP通过。临时歌词、素材、profile、编译副本和截图6个F盘测试目录约960MiB已删除。10分钟历史测量与修复后60秒资源诊断均记录；GC后JS/DOM基本稳定但进程内存仍增长，不能标无泄漏。仍不前置、不安装ffmpeg、不打包EXE、不跑全量；实机、物理操作、长期资源和发行门禁开放。详见 [源码与后台续做](M3_FOLLOWUP_20261015.md)。

## 2026-10-15 前轮续做（历史）

封面COM `Size`读取误判与普通视频暂停就绪竞态已修复；13文件专项95/95、4种独立压缩/混淆bootstrap通过。真实系统媒体26/26（封面/无播放器清空包括在内），不前置的真实媒体→offscreen readonly Web链14/14，支持实际频谱/封面解码/歌词/显式控制/暂停恢复及自然退出。用户确认此前手动最小化并要求不前置，后续宿主前置默认拒绝；ffmpeg继续暂缓。背景证据不替代Codex双宿主可见首帧、物理电源/设备切换、长期资源和发行门禁。详见 [M3剩余项交付](M3_REMAINING_20261015.md)；以下保留原轮次历史。

## 后续实机验收（2026-10-15）

用户随后授权两个完全隔离的 Store/本地 EXE 测试实例及自建系统媒体。真实 WASAPI 捕获自建 440 Hz/880 Hz、暂停归零，GSMTC 曲目/20秒时间线、本地 LRC、控制默认关闭、显式 pause/play/next/previous 与旧 session 拒绝已有通过证据；辅助进程自然退出且 `forcedStops=0`。GSMTC封面在自建WinRT/Electron发布器上仍为0字节；Web壁纸媒体/歌词/控制回调因宿主视频阶段提前失败未执行。双宿主视频隐藏/电池/手动暂停链及宿主自然退出未通过。完整证据和失败边界见 [M3实机验收](M3_LIVE_ACCEPTANCE.md)；这些结果不回写成一次完整端到端通过。

## 授权与边界

用户明确授权开始 M3-A（M3-01–03）开发。保持 M0/M1/M2 完整实机和发行门禁开放；本轮不启动、注入、刷新或关闭 Store/Local，不采集日常系统声音，不操作真实播放器，不读取日常配置或凭据。M3-B 不在范围。保留既有脏文件及所有失败证据，不改 vendor、共享 dist 或发布 EXE，不写项目或全局记忆。

## 设计与执行清单

- [x] 01 代码与专项：统一纯数据播放策略；用户 playing 持久化，可见性/电池原因临时保存在运行时；视频/GPU/预览恢复不覆盖手动暂停。
- [x] 02 代码与专项：Windows WASAPI 输出回环 + GSMTC Now Playing 自有 stdio 辅助进程，独立默认关闭开关；有界频谱/封面/时间线输入，旧进程退出后才可重启，退出封闭新操作。实际系统采集/GSMTC 尚未启用验收。
- [x] 03 代码与专项：本地受管 LRC 优先；在线歌词默认关闭、固定服务、有界超时/取消；播放器控制明确 opt-in、能力白名单、session 检查，Web 私有消息桥，不给作者控制服务 URL 或执行权限。
- [x] 测试：红/绿 unit、真实 loopback HTTP 与 VM 集成、原播放/配置/媒体 Web 直接依赖回归；最终23个相关文件 **228/228**（TAP约6.01秒），无全量/长时/真实音频或播放器操作。
- [x] 打包源码与隔离编译：同步4组 override/runtime SHA一致，辅助脚本+DLL资产复制/精确unpacked清单接通，隔离压缩/混淆及4种跨realm bootstrap检查通过，不覆盖共享 dist。没有生成或替换发行EXE。

风格基线：既有两空格 Node ESM，runtime 单引号/override 双引号，固定错误标识；DOM textContent，不新增第三方依赖。TDD 与完整代码审查同时联动。

依赖图仅复用旧 cache（未重建/写记忆），由实际 grep/读取复核：config → CLI/HTTP/UI → renderer bootstrap → M1 media slots/GPU preview → typed Web input。OS producer 作为 CLI 自有独立源，不另造壁纸切换器。性能敏感处只发送128个归一化频谱、15 Hz上限、单个在途分发/最新值，元数据有界；无PCM、媒体正文或歌曲信息诊断日志。

NFR：所有配置变更沿既有串行保存；provider configure/close串行、generation/session栅栏防旧事件；命令超时且不自动重试有副作用控制；不支持平台/无播放器/采集失败明确 unavailable；封面32KiB、LRC128KiB/2000行、有限缓存，子进程stdout/命令均限长；网络仅显式开关后固定歌词服务，关掉时取消请求。播放原因不落盘。

修改前备份/SHA：`out/m3-a-20261014/before/`、`before-hashes.json`。回滚只撤本轮增量，不覆盖既有 M1/M2 改动。证据类型：命令+退出码、TAP/HTTP/VM测试、编译结果；不以这些代替真实播放器/Store/Local。

## 当前结论与接口边界

**M3-A 本轮定义的开发子项已交付，后续实机仅部分通过，整项实机验收未通过。** 该M3-A执行时M3-B未开始；后续用户授权的M3-B进度见 [M3视频记录](M3_VIDEO_EXECUTION.md)，实机结果见 [M3实机验收](M3_LIVE_ACCEPTANCE.md)。M0/M1/M2完整门禁及发行状态不变。

| 能力 | 当前接入 |
|---|---|
| 播放/省电 | `resolvePlayback` 同一用户意图模型，`pauseWhenHidden` 与默认关闭的 `pauseOnBattery`；临时 `onBattery` 不进入配置。普通视频、GPU Scene/Web、预览及保留的独立传输适配器有状态专项 |
| 系统频谱 | 自有 Windows PowerShell/C# WASAPI **render endpoint** 回环，不采麦克风；1024点FFT，64左+64右、0..1、原生线程上限15Hz；只发数值，不存PCM。设备变更/静音恢复有代码，真实设备尚未测 |
| Scene 分发 | 复用选中、committed、可见且播放中的GPU lease；调用锁定引擎的 `__wp.setAudioBridge`，默认零频谱抑制模拟FFT，暂停清零、恢复重放、释放解绑定。`systemAudio.received`是分发数据计数，不是OS采集/视觉验收 |
| Now Playing/封面/时间线 | GSMTC调用代码已接；媒体元数据与歌词经私有Web接口及工作台消费。**Scene当前只接系统频谱**，不冒称完整Scene媒体/歌词/播放器API兼容。曲目变更先清旧封面/歌词，无播放器则清空 |
| 歌词 | 本地LRC按歌名/歌手/专辑/时长SHA受管保存，128KiB/2000时间行、内存缓存32项；本地优先。在线仅显式开关后查询固定 `https://lrclib.net/api/get`，4秒超时/响应限长/禁重定向/关闭取消。本轮只用可注入响应，未连真实在线服务 |
| 播放器控制 | 默认关闭，仅GSMTC报告的play/pause/previous/next；私有Web扩展 `cwbMediaIntegration`（不是虚构WE官方API）及工作台按钮。session GUID绑定观察到的COM身份，执行前重验、2秒命令有效期/2.5秒响应上限，无自动重试。真实WinRT身份及播放器行为未验 |

工作台入口为「系统音乐联动（Windows）」及「使用电池时自动暂停」。采集、Now Playing、反向控制和在线歌词分别默认关闭；壁纸自身声音仍沿原 `audioEnabled`，不是系统采集开关。

保存握手不等待OS后端冷启动；源初始化独立排队、close独立等待其收尾，未提高既有保存/请求时限。EOF/优雅stop优先；必要时仅停止自有child并记录 `forcedStops`，不将其算自然退出。禁止关闭后继续创建helper，禁用后晚到事件不复活数据。非音频分发1Hz、启用频谱10Hz，最新值单在途；元数据去重，音频不去重以保障暂停恢复。

## 验证与审查

证据根 `out/m3-a-20261014/`，各轮重叠，不相加：

| 证据 | 结果 |
|---|---|
| `targeted-final-02.tap` | 中断前202/204；两处旧版本断言已更新，旧失败保留 |
| `resume-scene-red.tap` → `resume-green-01.tap` | Scene链路3条缺口红测；随后保留的旧Scene拒绝音频断言已按新合同更新，未删除来源/暂停负例 |
| `resume-lifecycle-red.tap` / `resume-close-red.tap` | 禁用晚事件、关停后启动、启动等待关闭等真实产品竞态fixture红测；原失败保留 |
| `resume-save-red.tap` | 冷启动阻塞保存红测31/32；改为独立源队列，不放宽保存门禁 |
| `resume-final-02.tap` / `resume-final-run.json` | **228/228、23文件、exit0**；实际命令/耗时/临时目录记录；HTTP/VM后端隔离，非实机 |
| `resume-syntax-final.json` | **33/33** Node语法与含未跟踪源的空白检查；`git diff --check`通过 |
| `resume-compile-final/compile-proof.json` | 压缩/混淆4种bootstrap跨realm ready/power通过，均<100KiB（约61/74/90/90KB），4组override/runtime SHA相等；compiled CLI help通过 |
| `resume-native-01/disabled-protocol.json` | 当前源码编译DLL；audio/media/power全部禁用时ready→EOF/stop→exit0，无stderr、无媒体事件；仅说明禁用模式协议与自然退出 |
| `resume-native-static.log` | 编译DLL的合成正弦/静音FFT、普通隔离对象IUnknown身份和PS语法通过；不是GSMTC/设备/真实COM会话验收 |
| `review-resume.md` / `delivery-resume.json` | 主Agent人工审查、源SHA/合同覆盖与未验项 |

复核点：默认关闭、固定可执行/脚本/参数和hidden子进程；stdout/命令/并发/缓存容量；媒体类型与来源校验、选中/退出/版本栅栏；LRC/封面路径与XSS；保存失败边界；歌词旧请求取消；控制session/能力/截止期；资源保留与精确收尾。未新增第三方依赖，未改vendor、WE源文件、日常配置或记忆。

## 真实验收待办

- Windows 真实输出设备/切换/静音，频谱与声音同步；真实播放器歌曲/封面/进度及无播放器清空。
- Store/Local 视频/GPU隐藏、电池恢复、手动暂停保持、晚接入窗口及恢复后不重装。
- 明确打开控制后真实播放/暂停/上下首，播放器切换时旧session控制拒绝；歌词本地优先及在线开关取消。
- 真实工作台关闭/托盘退出时采集/控制停止，自有进程自然退出；长时CPU/资源指标属于后续M3-07。
