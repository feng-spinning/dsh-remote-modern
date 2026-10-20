# 实现记录

## 2026-10-20：统一侧栏与主机身份

- 采用官方 `sidebar.workspaces` priority 插槽提供本地和远端目录统一导航，远端聊天进入 `main` 插槽；继续使用 Desktop 的隔离 webview 租约、原有网关认证和 SSH 生命周期。无需重新打包 Desktop。
- 目录与会话摘要由公开 workspace/session API 读取；远端会话摘要投影为侧栏需要的最小字段，不把完整 projection 缓存到浏览器。
- 网关只针对已识别的 workspace/layout 客户端 bundle 加入导航入口并折叠重复远端侧栏；支持官方组合 bundle URL。版本或结构不匹配时明确失败。远端应用文件不改写、不部署额外插件。
- 会话引用以 `dsh://sessions/<sessionId>?hostId=local` 或 `hostId=ssh%3A<SSH target>` 表达。主机必须在配置中存在；相同 sessionId 在不同主机不会混淆；不扫描其他主机猜测裸 ID。
- 本地发送经客户端 RPC 包装器展开引用；远端发送在已认证网关内展开；读取失败阻止提交。只读取明确引用的会话，至多 4 个、每个最近 40 条消息/24000 字符，仅 user/assistant 文本，明确标记截断，不递归执行历史指令，不传输工具结果、推理或附件原始字节。
- 本机顶层侧栏负责复制，避免远端 guest 的浏览器剪贴板限制；失败时提供可选择的完整链接。未注册 Windows URL 协议；应用内可粘贴打开链接或放入提示词引用。
- 真实消息形状要求 `data.source.kind === 'user'` 才计入用户正文；技能目录、环境快照不能占用引用窗口。历史引用块跳过以免反复嵌套。引用文本会在目标会话中保存及显示，具体边界已写入 README。
- 统一侧栏默认折叠并保存折叠状态，按主机/工作区区分；全局新会话按钮跟随当前主机。原生本地显式工作区请求仍交给原服务。
- 当前 Cordis 采用 effect disposer；普通 `dispose` 事件不会执行卸载。包装方法必须用原始 descriptor 安装/恢复，避免服务 Proxy 绑定失效 context。此前候选的失效实例经完整退出重启清除；此修复也覆盖原有 manager/刷新定时器清理。
- 支持范围收窄到本机/远端 `0.2.1-rc.2`，因为新布局适配只验证此版本。保持主内容插槽的最小实现，切换可重建 guest，暂不保证草稿和滚动位置保留；已明确记录。
- 当前状态、验证边界与交付记录见 [HANDOFF.md](HANDOFF.md)。

## 2026-10-17：自动重启的所有权与连接生命周期

用户明确要求自动重启，替代 0.1.5 的手动重启边界。监测放在 SSH 前台 bootstrap 中，普通断开时监测随通道退出，持久 supervisor 不受影响。检测到变化后让本机 manager 走既有重试流程，下一次 attach 在同一远端锁内等待安装稳定、核验进程归属、温和停止并启动新版。复用现有连接路径和网关，避免第二套调度/状态机。

只比较 PID 不足以安全停止进程：Linux /proc 同时验证 UID、父子关系、精确命令、bootstrap 目录与内容哈希格式文件名、数据目录，以及新 endpoint 保存的启动时刻。旧版没有启动时刻字段时仍要求完整的路径和父子链匹配。无法核验或 20 秒内未退出时保留错误，不发送 SIGKILL。未知全局版本不自动降级。安装可能暂时不存在，原来使用全局 CLI 的实例必须等待它恢复，不能趁空窗选中私有旧副本。

真实 SSH 暴露两处差异：OpenSSH 会为现有转发连接继续存活，必须在收到 upgrading 通知后主动结束本机 carrier；浏览器会在远端 WebSocket 握手未完成时 reset，此时必须立即装上 socket error/close 处理，不能等握手成功才订阅。两项均有回归测试，后者先复现了与宿主崩溃一致的 ECONNRESET。

通过 manager revision 通知前端刷新，避免只恢复 TCP 而仍显示旧模块清单。最终 16 项测试、Linux 隔离生命周期测试和 dahua 实际 Desktop 的安装指纹模拟通过。此次模拟只改包清单的 mtime，未再次 npm 安装或修改内容；14.5 秒自动完成重启，revision 从 1 到 2。实际跨未来版本升级仍受远端兼容范围约束。

## 2026-10-17：远端升级后的进程与磁盘版本一致性

观察到旧 endpoint 的版本为 0.2.0-rc.2，仍运行的进程指向已被 npm 升级为 0.2.1-rc.2 的全局 CLI 目录。旧启动清单没有 `dsh-api-remote-access`，新版前端却依赖 `remoteAccess`。重启为 rc.2 后，清单出现该服务，界面恢复，因果链已通过实际前后对照确认。

