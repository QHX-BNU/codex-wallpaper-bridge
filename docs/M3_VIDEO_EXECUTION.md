# M3-B 视频、Range 与磁盘执行记录

日期：2026-10-14。用户明确授权“开始 M3-B”。

## 2026-10-15 最新续做

普通视频在隐藏/电池/用户暂停以及loadeddata后首回调前暂停的就绪竞态已修复，runtime v2同步；仅相关13文件95/95，独立压缩/混淆通过，未跑全量。另补按scope/单宿主/明确前置opt-in的验收入口和无窗口资源测量，真实媒体→offscreen Web14/14、约32秒CPU/RSS/GPU/VRAM原始数据，不当作Codex视频性能或长时阈值。用户继续暂缓ffmpeg，且不希望前置；双宿主可见首帧/物理电源/宿主自然退出和发行仍待人工，M3-07不补勾。详见 [M3剩余项交付](M3_REMAINING_20261015.md)。

## 后续实机验收（2026-10-15）

- M3-06关键实机门禁已通过：D盘Disk 1→F盘Disk 0、Windows `FileShare.None` 占用失败保持旧配置、解锁重试32MiB双端SHA一致、未知文件不复制且源保留；观察到真实`.part`，精确终止自有复制子进程后journal可由新owner恢复，128MiB双端SHA一致；`CWB_CACHE_ROOT`实际/配置路径及禁迁移通过。
- 自建 Chromium MediaRecorder VP8 WebM可解码文件已生成/复用，但 Store 最终探针仍为hidden/ready0/0×0/0帧，Local renderer可见性也间歇失败；因此双宿主可见首帧、隐藏/恢复、电池/AC和手动暂停保持未通过。
- ffmpeg/ffprobe继续按用户要求暂缓，未安装或下载；真实转码、编码器回退性能及阈值仍未测。正常权限M3专项60/60不能替代这些实机缺口。详见 [M3实机验收](M3_LIVE_ACCEPTANCE.md)。

## 本轮边界与计划

- M3-04：本机 ffmpeg/ffprobe 探测；单在途任务、帧率上限、硬件失败后软件回退、进度/取消/重试；原片只读，成功校验后才发布缓存版本。
- M3-05：只读取 MP4 顶层头和有界 moov，虚拟前置并修正 stco/co64；保守回退不支持的布局。版本 URL 固定原文件身份/布局/优化选择，旧播放的 Range 不因完成转码或改配置而换字节。
- M3-06：仅迁移本项目 marker 下已知子目录的已知文件；流式复制、哈希校验后提交配置，源保留；取消/占用/跨盘/中断恢复。`CWB_CACHE_ROOT` 优先，UI 显示实际与配置路径，不迁移 WE 原件、库、配置或用户歌词。
- M3-07：先采集自有合成视频的工具/磁盘/loopback 基线，再讨论阈值。当前不承诺任意视频一秒首帧。

推荐默认：Faststart 开启，使用优化版默认关闭，帧率上限 30（可选 1–120）；没有本机工具时原片仍可播放。不新增依赖、不下载工具、不操作 Codex 或真实播放器。

## 影响面与门禁

依赖闭包已通过实码/引用检查：config-store → media-server → inventory/injection-plan 与工作台；新磁盘缓存 → 视频任务/版本读取 → server.close。runtime-only 模块直接修改；CLI/injector 真源仍为 bridge-overrides；不重建共享 dist。仓库无 build_graph.py，依赖以 rg 复核。

已有 215 项用户/前序未提交更改，本轮不 reset。改前文件与 SHA 在 `out/m3-b-20261014/before`；按局部补丁修改，不改 `.ai-memory` 或全局 memories。无数据库或新库，迁移源保留且配置最后提交；所有写入仍受 loopback/token/Host/Origin 保护。容量、输入、symlink、进程、并发和恢复在专项 TDD 覆盖，最终进行独立自审。

## 验证分层

