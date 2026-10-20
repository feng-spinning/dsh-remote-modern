# 经验记录

## 原生外观必须复用原生组件及其注册生命周期

- 用户纠正：0.2.0 自制侧栏超出“保持默认 UI、只加主机标识”的范围。0.2.1 保留官方组件/store/菜单，仅接入多主机数据。
- 首个适配候选没有远程目录：它复制原生 children 重新注册，DSH 明确禁止重复声明子插槽，客户端初始化随之失败。修正为装饰原组件 seat 并保留原声明，卸载恢复原函数。回归禁止重新声明 children；实际冷启动出现 tpu、holograms 与主机徽标。

## 链接在中文行文中需要明确结束边界

- 事实：`...hostId=local。只能...` 被宽泛正则整体纳入 URL，授权了错误 hostId，真实远端工具报没有授权。
- 修正：扫描 URL 字符，遇中文标点停止；完整 query 仍交解析器校验，不能吞掉重复参数错误。加入中文相邻正文和重复 hostId 回归，双向模型分页读取通过。

## 配套插件更新要检查内层结果与运行指纹

- 事实：RPC 信封成功不代表安装成功；DSH rc.2 目录覆盖安装返回 `application=failed / already-installed`，旧工具仍在运行。按官方流程移除并重装本任务配套包后，Node 又保留了旧 node_modules 符号链接 realpath，导致新模块文件被定位到旧目录。
- 修正：检查安装结果、只更新固定名称的自有配套包，并核验 status revision。使用内容限定文件名和不可变源码目录的绝对 file URL。真实修复后安装 applied、运行指纹匹配；更新不能仅凭文件存在、版本号或 RPC HTTP 200 认定成功。
- 同版本本机 tgz 覆盖到原路径也可能被 pnpm 判定为 Already up to date，DSH 返回 ambiguous-install。使用每次独立的产物路径并核对哈希、内层 applied 结果，不能用外层 RPC 成功认定已载入新代码。

## Cordis 的卸载不是名为 dispose 的普通事件

- 事实：连续热安装候选版后，本地引用发送退回草稿；明确输出错误为 `cannot get required service "connection" in inactive context`。当前 Cordis 的卸载运行 effect 的 disposer，没有发出普通 `dispose` 事件。
- 原因：原实现用 `ctx.on('dispose', ...)` 清理；旧 RPC 包装器、定时器及 manager 未释放。服务方法读取还会生成绑定上下文的 Proxy，不能用每次读取的方法身份比较或把绑定旧 context 的方法恢复回去。
- 修正：使用 `ctx.effect` 返回清理函数，以原始 property descriptor 安装和恢复方法。真实 Desktop 完整重启清除旧候选残留，双向口令验收通过；修复版再次热更新后发送仍成功，引用只展开一次。回归使用每次返回新绑定方法的服务 Proxy，禁止注册无效 dispose 事件。

## user/message 事件不等于用户正文

- 事实：DSH 也把 agent-instructions、runtime-context、skill-catalog、time-context 持久化为 `user/message`。仅按 event.type 取文本会让技能目录占满引用字符预算，挤掉实际问题。
- 修正：用户消息要求 `data.source.kind === 'user'`；助手只取 text part，排除推理和工具输出。历史中的插件引用块不再次加入引用。基于真实事件形状补充回归，并以双方随机口令验证结果。

## 组合 bundle 与响应成功仍需实际组件验证

- 事实：官方把多个客户端模块合在一条 `plugins/??…` 请求中；组合包约 9 MB。初次使用未绑定的 store 方法导致组件不显示，服务/API 验证没有暴露此问题。
- 修正：按模块 id 限定转换边界；为组合包保留明确大小限制。store subscribe/getSnapshot 用闭包调用保留 this。自动测试加上依赖 this 的模型，真实 Desktop 同时检查侧栏、主内容区和复制结果。

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
