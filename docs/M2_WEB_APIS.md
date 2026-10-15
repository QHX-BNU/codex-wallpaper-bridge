# M2 Web 缺失接口交付（2026-10-14）

## 当前结论

**本任务定义的5组代码子项已完成，Store/Local 实机效果未验。** 最终仅17个相关测试文件 **157/157**（约2.58秒）通过；40个文件语法检查、5个Node入口/5个浏览器入口隔离压缩编译及7项跨 realm 检查通过。已同步 override/runtime，没有运行全量、VP8、长时或 Store/Local 流程，没有覆盖共享 `dist`、更新发行包、操作当前聊天或日常配置。

文件/目录属性及下列已确认 API 不再列作“未实现”；不将这一代码交付冒充完整 WE Web 兼容、M2-06/07 整项或双宿主验收。M2 整项验收仍3/8，和本任务代码完成度分别记录。

## 合同与范围

用户授权补 Web 接口，限定 GPU 直绘、相关模块及直接依赖专项。禁止全量/VP8/长时实机流程；不启动或操作 Store/Local，不更新共享 dist、发布 EXE 或记忆。保留已有脏文件、WE 原件和失败证据。接口形状参考已锁定 vendor `web-shim.js:683–794,1178–1244`，不改 vendor。

| 子项 | 合同 | 本轮交付 |
|---|---|---|
| 媒体封面/状态 | `wallpaperRegisterMediaThumbnailListener`、`wallpaperRegisterMediaStatusListener`；有界可信 producer 消息，晚注册重放及暂停/退出生命周期 | 代码及专项通过；没有伪造系统 producer |
| 媒体枚举/元数据 | `wallpaperMediaIntegration.PLAYBACK_STOPPED/PLAYING/PAUSED=0/1/2`；`albumTitle/albumArtist/subTitle/genres/contentType`，严格复制；保留旧 `album` | 代码及专项通过 |
| 目录通知 | `wallpaperPropertyListener.userDirectoryFilesAddedOrChanged(propertyName, filePaths)` / `userDirectoryFilesRemoved(propertyName, filePaths)`；初始、替换、清空及晚注册 | `fetchall` 差量、版本/暂停/退出栅栏已实现 |
| 随机文件 | `wallpaperRequestRandomFileForProperty(propertyName, callback)`，`callback(propertyName, filePath)`；仅对应目录已核验私有资源，无库存返回空串 | 有界异步随机请求、私有 URL 与 WE `file:///` 拼接兼容通过 |
| 真实目录资源 | `directory` 作者属性、选择目录中的安全媒体、分文件流式受管导入 + 有界内容索引原子 CAS 提交；按壁纸/属性独立保存、重建验证、默认/清空 | UI、HTTP、持久化/读回、私有资源及保存握手接通 |

不凭空添加未在参考中确认的 `wallpaperRequestFileForProperty`。系统音频采集/Now Playing producer、媒体控制、硬件插件属于 M3 或另行任务；注册 API 不代表系统数据已接入。指针完整扩展、所有 WE 功能和允许样本矩阵不在这轮范围。

## 设计与验收

- 风格：沿用两空格 Node ESM、DOM textContent、具名固定错误；不新增依赖。
- 依赖：schema → state/controller/file store → 主服务上传/提交 → readonly renderer → Web bridge；现有 GPU delivery/预览 slot 使用同一 primitive 属性及 producer validator。图谱脚本不存在，已直接读取并 grep 实际引用。
- 目录索引为独立命名的受管不可变 JSON，保存值仍为 primitive ID；不接受用户/作者提供磁盘目录或任意路径。文件库原归属 marker、链接检查、签名/哈希、512 文件/512 MiB 总额度不放宽；目录最多128项/256 MiB。
- 导入每文件沿用30秒流式上限，前端逐项显示进度，暂存阶段可取消（已完成受管副本保留额度内）；一次最后 CAS 保存索引。暂存失败/取消、最终校验/CAS/磁盘失败均保留原选择；进入最终提交后禁用取消，不把网络中断当作已撤销提交。默认目录仅枚举已注册工程安全相对目录，有深度/数量/大小边界，不遍历整个磁盘。
- 媒体封面只接受32 KiB内 PNG/JPEG/GIF/WebP data URL和有限RGB hex颜色；适配现有64 KiB JSON写接口，不增加任意URL访问能力。初始媒体状态明确 `enabled:false`，系统 producer 不存在时不伪造已启用。
- Web接口缓存/目录差量均有界；listener晚注册异步重放。目录异步结果用版本/退出栅栏防旧选择复活；只读私有端点保留 GET/HEAD、same-origin和既有CSP，不连接主服务控制origin。
- 用例：合法封面/状态完整 GPU消息、非法类型/路径/容量拒绝，暂停/晚注册/退出；目录UI→HTTP→索引→私有读取→通知/随机文件→清空/恢复/重建，跨项目/属性/链接/篡改/CAS/取消负例。
- 仅选择相关测试；语法、sync、隔离 minified 编译与跨realm序列化；人工代码审查记录 `out/m2-web-apis-20261014/review.md`。

## 实现细节与边界

