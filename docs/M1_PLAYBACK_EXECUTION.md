# M1-B 播放、切换与轮播执行记录

日期：2026-10-10（续做）。用户授权：开始完成 M1 未完成项。M0/M1 原有未提交修改保留。

## 范围、顺序与验收

| Wave | 任务 / 文件范围 | 验证与退出条件 | 当前状态 |
|---|---|---|---|
| 1 | M1-06；config-store / injection-plan / injected-renderer / 工作台控件 | 取景 XY、缩放、数值复位、倍速、镜像、声音、对比度、透明度从 UI 保存到运行时；同媒体调参不重建；v2 原文迁移备份 | 代码/自动化与隔离 UI 通过；真实视频与双宿主待验证 |
| 2 | M1-07；共用浏览器切换控制器 / renderer / 工作台 | prepare→ready→commit，旧画面不断；超时/失败不移除旧媒体；取消过期结果；restore 释放所有槽位 | 代码/自动化和隔离 UI 通过；双宿主未验证 |
| 3 | M1-08；playlist 模型 / API / 调度器 / 工作台 | 多列表 CRUD、WE JSON 导入、顺序/随机、间隔、失效跳过与少于两张规则；隐藏/分级在轮播不可绕过 | 代码、HTTP 与隔离 Electron UI 通过；双宿主未验收 |
| 4 | M1-09；共用过场模块 / 控件 | 硬切/淡化/推移/擦除/光圈/缩放/条带、方向/速度、系统与显式减少动态效果；手动和轮播共用切换入口 | 代码、单测与实际 Electron 中间帧通过；双宿主未验收 |
| 5 | M1-05/10；自动化 / 编译桌面 / 双宿主 | 完整重启、MP4 可见时间推进、连续轮播/快切/失效/恢复/退出；Store + EXE 独立测试；人工项目仍独立记录 | 已尝试实机，未通过；本轮失败及检查点如下 |

## 决策与边界

- TDD + test-generation + code-review 联动；每 Wave 先失败用例，再实现，再回归。参数以服务端 schema 为真源，不把 UI 默认值当持久化规则。
- 修改源：override 同名文件优先；同步生成 runtime，dist 仅通过构建生成。无新第三方依赖。
- 切换采用至多两个媒体槽位，先加载后交换；接受短时双份解码内存，不通过清空旧媒体消除并发。revision 取消、有限加载超时及释放覆盖失败路径。
- 播放列表只接受受控 JSON/现有项目 ID，不读调用方提供的任意路径，不执行第三方脚本。数量/文本/间隔都有上限；写 API 复用 loopback token、Origin 与持久化队列。
- 不变：大媒体走 Range；bootstrap <100 KiB，apply <10 KiB；资源库索引/目录、播放列表不注入 CDP。
- 宿主测试仅独立 profile/端口/动态身份核验实例；不关闭当前聊天、不改日常配置或 WE 原文件、不生成/覆盖发行 EXE、不提交/推送。
- M0 人工门禁未通过，不用本 Wave 单测或隔离 UI 解锁 M2/发行。原生场景仍属于 M2。
- 强杀/断电残留回收、断点续传、磁盘断电、多进程写配置不因本 Wave 自动算通过；优先完成原 M1-05–10 的必选能力。

## 回滚与检查点

改前备份、哈希与工作区状态：`out/m1-20261009-playback/before/`、`before-hashes.json`、`before-status.txt`。仅回退本 Wave 增量，不 reset 整仓。备份测试以 `.bak` 保存，避免 Node 自动发现。

已有图谱采用 `--no-rebuild` 只读查询，缺少 M1-A 新模块且跳过新鲜度校验；当前源码 grep 是影响面的最终依据，未把旧图谱当完整依赖证明。只在 docs/out 记执行证据，不自动写用户记忆。

## 验证记录

- 改前同份源码：沙箱 `baseline.tap` 301/340（39 环境失败）；沙箱外 `baseline-unsandboxed.tap` 340/340。失败记录保留。
- Wave 1：新增参数测试先红 0/7；最终 `effects-unit-unsandboxed.tap` 19/19，`wave1-node-test.tap` 347/347，`wave1-build.log` 构建通过。
- 隔离 UI：`electron-1791549486942/report.json` 3 项通过；真实数值输入/checkbox → HTTP 保存、生产 renderer 图片解码/缩放/透明度/同媒体引用保持、重新打开工作台 + 新 ConfigStore 读盘/复位。
- helper 初次数值选中和一次未稳定点击失败保留；改为原生鼠标命中检查 + 双帧布局等待，数字用 input.select + Chromium insertText。生产参数单测/构建均通过，未把 helper 失败算双宿主失败。
- 尚未验证：真实视频速率/声音、完整程序重启、实际桌面 file-origin IPC、Store/EXE。本 Wave 继续收集，不用上述图片测试替代。
- Wave 2：`wave2-node-test.tap` 351/351，构建通过；`electron-1791550392616/report.json` 5 项通过，包括加载失败保留旧媒体、快切只保留最新槽位、受控 MP4 解码/时间推进/倍速/音量参数热更新。受控视频证据已补，不是有声可听、原生窗口可见或双宿主证据。
- Wave 3 中断点：新增 playlists 模型/控制器/HTTP API、工作台控件与状态轮询。`wave3-unit.tap` 12/12，含真实 5 秒服务端定时切换、恢复停表、Origin 与伪造配置拒绝。UI/候选失效通知、编译产物/全量回归仍待收尾。
- 2026-10-10 续做证据另存 `out/m1-20261010-playback/`，不覆盖 10 月 9 日的成功/失败报告。中断时最近命令已结束，无新的真实 Codex 接入。