1. 测试先行：MP4 布局/跨段 Range/拒绝路径；owned ffmpeg 超时/退出/输出上限；任务取消/重试/回退/失败保原；缓存未知文件/冲突/取消/恢复/环境覆盖；HTTP 与 UI 接线。
2. 仅相关原专项、语法、隔离 minify/obfuscate 编译、源 SHA。mock 不当作工具可用或硬件性能证据。
3. 可选本机工具 + 自有合成视频 + loopback 的实测，不当作 Codex 可见首帧。
4. 开放门禁：真实系统电源/播放器，Store/Local 同字节构建，真实可见首帧、长时资源、跨物理盘/Windows 占用/中断、发行包；不以本轮代码或测试数字补勾 M0/M1/M2 完整验收。

## 执行进度

**M3-04–06 源码/隔离专项已交付；后续 M3-06 关键实机门禁通过，但 M3-B 整阶段与 M3-07 仍未完成。** 用户回答“我应该没有安装”，未安装/下载ffmpeg。2026-10-15经用户另行授权后仅操作隔离测试宿主，结果见上，不影响原开发轮的边界记录。

### 实现与不变量

| 文件/子项 | 已实现 |
|---|---|
| `src/video-tools.mjs` | PATH或绝对环境路径；版本/编码器探测与明确降级。固定参数、无shell、强制MOV/Matroska/AVI而非任意格式自动探测；MOV外部dref/绝对引用关闭。probe8秒、转码1小时、stdout2MiB/stderr64KiB；TERM→有界KILL只针对自有child，等待close；实际退出未确认时保留所有权 |
| `src/video-optimizer.mjs` | 单任务、最多24记录；1–120帧上限且不升采样，优先一个已列出的硬件编码器，失败后软件一次回退。进度/取消/重试/校验/发布；尺寸/帧率/时长/音轨、源身份及输出哈希检查；同盘硬链接原子不覆盖发布。重试新任务/已校验缓存复用，原片不中断。子进程未退出时不删输出/不释放迁移锁 |
| `src/video-stream.mjs` | moov最多8MiB、布局池64MiB、顺序解析、32读者、2048版本记录和两小时闲置淘汰；stco/co64只修正指向mdat的offset。碎片/外部引用/未知offset结构/超限/32位溢出/零长度尾moov保原样。随机nonce版本、同会话复用、过期410且不重新绑定；每次读检查文件身份；流式跨段Range不加载mdat |
| `src/managed-cache.mjs` | 默认配置旁cache；CWB_CACHE_ROOT覆盖、实际/配置路径分开。marker owner、realpath与symlink保护；仅video的64hex.mp4/json、thumbnails的64hex.jpg/png，不扫描未知根目录。最多4096受管/16384扫描项；流式复制、双哈希校验、配置最后提交，源与未知文件保留。可恢复journal、取消/重试/冲突/失败保旧，writer与迁移互斥 |
| config/HTTP/UI | schema4加法字段；Faststart默认开、优化版默认关、30帧。普通配置接口禁止伪造cache路径。private工具/视频任务/缓存任务路由保留token/Origin/Host/body限制；GET/HEAD/suffix/If-Range/ETag/416，版本URL进入小于10KiB的注入payload。任务完成不自动换媒体；快速设置合并/最新值门控，保存失败读回已落盘状态，不假装回滚 |

没有修改CLI/injector真源；新模块沿已有CLI的media-server import自动被打包，无需新增二进制或unpacked路径。只核验已有4组override/runtime SHA；本轮未重建共享dist。源码工作台新增面板不表示已有发行EXE已更新。

### 最终证据（`out/m3-b-20261014/`）