- Producer 合同新增 `{op:'mediaStatus',value:{enabled:boolean}}`、`{op:'mediaThumbnail',value:{thumbnail,...}}`；封面颜色字段按官方 `highContrastColor`。初始 `enabled:false`，媒体关闭清空缓存；回调载荷复制、不进入公开诊断。接入现有 selected-only GPU/CDP lease，不另建切换器。
- `directory.mode` 缺省 `ondemand`；只在 `fetchall` 触发目录通知，并从普通属性 payload 排除。纯 fetchall 的空 payload 不触发 `applyUserProperties({})`；晚注册一次异步递送当前 FPS/音量/暂停，重复 React 赋值不形成反馈环。
- 稳定保存值为 `cwb-author-directories/<project32>-<property32>-<content64>.json`；磁盘索引和媒体位于原 marker 保护的 `author-files/`。索引32KiB、目录128媒体/256MiB、单文件64MiB、全库512文件/512MiB；成员签名和SHA、索引SHA、项目/属性归属在提交、重建和读取时重验。
- 写接口为 `POST api/author-properties/:id/directory-file/:key?filename=...&revision=...`（仅暂存）和 `POST api/author-properties/:id/directory/:key`（最终CAS）。前后 CAS、重读 manifest、写失败不提交；UI busy 覆盖分文件请求间隙，桌面 Apply/退出保存握手仍只有原5秒上限。
- Readonly `GET/HEAD /<private-session>/author-directory/:key?value=...` 仅返回当前项目声明属性的受控 catalog，不返回磁盘路径/原始索引。保留 Host/Origin/CSP/GET-HEAD 边界；安全工程默认目录最多1024 entries/深度8，跳过链接。
- Web 每个 catalog 最多128、总缓存512、随机等待队列128、请求5秒超时；默认目录每5秒有界刷新，受管不可变索引不轮询。旧请求 abort/版本栅栏，paused 的未递送变更报告 pending；目录 pending/loading/failed 不冒称 ready。
- `web-resource-aliases.mjs` 在作者脚本前安装 iframe 内可恢复补丁；把安全 `file:///` 工程相对资源或私有 callback URL 仅映射到同一 readonly project base。拒绝盘符/UNC/外部 URL/穿越/双编码，不开放本机文件权限。
- 文件及封面校验是签名/容器边界校验，不是完整 codec 解码证明；封面 PNG/GIF 有尺寸边界，JPEG/WebP 没有完整尺寸/解码验证。全部真实浏览器视觉、媒体色彩效果和作者第三方兼容仍待实机验证。

接口依据：[Media Integration](https://docs.wallpaperengine.io/en/web/audio/media.html)、[User Properties](https://docs.wallpaperengine.io/en/web/customization/properties.html)、[Property Listener](https://docs.wallpaperengine.io/en/web/api/propertylistener.html) 及已锁定 vendor；不修改 vendor 或其 hash。

## 验证证据

证据根：`out/m2-web-apis-20261014/`。各轮含重叠，**不相加计数**。

| 证据 | 结果/用途 |
|---|---|
| `contract-red.tap` / `shim-red.tap` | 缺口红测及原环境/fixture失败保留，不全当产品缺陷 |
| `directory-core-01.tap` / `directory-core-normal-01.tap` | 沙箱 vendor/loopback限制，以及正常权限fixture未写初始config导致21/22；fixture已补，保留旧失败 |
| `end-to-end-01.tap` → `end-to-end-02.tap` | 真实HTTP→VM链路34/35→35/35；发现受管PNG catalog版本计算误用JSON扩展名长度，产品修复后通过 |
| `review-callback-red.tap` → `review-callback-green.tap` | 2条最小用例0/2→2/2，修复空属性回调及晚注册漏FPS |
| `final-targeted.tap` / `final-targeted-run.json` | **157/157、17文件、约2.58秒**；实际命令、退出码、专项边界与耗时保留 |
| `sync-final.log` | override/runtime同步及作者面板/预览浏览器bundle生成通过 |
| `compile-final.log` / `compile-proof-final.json` | 40源文件语法、5Node/5browser入口压缩编译、7项跨realm/guard；源SHA不漂移、3组override/runtime相等，包含未跟踪文件的空白检查 |
| `review.md` / `delivery-summary.json` | 主Agent人工审查、合同/负例覆盖、源码/证据哈希及未验边界 |

真实链路专项使用临时工程/临时配置和loopback HTTP：分文件暂存→目录索引→读取实际服务输出validator/shim到VM→作者新增/移除通知→随机私有URL→实际PNG字节→release。**不是浏览器可见显示、Store/Local或发行包验收。**

## 检查点与下一步

- 修改前备份与SHA：`out/m2-web-apis-20261014/before/`、`before-hashes.json`。回滚只撤本轮增量，不覆盖之前文件属性、GPU或其他改动。
- 最终审查前补充备份：`before-final-review/`；所有早期失败/成功证据保留，独立编译在 `compile-smoke-final/`，没有替换旧文件属性交付的编译证据。
- 本任务代码已完成。后续最小实机仅验证：允许的Web工程目录选择→作者新增/移除→随机资源/`file:///`视觉消费→清空/默认→重启后恢复；Store/Local按同构建哈希各自记录，不能跨构建拼证据。
- OS音频/Now Playing producer、硬件插件/媒体控制仍属M3或另行任务；注册接口不是OS供给。完整fallback/允许样本库/长时资源/自然退出及发行门禁保持开放，不因这一任务补勾。
