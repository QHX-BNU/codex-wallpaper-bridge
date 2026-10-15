# M3 Windows 实机验收记录（2026-10-15）

## 结论

最新后台收口见 [M3后台收口](M3_BACKGROUND_CLOSURE_20261015.md)：工作台就绪/取消及helper显式恢复修复，相关74/74；仅电源读取的真实隐藏helper→编译HTTP同设置保存重启9/9，两次自然exit0、`forcedStops=0`。这不是Codex宿主托盘退出或物理电源切换验收。**内存增长定位与长期资源测试已按用户最新决定后置**，下文历史测量保留但不再自动续跑。

M3 为**部分通过，整阶段未通过**。最新源码/后台续做：在线歌词状态/取消/本地覆盖、媒体去重与同曲重开修复，10文件专项97/97、真实在线服务6/6、真实系统媒体→offscreen readonly Web14/14、隔离编译/HTTP通过；测试scratch及截图6个F盘目录约960MiB已清理。历史10分钟与最新60秒内存分解已记录，但进程内存仍增长，长期性能未通过。详见 [最新源码与后台续做](M3_FOLLOWUP_20261015.md)。前轮封面/视频暂停就绪修复与系统媒体26/26见 [前轮交付](M3_REMAINING_20261015.md)；缓存跨物理盘/Windows独占/中断恢复及旧Store/Local身份/应用/Restore历史证据保留，不拼为同一构建完整验收。

仍开放：Store/Local可见视频首帧及完整隐藏/恢复/省电链、Codex宿主内Web音乐链和宿主自然退出；ffmpeg/ffprobe继续暂缓，物理拔插电、音频设备切换、长期资源与发行EXE/ASAR未验收。在线歌词不再属于未连真实服务项。**用户已确认测试窗口是自己手动最小化，且不希望前置**；收到后不再前置或恢复宿主，相关失败不能据此判定为宿主自行隐藏或解码器故障。背景真实浏览器证据不替代这些门禁，不拼接为双宿主端到端通过。

## 安全与环境边界

- 用户批准另开 Store 与本地 EXE 两个独立测试实例；测试使用独立 `--user-data-dir`、`CODEX_HOME`、`HOME`、`USERPROFILE`、`LOCALAPPDATA`、`APPDATA` 和 `XDG_CONFIG_HOME`。
- 只按 PID、创建时间、EXE、profile 与 loopback listener 精确核验和清理；未按 EXE 名批量结束进程。
- 当前聊天身份、日常配置哈希、冻结 compiled snapshot 和验收涉及的源码 SHA 在每轮收尾均保持不变。未选择或播放 `3790869794`，未改 Wallpaper Engine 原件、共享 `dist` 或发行包。
- 自建音频播放器、Chromium MediaRecorder VP8 WebM 和隔离壁纸均属于本次运行；不控制日常播放器。ffmpeg/ffprobe 继续暂缓，未安装或下载。

## 前轮分项结果（原失败保留；最新封面与背景Web结果见上）

| 任务 | 实机状态 | 证据与边界 |
|---|---|---|
| M3-01 播放/隐藏/省电 | **未通过** | 两宿主成功应用自建视频，但 Store 最终探针为 `document.hidden=true`、`readyState=0`、0×0、0 帧，未取得可见解码首帧；因此隐藏暂停、显示恢复、模拟电池/AC及手动暂停保持均不能计通过 |
| M3-02 系统音频与媒体 | **部分通过** | 真实 WASAPI 捕获自建 440 Hz/880 Hz，暂停后归零；GSMTC 曲名、20 秒时长、播放状态和进度增长通过。封面在 WinRT 与 Electron 自建发布器上均为 0 字节；真实 WinRT RandomAccessStream 的 COM `IStream` 读取专项通过，但不能证明发布器提供了 Thumbnail |
| M3-03 歌词与控制 | **部分通过** | 控制默认关闭返回 409；显式启用后的 pause/play/next/previous、旧 session 409和本地 LRC 三行持久化已有同轮通过证据。后续一轮 next/previous 的 HTTP 200 晚于 5 秒观察窗，播放器最终计数各增加 1，但该轮仍按失败保留。Web 壁纸回调因宿主视频阶段提前失败而未执行 |
| M3-04 转码与帧率 | **未实机验收** | 本机无 ffmpeg/ffprobe，用户要求暂缓；缺工具降级与可注入后端专项通过，不等于真实转码或硬件回退 |
| M3-05 Faststart/Range | **专项通过，宿主未通过** | 真实可解码的自建 VP8 WebM 已生成/复用；Faststart/Range 字节合同专项通过，但 Store/Local 未取得该视频可见首帧 |
| M3-06 缓存迁移 | **实机通过** | D 盘 Disk 1 → F 盘 Disk 0；`FileShare.None` 独占时安全失败且配置不变，解锁后 32 MiB 源/目标 SHA 一致；未知文件不复制且源保留；真实 `.part`、精确终止自有复制子进程、journal 保留、新 owner 恢复 128 MiB 且 SHA 一致；环境覆盖路径禁迁移通过 |
| M3-07 性能与完整回归 | **未完成** | 无真实 ffmpeg 基线、双宿主首帧、长时 CPU/RSS/GPU/VRAM、音频设备切换、物理电源、发行包和自然退出证据，不定义性能阈值 |