- `related-final-04.tap`：18个直接依赖文件 **112/112**、exit0、约6.09秒。包括6个新M3-B测试文件和12个既有播放/配置/库/媒体/Scene接口专项。没有跑全量、VP8、真实宿主或长时测试。
- `syntax-final.json`：15/15。HTML控件/接线和UI单在途/快速保存/持久化失败读回使用VM测试；**不是浏览器视觉验收**。
- `compile-final-04/compile-proof.json`：压缩/混淆media-server实际loopback，Faststart/Range/旧URL稳定/原片不变、UI语法及CLI打包通过；8源编译前后稳定，4组override/runtime一致。不是发布EXE/ASAR或同构建双宿主验证。
- `baseline-03/baseline.json`：真实工具发现 `available=false/video_tool_missing`，exit2表示原生阶段未执行。自建 **16MiB结构fixture（不能解码为视频）** 准备只读108字节、保留60字节moov，准备约1.35ms；四次4KiB loopback约7.96–17.14ms，源SHA未变。无完整视频复制，无工具残留；**这些数值不是解码、GPU/CPU播放器、屏幕首帧或性能阈值依据**。
- owned Node子进程自然close/超时收尾有专项；ffmpeg取消/进度/硬件回退使用可注入后端。cache故障/取消/重开journal使用隔离真实文件与故障注入，**不冒充物理跨盘、Windows占用或实际断电/kill恢复**。

### 失败保留与自审

- 所有red测试、沙箱内realpath EPERM/loopback EACCES及早期失败保留。`http-02`的Host负例被Node fetch重写，不放宽后端门禁，改用raw HTTP；`http-03`测试辅助函数误把405文本当JSON，随后兼容既有响应。原100/100、111/111是过程检查点，不与112相加。
- 自审修正：零长度尾moov不可直接搬前；解析并发/句柄/布局内存上限；跨生命周期URL需nonce，不能以同stat+flag重发过期token；writer的退出未确认不释放；中断/冲突/配置提交失败不覆盖源或未知文件；不以硬件编码器列出当作可用；强制容器/关闭dref；rapid-setting与落盘/应用失败分开。
- 核对过路径/容量/输出转义、方法/来源/body、配置白名单/持久化、所有权/并发/取消/关闭、许可证与依赖（没有新增包）、原片/未知文件及降级路径。未发现当前专项中的阻塞问题；未验证项见下，不据此标整阶段完成。

### 使用和后续验收

1. 用户自行运行本仓库新桥/工作台后，展开“视频优化与缓存”；没有ffmpeg时可先测试Faststart设置、固定Range和缓存路径。不要把现有发行EXE当作新源码已加载。
2. 若后续**另行授权安装工具或提供已安装路径**，设置 `CWB_FFMPEG_PATH` / `CWB_FFPROBE_PATH` 给新桥进程；本轮不安装，也不替用户重启任何宿主。
3. 用新证据名运行 `node scripts/benchmark-m3-video.mjs baseline-next-01`；有工具时只生成自有720p60五秒静音视频，真实软件转码30帧与单帧解码进程墙钟基线；没有工具时exit2。单帧解码进程时间含启动，不等于Codex可见首帧；不能据此直接给任意视频阈值。
4. 编译复核：`node scripts/verify-m3-video.mjs compile-next-01`；fresh目录，不重建dist。UI“优化当前视频”→进度/取消/重试→完成后“应用已验证优化版”，共用M1媒体就绪切换；缓存迁移是复制/验证/根切换，**源保留，不自动释放旧盘空间**。
5. 真实门禁：安装/版本/硬件驱动、真实可解码视频各容器与尾moov/巨大moov/损坏/慢盘；跨物理盘/Windows独占/强中断与多进程；真实播放器/电源/显示隐藏策略；同字节Store/Local首帧、切换/恢复/长时资源/自然退出和发行。测到合适真实基线后才定义阈值。M0/M1/M2完整门禁仍开放，禁止样本未访问。

改前8文件备份与SHA在`before`，本轮新增文件不覆盖既有源；回滚只撤销本轮增量，保留M0/M1/M2/M3-A用户改动、失败证据和日常数据。不写项目/全局记忆。
