# 实现记录

## 2026-10-17：Desktop 0.2.1-rc.2

目标是在 Desktop 内显示 SSH 远端界面，并能返回本地。仅使用 dahua 验证。

当前官方 Desktop 已提供 `window.dshDesktop.browser`。主进程签发独立非持久 partition 和 lease，只接收 `about:blank#<lease>` 的 webview 初始挂载，清除调用者自选权限并强制 sandbox、contextIsolation、无 Node/preload，同时禁止访问本机 Harness 主后端。插件网关使用另一 loopback 端口，符合该导航策略。

选择复用官方 guest 机制，不迁移旧版自制 `WebContentsView` 壳补丁；这样本次可仅分发插件。远端子页面继续使用原有 SSH 网关认证，远端执行/历史/数据目录逻辑不变。切回本地只隐藏页面，断开或切换主机才释放 guest。旧版 `dshSSHRemote` 与 Web iframe 路径保留。

验证已通过：构建和 11 项测试、真实 Electron cookie 重定向和 sandbox、当前 Desktop 安装及 dahua 内嵌、切回本地再打开并保留原会话页面。原生测试直接复用了当前安装包中的 guest 策略类。应用包 SHA256 未变，正式插件版本为 0.1.4。未测试其他主机和长期断网恢复，未发送远端模型消息。当前状态见 [任务交接](HANDOFF.md)。