## 双宿主与窗口诊断

- Store 与本地 EXE 的 CDP owner、EXE、创建时间、独立 profile 和 loopback listener 均验证通过；两宿主应用 `m3-owned-video` 均为 `sessions=1, failed=0`，Restore 后壁纸 DOM 均移除。
- 验收脚本已改为：控制/LRC 在封面等待之前执行；每个请求前刷新 session；启动第二宿主前最小化第一宿主；renderer 目标使用有界稳定等待；每个阶段只恢复和更新当前宿主，另一宿主保持最小化。
- `m3-20261015T010709097Z-6759e45e` 中 Store 一度可见，但 12 秒后再次 hidden；`m3-20261015T011403168Z-4c6b014e/local/renderer-targets.json` 记录候选 target 持续 `visible=false`。这些是原始观察，不证明解码器故障。后续Win32时间线记录真实iconic/最小化，用户明确确认手动操作；没有排除干预的独立可见验收前，不把历史观察归因成产品窗口故障。
- Store/Local 均未自然退出，最终依赖身份复核后的精确强停；强停只证明安全收尾，不计自然退出通过。

## 自动化回归

- `node --check scripts/m3-live-acceptance.mjs`：exit 0。
- `node --test test/m3-native-cleanup.test.mjs test/m3-native-thumbnail.test.mjs`：正常权限 **2/2**；沙箱内的 PowerShell `AuthorizationManager` 拒绝记录为环境失败，不覆盖正常权限结果。
- `node --test test/m3-*.test.mjs`：正常权限 **60/60**，exit 0，包含缓存、Faststart/Range、媒体/LRC/控制、WinRT 清理/缩略图、播放策略、HTTP/任务/工具和 UI 接线。专项不能替代上述失败的实机门禁。

## 原始证据索引

- 缓存、WinRT 系统媒体、双宿主身份/应用/恢复：`out/live-acceptance/m3-20261015T003140561Z-6d3837c3/result.json`（38 pass / 4 fail；视频、封面、自然退出失败）。
- 原重叠窗口探针：`out/live-acceptance/m3-20261015T005211515Z-545a7690/store/video-failure-probe.json`。
- 控制/LRC 顺序修正后的完整音乐控制：`out/live-acceptance/m3-20261015T010134941Z-454bfa59/result.json`（30 pass / 4 fail；Local renderer 门禁提前失败）。
- 逐宿主隔离成功但 Store 视频未就绪：`out/live-acceptance/m3-20261015T010709097Z-6759e45e/result.json` 与 `store/video-failure-probe.json`（37 pass / 4 fail）。
- 唯一 Local renderer target 持续隐藏：`out/live-acceptance/m3-20261015T011403168Z-4c6b014e/result.json` 与 `local/renderer-targets.json`（27 pass / 7 fail）。

## 后续最小动作

1. 保持不前置；Win32/renderer只读时间线工具已交付，宿主前置操作默认拒绝，不能再次自动尝试恢复窗口。
2. 用户愿意保持可见时，再分别手动验Store/Local首帧、隐藏/恢复、省电、手动暂停保持及宿主Web音乐链，不重复整套M3。
3. 封面读取已修复并有真实GSMTC证据，不再列为发布器能力限制；不控制日常播放器凑通过。
4. 在线歌词历史6/6与本轮power-only恢复9/9分开计；ffmpeg/ffprobe继续暂缓，**内存与长期资源明确后置**。物理拔插电、音频设备切换及发行EXE/ASAR须按用户后续选择单独验收，不重复整套M3。
