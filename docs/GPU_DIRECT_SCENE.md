# Codex Scene GPU 直绘代码接线（2026-10-13，阶段验证中）

## 后续 GPU 专项验收

用户后续明确要求继续 M2、VP8 暂停且不跑全量。新增暂停/隐藏静音、输入保护、GPU 多目标实际属性读回、固定来源与有界 status；相关专项26/26、作者来源专项11/11。通过独立源码 workspace + compiled SHA-256 snapshot 进行真实 Store 验证，未覆盖共享 dist。

前轮 Store 已验证实际 GPU 动态像素、M1切换、暂停恢复、五类作者UI/落盘/实际读回/默认值恢复。最新build06修复已复现的隐藏页面首帧等待触发路径，隐藏GPU页面延后至可见再初始化：Local隐藏/显示5/5、Store6/6、Local指针4/4功能步骤通过；限定指针/CSP证据同产品集合/compiled digest，作者证据不跨构建合并。恢复验证器等待真实新文档后再测CSP。旧URL-only验收器的60.19 completion FPS不作为选定文档性能门禁；**完整双宿主/重启/失败/长期资源及自然退出仍未完成**。原失败全部保留，不逆推旧故障唯一根因。最新逐轮报告、源码版本和验证器修正见 [GPU 续做记录](M2_COMPLETION_20261013.md)。下文“未测试”是最初代码接线时的历史边界。

## 本次代码范围

- 桌面工作台的“应用到 Codex”默认将 `scene` 选路到 `direct-gpu`。
- Codex 与工作台共用 `createScenePreviewSlot` 及只读 Scene 服务；请求 `sceneFps=60`、设备 DPR 和完整资源质量。不再经 Scene 原生采集、VP8 编码、CDP 逐帧传输、CPU 解码和 `ImageData` 拷贝。
- 继续使用现有 M1 `prepare/ready/commit/cancel` 和过场；失败候选不替换旧 slot。GPU 失败不静默改用 VP8；已显示 Scene 失败时暂停/静音并显示提示，需显式重试。
- 作者属性、播放/暂停、音量、取景、缩放/镜像、pointer、真实文档隐藏暂停仍走共享适配器。Web 保持 VP8；图片/视频保留原路径。
- 来源由可信 utility 按注册 id 查找。只读 URL/频道通过私有 CDP handle 注册，作者 iframe 不接收控制服务 token、文件目录或 Node 能力；CDP 仍需桌面父进程身份校验。
- 最多两个 Scene 项目资源服务，跨目标共享服务；每个目标的 M1 slot 至多两个。1 Hz CDP 轮询仅管理 lease/健康状态，不是像素传输。过场结束后才释放退休 iframe 的服务。

## 自行加载新代码

1. 在托盘完整退出旧的**壁纸工作台**，不是退出 Codex 聊天。
2. 在项目目录启动源码入口：

   ```powershell
   Set-Location D:\codework\codex-wallpaper-bridge
   $env:CWB_SCENE_RENDERER = 'gpu'
   .\run-electron.cmd
   ```

   该入口经 `npm start` 自动同步 bridge 并重建 `dist`，再启动工作台。不要直接运行旧 EXE 或仅 `electron .`：它们可能仍加载旧构建。
3. 工作台选择你的 Scene 壁纸和 Codex 安装目标，点击“应用到 Codex”。成功消息的 Scene 路径应为 `direct-gpu`。

首次在某个 Codex 文档使用 GPU Scene 时，代码会设置 CSP bypass 并刷新该文档一次，让 iframe 加载设置在新文档初始化时生效；这不是关闭 Codex。后续参数修改和 Scene 切换不重复触发这次 CSP 刷新。既有深色主题切换若要求重载，仍保留其原有流程。

2026-10-13 首次注入优化增补：主题准备已前移到 GPU 初始化刷新之前；主题若仍需兜底刷新，也先刷新再创建首次 Scene。增加安装描述符复用、可见窗口优先、原始资源预读和分段计时，详见 [首次注入优化与用户测试步骤](FIRST_INJECTION_OPTIMIZATION.md)。本轮尚未实测，不沿用旧性能数字作为优化后结果。

“恢复官方外观”或退出壁纸工作台时，会删除注入 hook、释放 iframe/资源服务，并在关闭 CSP bypass 后刷新文档；不以单独发送关闭命令当作 CSP 已在旧文档生效。

## 显式选择旧 VP8 路径

先退出壁纸工作台，再用同一 PowerShell 会话运行：

```powershell
$env:CWB_SCENE_RENDERER = 'vp8'
.\run-electron.cmd
```

切回 GPU 用 `gpu`；删除该会话的环境变量可恢复默认 GPU：`Remove-Item Env:CWB_SCENE_RENDERER -ErrorAction SilentlyContinue`。没有新增或改写用户配置文件中的渲染模式字段。

## 最初接线时的未验证边界（历史）

按本轮用户要求，只改代码、人工回读并同步源码；未运行单元测试、实机测试、FPS 测量、完整 app build 或打包，未启动/注入当前 Codex，也未替换发行 EXE。`60` 是请求目标，不是稳定帧率承诺。之前的 VP8 或独立 GPU PoC 结果不能当作这次正式接线的验收证据；M0/M1/M2 与发行门禁不变。

主要文件：

- `bridge-overrides/src/cli.mjs`、`injection-plan.mjs`、`cdp-injector.mjs`、`injected-renderer.mjs`：正式入口、私有注册、CSP/重载/恢复与 M1 接线。
- `bridge-runtime/src/direct-scene-delivery.mjs`、`direct-scene-transport.mjs`：只读资源 lease 与 GPU iframe transport。
- `bridge-runtime/src/workbench-scene-preview.mjs`：工作台/Codex 共用 slot。
- `src/bridge-runner.mjs`：外层操作超时覆盖 GPU 首帧初始化。

本轮原文件备份：`out/gpu-direct-code-20261013-093552/before/`。回滚仅使用本轮自有增量/这些备份，保留此前尚未提交的项目改动。
