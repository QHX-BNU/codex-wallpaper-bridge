# M3 剩余项交付（2026-10-15）

## 当前结论与最新边界

本轮补齐了两个实际代码缺陷和不前置的验收链路；**M3 整阶段仍未验收完成**。用户再次明确 ffmpeg/ffprobe 继续暂缓，并确认测试期间是自己最小化了独立窗口、**不希望测试窗口前置**。收到该要求后，不再启动、恢复或前置 Store/Local；后续只有无窗口自建播放器、offscreen Chromium 和定向测试。

原 Store/Local `hidden/ready0` 证据保留，但不能用它断言宿主自行隐藏或解码器故障；用户干预与以下独立复现的软件竞态分开记录。M0/M1/M2、发行包与完整同构建双宿主门禁不补勾。

## 执行清单

- [x] 读取计划/状态/handoff，保留已有未提交修改；改前 SHA/备份在 `out/m3-remaining-20261015-093452/before/`。
- [x] 封面读取：先用真实 WinRT 流复现原生产 PowerShell 路径失败，再修复并实际读取 GSMTC 封面。
- [x] 视频就绪：复现策略暂停、解码中暂停及 loadeddata→首个绘制回调间暂停的竞态；修复后仅定向回归。
- [x] 禁止意外前置：宿主验收默认 fail-closed，必须显式 opt-in；背景播放器固定 `show:false`。
- [x] 原生媒体、真实只读 Web 回调、取消/释放/自然退出和短时资源测量完成。
- [x] 同步 override/runtime、独立压缩/混淆编译、专项测试与精确身份只读收尾。
- [ ] 双宿主可见首帧/真实最小化与恢复/人工托盘退出，留作用户允许可见窗口后的人工专项。
- [ ] ffmpeg/ffprobe 按用户选择暂缓；物理电源、真实音频设备切换、在线歌词、长期资源和发行包不以本轮证据替代。

## 代码修改

1. `bridge-runtime/native/windows-media.ps1`：Windows PowerShell 5.1 的 WinRT 流可能是 `System.__ComObject`，动态 `Size` 属性缺失不是空流。原代码因此从未进入读取。现在直接调用已有 C# bounded reader，仍限制 2 MiB 输入、32 KiB 缩略图和十次轮询，保留资源清理/旧封面清空。回归实际执行生产 PS 片段，而不是只测试 C# 转换器；同时验证超限流拒绝。
2. `bridge-overrides/src/injected-renderer.mjs`：普通视频被隐藏/电池/用户意图暂停时，不能仍按创建时 `playing` 等待 compositor callback。暂停态只在已解码数据/非零尺寸后就绪；播放态仍等待真实视频回调。暂停发生在 loadeddata 后也能完成就绪。两条普通媒体路径均覆盖，runtime 升为 `0.6.0-m3-media-policy-v2`，避免复用旧函数。**解码就绪不是屏幕可见首帧证明。**
3. `scripts/m3-acceptance-options.mjs` / `m3-live-acceptance.mjs`：按 `media/window/playback/web/soak` 定点运行；宿主专项要求单一宿主及 `--allow-foreground`，默认无前置授权时在任何 profile/进程操作前拒绝。实际失败返回非零退出码；资源采样不虚构性能阈值。
4. `scripts/m3-window-state.ps1`：只读取精确 PID/创建时间/EXE/profile/listener 核验后的窗口 visible/iconic/cloaked/rect，不读取窗口标题或聊天内容。
5. `scripts/verify-m3-background-web.mjs` / `m3-background-web.cjs`：全新隔离目录、自建 WAV/PNG、真实 WinRT/WASAPI/GSMTC 和 readonly Web shim，经 loopback 与受控消息链路验证真实回调/opt-in 控制。BrowserWindow 固定 `show:false, offscreen:true`，没有 show/focus/restore 路径；不使用或改动真实 Codex、日常播放器、配置、WE 原件、共享 dist 或发行 EXE。

