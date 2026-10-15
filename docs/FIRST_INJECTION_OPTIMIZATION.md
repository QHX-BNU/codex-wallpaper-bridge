# 首次注入优化（2026-10-13，待用户测试）

目标：缩短点击“应用到 Codex”到首个可见动态壁纸的等待，不用预览图代替动态首帧，也不通过扩大超时或跳过身份检查掩盖问题。

## 本轮实现

1. **减少重复发现**：每次点击仍获取一次新鲜安装/运行状态快照；已成功核验的安装描述符供后续 native/GPU 回调复用，不再重复扫描全部 Store/本地安装。只保存 id/EXE 路径/端口，不缓存 PID 归属成功结果。相同且正在执行的 owner 查询合并；结束即删除，后续连接仍重新核验。
2. **合并正常路径的主题与 GPU 初始化刷新**：先安装无媒体的 Runtime、准备深色主题，再执行已有 GPU 文档初始化刷新，最后创建 Scene。若新文档的主题仍要求刷新，保留一次有界兜底，但放在 Scene 首帧加载之前，避免先加载场景再销毁重建。首次连接的核验证据只用于该活连接的立即初始化，之后的 GPU 首次启用/重连不能复用。
3. **避免等待无关 load 事件**：GPU 初始化/恢复使用旧文档随机标记消失、精确 origin、DOM 就绪联合判定；不再先等待最长 8 秒的 `loadEventFired` 再重新轮询。没有放宽媒体首帧、兼容样式或恢复校验，也不改窗口可见性。
4. **可见窗口优先**：多目标时仅探测 `document.hidden`；隐藏目标的临时连接关闭，等可见目标注入后再重新核验/连接处理，隐藏目标最多并行两个。若全部隐藏，先串行完成一个目标，再并行后续目标，避免共享原主题记录的首次捕获竞态。未知可见性保留原处理，不当作成功跳过。最终结果仍覆盖全部目标，部分失败仍失败。多个同时可见窗口仍沿发现顺序处理，不宣称能识别用户眼前的唯一窗口。
5. **首次资源读取与初始化重叠**：准备主题/刷新期间，按项目策略和 containment 预读引擎及选中 Scene 的原始资源。复用已有 32 MiB 单文件、128 MiB 总量缓存预算；最多两个预读任务，同一项目共享在途任务。大包不整文件强读，不提前创建 iframe、GPU 上下文或资源服务。正式服务仍重新核对文件、策略和 vendor SHA-256。
6. **分段计时**：桌面日志增加 `[注入计时]`；CDP 增加 `injection-stage` 和数值编号。包括安装发现、端口/owner、控制服务、连接、Runtime、主题、刷新、资源、媒体等待和兼容样式。递归重载沿用同一计时，不再只显示最后一遍耗时。

## 加载代码并实测

1. 在托盘完整退出旧的**壁纸工作台**，不要手动关闭当前 Codex 聊天。
2. 从项目源码入口启动：

   ```powershell
   Set-Location D:\codework\codex-wallpaper-bridge
   .\run-electron.cmd
   ```

   入口会自动同步、构建 `dist`。旧发行 EXE 没有更新；仅运行 `electron .` 可能仍载入旧构建。原有未开启 CDP 的启动/确认流程保持不变。
3. 使用同一 Scene 测首次“应用到 Codex”，记录**点击到动态壁纸出现**，与“处理中结束”分开记录。成功消息中的 Scene 路径应为 `direct-gpu`；若会话中显式设过 `CWB_SCENE_RENDERER=vp8`，需按 GPU 直绘文档切回后比较。
4. 再测再次应用、切换 Scene、恢复官方外观。若有多个 Codex 页面，观察可见页是否先完成；不要为比较而关闭当前聊天。
5. 若仍然慢，提供这次的 `[注入计时]`、同一个 `#编号` 的 `injection-stage` 和 `injection-ready` 行，即可区分查询、刷新和场景本身的耗时。

日志目录：`C:\Users\11640\AppData\Local\CodexWallpaperDesktop\logs`。

### 计时口径

- 桌面“点击到流程结束”包括其他目标和失败诊断；不是当前可见窗口的物理首帧时间。
- CDP 合计包含该次连接的身份核验及递归刷新；不同 `#编号` 是不同注入操作。隐藏目标探测及重新连接会产生不同编号。
- `Runtime`/`DOM` 摘要与细分阶段存在包含关系，不应全部相加。并行资源预读也不能计成串行净节省。
- `媒体 ready` 是运行时就绪反馈，不是屏幕录像或 FPS 证明。`loading/error/play-rejected` 不能当作动态首帧成功。
- 若仍有第二次刷新，应检查主题准备阶段；兜底刷新发生在首次 Scene 创建前，不承诺所有主机固定一次刷新。

## 验证与交付边界

按用户要求，未运行单元测试、实机测试或性能基准；未启动、停止、注入或刷新 Codex，未改日常配置和 Wallpaper Engine 原件，未构建 `dist`、打包或替换 EXE。新增/更新回归用例已准备，实际正确性和提速幅度待测，原 M0/M1/M2 与发行门禁不变。

已执行的静态检查：10 个修改后的 JavaScript 文件 `node --check` 均通过（仅解析，不执行）；`npm run sync:bridge` 退出码 0；override/runtime SHA-256 差异 0；`git diff --check` 无空白错误。已对照改前备份回读身份复用范围、主题刷新顺序、隐藏窗口并发、资源预读容量和关闭路径。以上不等同于单元/实机测试通过。

拟运行的源码回归入口（本轮未执行）：

```powershell
node --test test/first-injection.test.mjs test/desktop-main-flow.test.mjs test/launch-flow.test.mjs test/compatibility-lifecycle.test.mjs test/native-injector.test.mjs test/scene-server.test.mjs
```

本轮改前备份和 SHA-256 清单：`D:\codework\codex-wallpaper-bridge\out\first-injection-20261013-112702\before`、同目录 `before-sha256.json`。回滚仅针对本轮增量，不覆盖之前的未提交工作。
