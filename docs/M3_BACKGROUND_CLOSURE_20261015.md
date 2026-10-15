# M3 后台剩余项收口（2026-10-15）

## 范围和执行计划

用户要求继续 M3；沿用不前置/恢复/启动可见窗口、不下载 ffmpeg/ffprobe、不生成 EXE、不跑全量的边界。**内存增长定位与长期资源测试按最新决定后置**，不再作为本轮下一步。保留旧失败，不修改日常配置、WE 原件、共享 dist、旧 EXE 或项目/全局记忆。

本轮只补只读核对发现的两条现有功能缺口，不另开 M4：

1. 工作台普通视频的 `loadeddata` → 首个绘制回调之间切为手动/隐藏/电池暂停，原实现不能结束就绪等待。修复后仅接受已解码且尺寸有效的视频；播放态仍等待帧回调，取消/失败释放回调，不将解码就绪称为可见首帧。
2. 系统媒体 helper 异常退出或启动失败后，provider 和 middleware 的相同配置去重阻止显式保存重试。修复后允许下次保存/应用同样设置重启自有 helper，不做定时自动重启、不重试播放器控制，关闭后不能复活。

### 影响与验证

- 源码：`bridge-runtime/public/app.js`、`bridge-runtime/src/windows-media-provider.mjs`、`bridge-runtime/src/media-middleware.mjs`，均为 runtime-only；无 override 真源变更。
- 实际引用复核：CLI 的配置保存调用 `media.configure()`；middleware → provider；工作台 `previewSwitcher.update()` 同时更新 pending/active。缓存图缺新 M3 节点，不重建或写 `.ai-memory`，以源码 grep/import/调用点为准。
- TDD 与人工完整审查同时执行：新增两组失败复现，再运行改动及直接依赖的媒体、HTTP、歌词、播放策略、工作台与切换专项，不跑全量。
- NFR：保留串行 configure/close、单自有 helper、bounded native 协议；不新增轮询或网络；无数据库/凭据/第三方依赖变更。仅现有事件路径增加就绪检查，不做性能或内存长测。
- 回滚只撤本轮增量；改前源码/文档与共享 dist SHA 见 `out/m3-closeout-20261015-132707/before/`、`before-hashes.json`、`protected-before.json`。
- 临时文件仅使用精确归属 scratch，验证后删除；保留测试源码和精简证据。

## 检查点

- [x] 计划/状态/源码与引用只读核对，改前备份、空白检查。
- [x] 新增反例红测：最初12项4通过/8失败，包含原代码的关闭后未处理启动Promise拒绝；最小修复后12/12。
- [x] 最小修复、相关专项、源码与隔离编译验证；再补并发保存仅重启一次和旧helper未退出不能开第二个的负例。
- [x] 更新阶段状态、检查2组scratch删除与4个共享dist文件SHA未变。

M3-01–06 为源码子项已交付，M3-07 和整阶段仍需真实宿主/物理操作/转码/发行等验收，不能因本轮后台通过补勾。

## 本轮交付

- `app.js`：就绪检查覆盖加载事件与策略更新；仅已解码、宽高非零的视频可结束暂停态等待。播放态仍等首个绘制回调，单在途回调；失败或release取消回调，忽略晚到事件/更新，手动暂停意图不改。
- `windows-media-provider.mjs`：仅当前自有helper退出时清配置去重记录；同步spawn失败归一为unavailable，创建失败不遗留无人接收的startup Promise。恢复重新校验协议序号/旧stdout身份，原关闭等待与强停计数不放宽。
- `media-middleware.mjs`：明确配置/保存时识别已退出的不可用provider，允许同设置重新初始化；启动失败不锁死配置签名。状态读取、pump和播放器控制不发起重启；无定时自动重启、不重放旧控制。
- `test/m3-provider-recovery.test.mjs`、`test/m3-workbench-readiness.test.mjs`：共14个新增专项，读取并执行实际源码；它们是长期保留的自动化测试，不是一次性素材。
- `scripts/verify-m3-provider-recovery.mjs`：显式 `--approved-power-only`，隔离编译实际HTTP/config/middleware/provider，运行真实隐藏PowerShell/C#电源读取helper；不启用WASAPI/GSMTC。以向自有stdin发送stop造成配置之外的自然退出，不强杀；再经私有HTTP保存相同设置恢复。

