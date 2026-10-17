# 交接记录

## 2026-10-17：0.1.4 Desktop SSH 内嵌适配

- 已支持本机 DSH 0.2.1-rc.2；远端后端仍固定为 0.2.0-rc.2。
- 通过当前 Desktop 的 `dshDesktop.browser` 租约创建隔离 webview。返回本地隐藏页面，重新打开保留页面状态；刷新、断开或卸载释放视图。旧桥接和 Web iframe 路径保留。决策依据见 [实现记录](implementation-notes.md)。
- 源码入口：`src/desktop-guest.js`、`src/client.js`；构建脚本：`scripts/build.mjs`；提交的客户端产物：`lib/client.js`。
- `npm run check` 已通过：构建和全部 11 项测试，其中 3 项覆盖 guest 生命周期。`git diff --check` 通过。
- 开发机另以 Electron 44.0.0 和当前 Desktop 安装包的 guest 策略完成原生验证：网关认证、HttpOnly cookie、sandbox、无 Node、本机主后端隔离、隐藏复用及释放通过。该本机安装包测试夹具不随仓库分发。
- 已在正式 Desktop 0.2.1-rc.2 安装插件并使用 dahua 验收：内嵌工作区、旧会话与图片显示正常，返回本地再打开保留原会话和滚动位置。仅测试这一 SSH 主机，未发送模型消息。
- 未修改 Desktop 应用包；未测试其他主机、长期断网恢复或远端工具执行。未来 Desktop 更新需要复核 browser bridge 契约；本次无剩余阻塞。
- 本次同步源码及构建产物到 GitHub；未发布 npm 包或创建 GitHub Release。用户可按 README 从 GitHub 安装或自行 `npm pack`。
