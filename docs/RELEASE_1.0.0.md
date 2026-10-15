# Codex Wallpaper Desktop 1.0.0

2026-10-15 正式版，Windows x64 单文件 Portable EXE。

## 本次更新

- 统一工作台右侧工具栏和顶部操作样式；新增深浅色主题切换，浅色使用淡蓝强调色，主题选择可持久保存。
- 增加本地素材库、导入、隐藏、分级筛选、播放列表和壁纸切换支持。
- 接入 GPU Scene 预览与渲染、Web 壁纸接口和作者属性，包括文件与目录属性管理。
- 增加系统音频、媒体信息、歌词、播放策略、视频优化与缓存管理模块。
- 完善 Codex 版本选择、启动确认、调试端点归属校验和注入生命周期处理。
- 移除 JavaScript 代码混淆，保留常规压缩、ASAR 完整性和发布文件清单校验；打包复用本地 Electron 并记录分阶段耗时。
- 同步功能文档、离线回归测试和专项验证脚本。

## 程序与校验

- 文件：[CodexWallpaperDesktop.exe](https://github.com/whisperia6/codex-wallpaper-bridge/releases/download/v1.0.0/CodexWallpaperDesktop.exe)（Release 附件）。
- 文件大小：102,455,559 字节（97.71 MiB）。
- 文件版本、产品版本和打包元数据：`1.0.0`。
- SHA-256：`991D3956D958BF5E5E40E2AC2EDA35994A2FB40DA0E7D690763B27DC90601AA7`。
- 校验清单：[SHA256SUMS.txt](https://github.com/whisperia6/codex-wallpaper-bridge/releases/download/v1.0.0/SHA256SUMS.txt)。

## 已完成的验证

- 项目测试目录中 105 个测试文件，955/955 项离线回归通过。
- 单文件打包成功；ASAR 完整性、必要解包资源和发布文件清单校验通过。
- 核对了打包载荷的 Windows x64 架构、版本元数据和主题资源。
- 仓库保留第三方资源的原始字节、必要许可和源码归档，并校验锁定文件的哈希。

上述自动化和结构校验不代替真实 Store/本地 EXE 双宿主的完整验收、长期运行、实际转码或硬件设备切换验证。详见 [README 限制说明](../README.md#目前的限制)。
