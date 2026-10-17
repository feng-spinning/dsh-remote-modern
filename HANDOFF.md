# 交接记录

## 2026-10-17：0.1.5 远端全局升级后加载失败（已修复）

- 原因：全局 npm 升级覆盖原 CLI 目录，插件仍复用旧 0.2.0-rc.2 supervisor/后端。旧进程生成的启动清单不包含 `@deepseek-ai/dsh-api-remote-access`，但磁盘上的新版 UI 已依赖其 `remoteAccess` 服务，导致 20 项级联 pending。
- 远端固定版本升级为 0.2.1-rc.2；endpoint 记录实际 CLI 路径和安装指纹。仅复用同数据目录、同版本、同安装身份的存活 endpoint；对仍存活的过期实例报出重启指引，不自动终止任务或并行启动另一后端。
- 已在 dahua 备份 endpoint、核验父子进程身份、停止旧 supervisor，并以现有 rc.2 全局安装启动新版后端。本机 Desktop 已安装 0.1.5，工作区、旧会话、报告图片恢复；重复连接复用同一新版后端。未发送模型消息、未访问其他 SSH 主机。
- 构建成功；最终 12 项测试全部通过，包括原位替换失效和过期存活 endpoint 不被改写/终止。真实 SSH 网关 HTTP 200，新的 Web 清单包含所缺服务。原生隔离逻辑未修改。
- 安装包可用 `npm pack` 生成。后续全局升级需要同步重启插件管理的远端 Web 后端；说明见 README。根因经验见 [LESSONS.md](LESSONS.md)。

## 2026-10-17：0.1.4 Desktop SSH 内嵌适配

- 已支持本机 DSH 0.2.1-rc.2；远端后端仍固定为 0.2.0-rc.2。
- 通过当前 Desktop 的 `dshDesktop.browser` 租约创建隔离 webview。返回本地隐藏页面，重新打开保留页面状态；刷新、断开或卸载释放视图。旧桥接和 Web iframe 路径保留。决策依据见 [实现记录](implementation-notes.md)。
- 源码入口：`src/desktop-guest.js`、`src/client.js`；构建脚本：`scripts/build.mjs`；提交的客户端产物：`lib/client.js`。
- `npm run check` 已通过：构建和全部 11 项测试，其中 3 项覆盖 guest 生命周期。`git diff --check` 通过。
- 开发机另以 Electron 44.0.0 和当前 Desktop 安装包的 guest 策略完成原生验证：网关认证、HttpOnly cookie、sandbox、无 Node、本机主后端隔离、隐藏复用及释放通过。该本机安装包测试夹具不随仓库分发。
- 已在正式 Desktop 0.2.1-rc.2 安装插件并使用 dahua 验收：内嵌工作区、旧会话与图片显示正常，返回本地再打开保留原会话和滚动位置。仅测试这一 SSH 主机，未发送模型消息。
- 未修改 Desktop 应用包；未测试其他主机、长期断网恢复或远端工具执行。未来 Desktop 更新需要复核 browser bridge 契约；本次无剩余阻塞。
- 本次同步源码及构建产物到 GitHub；未发布 npm 包或创建 GitHub Release。用户可按 README 从 GitHub 安装或自行 `npm pack`。