0.1.5 将远端目标更新为 rc.2，同时让 endpoint 携带 realpath CLI 与 package/bin 内容及 manifest 修改时间的 SHA256。attach 校验实际安装身份，拒绝只凭存活 PID 和旧版本字符串判定可复用。对过期但存活的后端选择报错并要求重启，不自动 kill，避免中断用户任务；也不在同一数据目录旁边另起后端。本次实际修复先备份、核验插件 supervisor 与子进程关系，再停止和重建。全局升级不会自动重启现有 Node 进程，这是持久后端的升级边界。

12 项测试通过，dahua 真实 rc.2 网关与 Desktop 旧会话恢复验证通过；未新增壳补丁或改动会话数据。

## 2026-10-17：Desktop 0.2.1-rc.2

目标是在 Desktop 内显示 SSH 远端界面，并能返回本地。仅使用 dahua 验证。

当前官方 Desktop 已提供 `window.dshDesktop.browser`。主进程签发独立非持久 partition 和 lease，只接收 `about:blank#<lease>` 的 webview 初始挂载，清除调用者自选权限并强制 sandbox、contextIsolation、无 Node/preload，同时禁止访问本机 Harness 主后端。插件网关使用另一 loopback 端口，符合该导航策略。

选择复用官方 guest 机制，不迁移旧版自制 `WebContentsView` 壳补丁；这样本次可仅分发插件。远端子页面继续使用原有 SSH 网关认证，远端执行/历史/数据目录逻辑不变。切回本地只隐藏页面，断开或切换主机才释放 guest。旧版 `dshSSHRemote` 与 Web iframe 路径保留。

验证已通过：构建和 11 项测试、真实 Electron cookie 重定向和 sandbox、当前 Desktop 安装及 dahua 内嵌、切回本地再打开并保留原会话页面。原生测试直接复用了当前安装包中的 guest 策略类。应用包 SHA256 未变，正式插件版本为 0.1.4。未测试其他主机和长期断网恢复，未发送远端模型消息。当前状态见 [任务交接](HANDOFF.md)。
## 2026-10-20 0.2.1 修订决策

- 用户要求保留 DSH 默认 UI。0.2.0 自制侧栏超出了用户所需风格范围，本轮复用安装版原生组件、store 和菜单，只合并数据及注入主机徽标。
- 用户选择按需读取。此前快照追加进 user content，不等于模型有实时读取能力，且原来的 40 条原始消息窗可能只剩一条有效助手文本。新 `read_session` 按可见文本分页，固定源 seq，长消息通过字符游标继续；只读用户/助手正文，排除推理、工具输出和注入上下文。
- 当前 DSH 原生 `dsh-session:` 引用通过 agent/pre-step 生成独立 additionalContext，仅有 sessionId，没有跨主机路由。本轮保留原生同主机能力，插件只实现带 hostId 的工具读取。
- 为远端回读采用现有认证网关内的请求队列；桌面发送链接时仅登记当前会话的精确链接授权，不更改正文。远端配套工具随 SSH bootstrap 写入版本化目录并通过原生插件管理器安装。避免开放本机通用 RPC/凭据或新增反向端口。
- 用户恢复验收后明确版本为 0.2.1，并要求先本机安装；实际自行验收后确认双向读取迅速、添加工作区完整，再授权最后检查和 git push，并明确无需继续 Computer Use。
- DSH 不允许两次声明同名子插槽，因此不再用复制 children 的 shadow registration。适配器装饰现有 component seat，保留原 store、inject 和 children 授权；用临时未选中注册触发公共通知，卸载恢复原组件。「添加工作区」使用原生 Modal，Local 调原始选择器，Remote 通过认证网关列目录。
- 链接扫描限定 URL 字符并保留完整 query 供校验；紧接中文句号时停止，防止把中文后文纳入 hostId。远端首轮真实工具调用失败准确复现此问题，修复后 6 页读取通过。
- 远端 DSH 的目录包更新要求先卸载旧配套包再安装；每次必须检查内层 `application/error` 并核验运行指纹。仅操作本插件创建的 `dsh-remote-session-reader`，不重启业务后端。入口和依赖使用内容哈希文件名，bootstrap 把入口写成不可变源码目录的绝对 file URL，避开 Node 对旧 node_modules 符号链接的 realpath 缓存。
- 实测本地模型 4 页读取远端、远端模型 6 页读取本地，各取回两个随机口令；请求正文均未改写。原有远端来源日志 1095 个事件通过 7 个原生事件页核对完成，只含 4 条用户/助手可见文本，其余主要为工具与运行事件。
- dahua 关闭了全文搜索索引，原生搜索 API 明确报 `session search is disabled`。仅对此错误返回空正文匹配，保留原生组件对合并目录和标题的搜索；其他远端错误仍上报，不把索引状态当作断线。
- 同版本本机候选包不能覆盖同一个 tgz 路径后重装：pnpm 会视为相同依赖，DSH 返回 ambiguous-install。最终包换用独立 release 路径，检查管理器 `application=applied`，同时核对包哈希及配套组件运行指纹。
- 当前安装、UI 验收和 Computer Use 状态见 [HANDOFF.md](HANDOFF.md)；26 项回归通过。
