# M2 文件类作者属性（2026-10-14，代码交付）

## 完成范围

- `type: file` 已接入既有作者属性面板：文件选择、按壁纸/属性保存、热更新、重启读盘、清空和恢复作者默认值。原有五类属性保持不变。
- 文件复制到配置文件旁的 `author-files/`，不改 Wallpaper Engine 原件，也不把本机路径、blob URL 或控制服务 URL 保存到作者属性。
- 保存的 `cwb-author-files/<项目摘要>-<属性摘要>-<内容摘要>.<扩展名>` 是稳定相对资源 ID。项目、属性及内容均受校验；相同内容在同一属性下复用。
- GPU Scene 沿用固定引擎现有的 user-file texture 路径；工作台预览与 GPU Codex 共用私有只读资源服务。Web 作者回调得到该服务上的 URL，属性状态/回执仍保留稳定 ID。不新增引擎 overlay，不修改 vendor 文件。
- 作者默认文件仅允许工程/包内相对路径；绝对路径、外部 URL、路径穿越等不作为默认值交付。清空与恢复默认是不同操作。
- 缺失、被篡改、跨项目/跨属性的文件引用不重放；读取时回到作者默认值并报告 discarded，写入时拒绝。原生 MIME、CSP、Range/HEAD/416 和独立来源边界保持。

## 用法与格式

启动更新后的源码工作台，选择 Scene/Web，在 **WE 作者属性** 的文件控件中选择文件。选择完成自动复制并保存，随后尝试实时应用；状态仍区分“已保存”与“取得实际读回”。“清空”仅清空这一项，“恢复作者默认值”恢复当前壁纸全部作者属性。

支持作者声明的 `filetype`：

| 分类 | 允许格式 |
|---|---|
| image（未声明时默认） | PNG、JPG/JPEG、GIF、WebP、BMP |
| video | MP4、WebM |
| audio | MP3、WAV、OGG、FLAC |
| any | 上述格式合集，不开放任意文件类型 |

文件层验证签名及基本容器边界；具体媒体解码和 Scene 材质/脚本用法仍由固定引擎及作者实现决定，不以属性回执代替视觉效果证明。HTML、SVG、脚本、EXE 等不开放上传。目录属性和目录枚举 API 不在本次范围。

## 存储、并发与生命周期

- 单文件最多 **64 MiB**，流式传输、最长 **30 秒**；受管库最多 **512 个文件 / 512 MiB**，不进行全文件 base64/JSON 缓存。一次暂存最多另占 64 MiB。
- 根目录、各级父目录、归属标记及文件均拒绝链接/重解析越界；引用解析校验 SHA-256 和普通文件身份。目录只来源于可信 ConfigStore，不接收客户端目录输入。
- 上传前与落盘时均检查当前壁纸的 revision；并发/ABA/作者元数据变化不覆盖新值。保存失败保留旧确认值，实时应用失败与落盘失败分开报告。
- 面板上传期间禁用当前属性控件/清空/默认按钮；晚到的上传回执不更新另一张壁纸。
- 桌面保存握手跟踪作者属性及文件上传，等待写入完成后才允许 Apply/退出 flush；保留原5秒门槛，不在传输未完成时误报已保存。
- 普通失败/退出清理暂存文件，退出时封闭新写入并中止传输。旧版本、已完成但未引用的拷贝保留在额度内，避免删除仍被活动图层使用的文件；崩溃遗留 `.part` 计入额度，不擅自清理另一进程的工作。
- 只有临时内存配置时禁用文件选择；空值和作者默认仍能使用既有属性 API。移动 ConfigStore 所在目录的资源迁移不是本轮功能。

## API 与源码

`POST api/author-properties/:id/file/:key?filename=<名称>&revision=<当前版本>`：`Content-Type: application/octet-stream`、`X-CWB-File-Size: <字节数>`，body 为 File 原始字节。继承控制服务 token/Origin/Host 校验，id/key 由注册的可用项目及作者 schema 核验；返回正常作者属性状态，包含 `fileSelectionAvailable`。通用配置接口不能绕过专用属性保存。

主要源码：

- `bridge-runtime/src/author-properties.mjs`：类型/default 校验和 Web 文件映射。
- `bridge-runtime/src/author-file-store.mjs`：受管复制、范围/签名/配额/哈希/中止。
- `bridge-runtime/src/author-property-controller.mjs`、`author-property-state.mjs`：CAS、保存/读回、重启过滤。
- `bridge-runtime/src/author-properties-panel.mjs`、`public/app.js`、`bridge-overrides/public/electron-host.js`：真实 File 输入、现有 API 和桌面保存握手接线。
- `bridge-runtime/src/scene-server.mjs`、`scene-preview-leases.mjs`、`direct-scene-delivery.mjs`、`public/cwb-web-bridge.js`：私有资源、预览/GPU lease 与作者回调。
- `bridge-overrides/src/cli.mjs`：可信进程内依赖，已同步到 runtime 真正入口。

## 验证与边界

- **代码和相关专项已完成**：13 个直接依赖测试文件 **130/130**，约 **2.45 秒**；文件属性本身 **16/16**。覆盖正常选择/保存、ConfigStore + 文件服务重建、清空/默认、独立属性、HTTP/私有 GPU lease 接线、Web/Scene 回执、桌面保存握手和多项异常路径。
- 语法 **21/21**；4 个 Node 入口 + 2 个浏览器入口的隔离 minified 编译通过，3 项跨 realm 函数序列化检查通过；CLI/desktop host 真源/runtime SHA 相同，增量与仓库 diff 检查通过。
- 证据/备份：`out/m2-author-files-20261014/`，最终 `final-complete-green.tap`、`file-final.tap`、`compile-proof-final.json`、`review.md`、`delivery-summary.json`。
- 保留 red 0/3、旧 unsupported-file 断言、VM fixture 缺少新依赖及新增测试方法名错误的失败输出；没有删除断言或放宽项目/文件/Origin/CAS 边界。
- **未运行**全量、VP8、Store/Local、真实文件选择/渲染效果或长期资源验收。DOM/adapter VM 与只读 HTTP/磁盘验证不替代真实宿主验收。
- 未覆盖共享 `dist`、未打包/替换 EXE、未 commit/push、未改日常配置/WE 原件/当前聊天或项目/全局记忆。M2 文件子功能代码可关闭；M2 整阶段和发行门禁不由此补勾。