## 2026-10-10 最终代码检查点

- M1-08：新增 `api/playlists/failed`，仅接收当前服务器轮播候选和配置 revision 的失败反馈。ConfigStore 在持久化队列内校验 revision，防止过期、重复与 ABA 反馈覆盖新选择；用户并发选择也不会被失败回滚覆写。失败后保留旧画面、回退并尝试剩余候选，不把旧帧标为新选择。
- 轮询改 single-flight；请求期间手动选择/保存使旧响应失效。WE File.text 的读取和错误包含在 busy/桌面保存握手内；参数和列表控件都会标 dirty。操作期间禁用列表控件，避免未完成的间隔保存与启用点击交叉。
- 窗口可见性尊重 pauseWhenHidden；暂停媒体仍能用 loadeddata 首帧完成 prepare。图片轮播也可暂停/恢复。UI 亮度/暗化/模糊/饱和度范围与服务端统一。
- M1-09：`runMediaTransition` 使用 WAAPI，七种效果共享同一切换器；方向 left/right/up/down、时长 100–3000 ms。独立 translate/scale 不覆盖取景 zoom/mirror transform；旧声音在 commit 后静音，旧视频画面到过场结束再释放。
- 系统 prefers-reduced-motion 和显式 reduceMotion 都走真正硬切，不再夹带工作台 CSS 的固定淡化。打断过场/restore 清动画和 retired slot，最多两个媒体槽位。renderer version 为 `0.5.2-transition`。
- 本轮增量备份：`out/m1-20261010-playback/before-continuation/`；不要用整仓 reset 或旧备份覆盖其他未提交改动。

### 成功证据

- `final-node-test.tap`：**366/366**，0 fail/skip；`build-final.log`：编译/混淆通过，未生成或替换发行 EXE。bootstrap 为 **49234 bytes**，既有 <100 KiB / apply <10 KiB 回归通过。
- `electron-1791594479668/report.json`：**11 项通过**，媒体服务正常关闭。实际数字/checkbox、Chromium File input、列表 CRUD/排序/删除、读取错误、解码失败、两次定时轮播、暂停恢复、随机不连续重复、隐藏/分级过滤、慢轮询并发与新手选保护都覆盖。
- 实际 Electron renderer 中七种过场均采集中间帧，检查活动动画和槽位，结束后回到一个槽位；系统减动态效果使用 CDP emulated media，显式减少动态效果和过场中 restore 都通过。`transition-*-middle.png` 已查看条带中间帧和工作台图。
- 报告仍明确 `codexHostsVerified=false`、`nativeVisiblePlayback=false`、`fullDesktopIpcVerified=false`、`completeM0Gate=false`；SELECT 控件为 DOM input/change 适配，数字/鼠标/文件输入为 Chromium 事件。不得将此记成双宿主或人工验收。

### 实机尝试与未通过项

- `out/live-acceptance/m1-local-20261010T010816Z-e057ea97/workbench-full.json`：目标和桌面独立身份、实际 file-origin → OOPIF 控制页与视频卡片入口通过；应用/恢复因祖先进程核验失败而拒绝。只读 `launcher-ancestry.json` 证实测试启动器已退出且桌面创建晚于目标，保护没有放宽。
- 新增 `scripts/start-live-m1-acceptance.ps1` 保持一个先于目标创建的测试父进程存活，不更改产品身份保护。新的本地根 `m1-local-20261010T011659Z-3ba21d27`：首次实机 helper 动态查询偶发超时；只读 `owner-timing.log` 两次查询分别约 4292/3753 ms，通过。一次重测在视频步骤失败（受保护报告仅保留类别，具体底层原因未证实），**未计视频/应用通过**；后续实际工作台恢复通过，`restoreComplete=true`。
- Store 根 `m1-store-20261010T012100Z-9e9e2938/workbench-full.json`：身份核验通过，但控制页未载入；桌面日志记录扫描/启动超时及控制进程退出等待超时。具体底层原因未证实，**不把它归为代码已验证通过或认证问题**。
- 上述失败报告均保留。仍未验收完整桌面重启、两宿主的 M1 新参数/列表/过场/连续轮播/快切/失效同步、有声可听、原生托盘退出和 renderer 重建/新窗口/人工输入滚动。**M1 整阶段不标完成，M0/M2/发行门禁不变。**
- 实机测试精确收尾：`out/m1-20261010-playback/live-teardown.json` 的 `remainingCount=0`、`testListenerCount=0`、`protectedChatPreserved=true`。仅停止本轮已核验 PID/创建时间/EXE/profile/端口及父子时间关系的测试树，使用稳定原生进程句柄；一条创建时间早于新父 PID 的旧进程明确排除。WMI 微秒与原生 100 ns 精度差异另存 `teardown-time-precision.json`，产品身份门禁没有变动。收尾为**强制测试清理**，`nativeTrayExitVerified=false`，不能当正常/托盘退出通过；隔离 profile/成功失败证据均保留。
- 下一 Wave 先在资源与进程负载受控时复现真实工作台启动/查询/退出问题，精确定位后再跑 M1-05/10；不要继续堆开测试实例或绕过所有者保护。
