# 经验记录

## 原位升级不能用存活 PID 证明运行时一致

- 问题：复用全局 CLI 启动持久后端后，`npm install -g` 覆盖磁盘文件，旧 Node 进程仍运行；动态提供的前端资源变为新版，而内存里的模块清单仍是旧版。
- 证据：旧清单缺少 `dsh-api-remote-access`，新版 UI 等待 `remoteAccess`，20 项插件级联 pending；重启为 rc.2 后服务出现在清单且 UI 恢复。
- 修正：endpoint 同时记录并核对版本、数据目录和实际安装身份；旧记录或文件发生变化时拒绝复用。0.1.6 在用户授权后增加进程归属校验与自动温和重启，等待安装稳定，避免重复后端。
- 预防：升级验证应同时检查运行中进程、磁盘包版本和浏览器实际启动清单；HTTP 200 或 SSH“已连接”不足以证明 UI 就绪。不要通过给用户 profile 手工补依赖来掩盖版本混用。

## 命令退出与 SSH 转发退出是两件事

- 事实：Linux 隔离子进程测试通过，但实际浏览器持有转发连接时，远端 watcher 退出后本机 OpenSSH 仍存活，manager 未收到 close。
- 修正：收到明确 upgrading 协议通知即结束本机 SSH carrier，让既有重连逻辑接管。测试模拟不会自行退出的 carrier，断言本机确实结束它。

## WebSocket 错误处理必须早于上游握手

- 事实：自动关闭 carrier 时，浏览器在 upstream upgrade 回调之前 reset，网关尚未监听该 socket 的 error，导致本机 DSH host 因未捕获 ECONNRESET 退出。
- 修正：进入 upgrade 处理即订阅 error；浏览器 close 时撤销待定上游请求。新增测试先复现相同 TCP.onStreamRead 异常，修复后通过，完整 Desktop 重启验收亦通过。