## 验证证据

不同轮次/层次单列，不与历史97/97、14/14等相加或拼成完整宿主验收。

| 范围 | 结果与证据 |
|---|---|
| 红→绿 | `out/m3-closeout-20261015-132707/recovery-readiness-red.tap`：4/12，8个缺口断言失败；`recovery-readiness-green.tap`：原12/12通过 |
| 最终相关专项 | 同目录 `targeted-02.tap`：**10文件74/74**，TAP约0.48秒，包括14个新增用例；未运行全量 |
| 真实隐藏helper + 编译HTTP | `out/m3-provider-recovery-1792042346372-bb1a3e43/report.json`：**9/9**；同设置保存恢复、只重启一次、采集/媒体/控制仍关闭、手动暂停保持、关闭后不复活、两个helper自然exit0；`forcedStops=0` |
| 隔离压缩/混淆 | `out/m3-b-20261014/closeout-readiness-20261015-01/compile-proof.json`：UI语法、CLI编译、HTTP Faststart/Range/版本稳定/原片保持通过；4组override/runtime哈希一致，未覆盖共享dist |
| 源码检查 | `out/m3-closeout-20261015-132707/source-final.json`：6个新增/修改JS文件语法及SHA；`git diff --check`通过 |
| 精确清理/保护 | 同目录 `final-audit.json`：2组scratch归属核验且目录不存在，合计964,328字节临时编译/配置副本已删除；4份共享dist SHA不变。小型报告与改前源码备份保留 |

运行命令：

```powershell
node --test test/m3-provider-recovery.test.mjs test/m3-workbench-readiness.test.mjs test/m3-media.test.mjs test/m3-http.test.mjs test/m3-lyrics-lifecycle.test.mjs test/m3-playback-policy.test.mjs test/m3-video-readiness.test.mjs test/m3-video-ui.test.mjs test/media-switch.test.mjs test/workbench-scene-preview.test.mjs
node scripts/verify-m3-provider-recovery.mjs --approved-power-only
node scripts/verify-m3-video.mjs closeout-readiness-20261015-01
```

编译输出名必须新建，不复用上面的历史目录名覆盖证据。

### 失败记录与自审

- 沙箱首次相关专项69/74；5项均为临时配置/LRC的`rename EPERM`，`targeted-01.tap`保留。正常权限下同一10文件74/74，未改断言或绕过文件/来源校验。
- 首次helper验证在`scratch`创建前遇`realpath EPERM`，未启动任何进程；`out/m3-provider-recovery-1792042275844-2f469b82/report.json`保存失败阶段，成功重跑另用新目录。
- 人工审查确认：改动限3个runtime产品文件；无新依赖、无任意命令/路径/作者权限；退出和重试仍串行，仅精确自有ChildProcess；关闭状态不可逆；取消回调不提前让未解码媒体就绪；不吞掉失败将其说成成功。新增用例覆盖同步/异步启动失败、旧stdout、并发保存、pending控制退出拒绝、不重复控制、stop不完整拒绝新进程及禁用/不支持平台。
- 未使用子代理，未写记忆、commit/push、启动/刷新/注入任何Codex宿主、生成EXE或安装ffmpeg。没有进行内存诊断或长时资源测试。

## 剩余项与下一步边界

| 剩余 | 当前安排 |
|---|---|
| Store/Local可见首帧、持续播放、真实最小化恢复、手动暂停保持 | 待用户允许或自行人工专项；不前置窗口，解码/VM证据不替代屏幕效果 |
| Codex宿主内Web音乐/歌词/封面/控制链 | 背景链历史已有证据，真实宿主链仍待验 |
| 物理输出设备切换、插拔电源 | 未操作；本轮只读真实电源状态与进程重启不能替代物理变化验收 |
| 宿主/托盘自然退出、新EXE/ASAR回归 | 本轮helper自然退出不是宿主托盘验收；不生成EXE，旧EXE未更新 |
| ffmpeg真实转码、帧率、硬件→软件回退 | 按用户决定继续暂缓，不下载 |
| 内存增长定位、长期资源/无泄漏 | 按用户最新决定后置；历史增长问题不标解决 |

可后台处理的本轮缺口已交付。下一轮不要反复全套测试、恢复可见窗口、自动追内存或擅自开始M4；先按用户后续选择处理上表对应项。