## 本轮证据

各运行是不同层次，不相加、不拼成一次双宿主端到端通过。

| 层次 | 证据 | 结果 |
|---|---|---|
| 封面 red→green | `out/m3-remaining-20261015-093452/thumbnail-red-normal.tap`、`thumbnail-green-normal.tap` | 原生产 PS 片段真实失败→封面/清理 2/2 |
| 暂停竞态 red→green | 同目录 `readiness-red.tap`、`readiness-race-red.tap`、`readiness-race-green.tap` | 复现暂停等待不存在的绘制回调；修复后通过 |
| 最终相关专项 | 同目录 `targeted-final-02.tap` | **13 文件，95/95，exit0，约 1.52 秒**；没有全量测试 |
| 实际系统媒体 | `out/live-acceptance/m3-20261015T013929640Z-43ee7fe3/result.json` | **26/26**；封面 1207 字符 data URL、频谱/曲目/时间线/本地 LRC/默认关闭控制/四种显式控制/旧 session 拒绝/无播放器清空/helper 自然退出 |
| 不前置真实 Web 链 | `out/live-acceptance/m3-background-1792029422246-c0dc0739/report.json` | **14/14，exit0**；频谱/元数据/实际图片解码/歌词/控制默认关闭和显式 pause；暂停时作者帧/定时器/音频回调增量均 0，恢复、无播放器清空和 release 通过；所有自建进程自然退出、helper `forcedStops=0` |
| 实际窗口约束 | 同背景目录 `background-state.json` | `visible:false, offscreen:true`；不是 Store/Local 可见宿主验收 |
| 短时资源原始数据 | 同背景目录 `resources.json` | 5 组、约 32 秒；CPU 整机归一化 0.28–0.87%，RSS 约 578–594 MiB，dedicated 约 12.62 MiB。仅测试进程树与 offscreen 样本测量；不是长时泄漏结论/屏幕 FPS/任意视频阈值 |
| 隔离编译 | `out/m3-a-20261014/remaining-final-20261015-01/compile-proof.json` | 4 种压缩/混淆 bootstrap ready/power 均通过，61.4–90.5 KB，4 组同步 SHA 相同；未重建共享 dist |
| 最后独立只读收尾 | `out/m3-remaining-20261015-093452/post-cleanup-02.json` | 9 个登记身份无残留、4 个验收端口无监听；当前聊天身份/两项日常配置 SHA 保持；未停止进程。本机有 1 个电池设备，物理电源未操作 |

沙箱 PowerShell AuthorizationManager 拒绝、临时文件 rename EPERM、两次窗口专用诊断错误，以及用户最小化后的窗口失败全部保留。首次独立收尾因 PowerShell JSON 自动日期转换/尾零格式比较误报；复核原 PID/创建时间/EXE 均未变，改用 UTC ticks 后通过，原报告不覆盖。

## 用户后续最小验收

目前不自动运行以下操作。用户自行加载新源码工作台后，在 Store 和 Local 各自完成：

1. 应用普通视频，保持窗口可见并确认真正动态首帧；不要把按钮结束/解码就绪当作可见帧。
2. 手动最小化→恢复，核对自动暂停/恢复；手动暂停后重复操作，不应擅自恢复播放。
3. 若方便，实际切换电池/AC，验证自动暂停与用户意图；随后自行选择托盘退出，检查辅助进程停止。
4. 只有再次明确允许前置窗口时才运行带 `--allow-foreground` 的宿主专项。后台 Web 专项可单独运行：`node scripts/verify-m3-background-web.mjs --approved-background-media --sample-seconds=30`。它不代表双宿主验收。

回滚仅撤本轮增量，保留既有修改、历史失败和用户数据。没有新增第三方依赖、没有下载 ffmpeg、没有打包/替换 EXE、没有提交/推送或写记忆。
