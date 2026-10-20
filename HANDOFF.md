# 交接记录

## 2026-10-20：0.2.1 按需读取与原生侧栏（已安装并完成验收）

- 当前授权：用户已自行完成实际验收，确认两端通过 `read_session` 互读且响应迅速，添加工作区流程完整；明确要求不再使用 Computer Use，最后检查后 **git push**。版本为 **0.2.1**，基于 `724842bdceea07b0a7cdc8114c47829c7b6d1975`；本节对应提交包含最终代码、构建产物和记录。
- 用户要求仅添加远端服务器名和连接点，其余保留 DSH 默认 UI，并保留“添加工作区”的 Local/Remote 选择。已复用当前安装版原生侧栏组件、store、菜单及重命名弹窗；合并多主机数据，移除自制侧栏和远端顶栏。最后实际 Desktop 截图可见本地目录及远端 tpu、holograms，远端旁显示 dahua 和绿色连接点。
- “添加工作区”已接入原生 Modal 与菜单按钮：Local 调原始本地选择器；Remote 选择 SSH 主机并浏览远端目录。目录 API 实际列出 `/home/fengzj` 的 41 个条目。原生菜单的远端重命名/置顶 API 已实际执行并还原；用户随后确认添加工作区实际流程完整。
- 两端已注册可分页 `read_session`。固定源 seq，支持长消息字符续页，仅返回真实用户和助手文本，排除推理、工具输出及注入上下文。远端通过既有认证 SSH 网关的受限队列回读 Desktop，只允许读取当前会话已粘贴的确切链接。用户消息正文保持原样，不再追加 `<dsh_session_references>`。
- 真实模型双向验收已通过：本地模型调用工具 4 页读完远端，远端模型调用工具 6 页读完本地；两端各取回两个随机口令，末页均 `hasMore=false`，仅调用 `read_session`，保存的用户正文与原始提交完全一致。远端配套组件更新后重复调用也通过。专用测试会话 `session-0f894688-747b-4c06-9e2d-e854222c20be`（本地）、`session-6d68f9b1-8e55-4169-a433-91dde5de655b`（dahua）已归档。
- 旧会话只读核验结论：0.2.0 XML 属于预先附加的截取快照，本地 `session-f2bc7914-…` 的远端来源当时只附了一条助手回复，本地模型后来自行 SSH 查日志；远端 `session-542a14fb-…` 未读取到本地完整日志。旧消息未改写。当前 DSH 原生 `dsh-session:` 为同主机 additionalContext，不解析本插件 hostId 跨主机链接。
- 原始来源完整性已核对：远端 `session-a6e4223d-…` 的 1095 个事件跨 7 个原生事件页，实际只有 4 条可见用户/助手文本、10572 字符；本地 `session-11486705-46b8-4607-a5a8-16659c95d99d` 为 21 个事件、2 条可见文本、327 字符。分页器与事件内容相符，其余记录主要为工具/运行事件。
- 构建及 `npm run check` **26 项通过**，`git diff --check` 通过。新增覆盖中文标点链接边界、消息分页/长消息续页、跨主机授权、配套组件更新失败及运行指纹、原生插槽不得重复 children、远端全文索引关闭时保留标题搜索。dahua 的全文索引实际关闭，原生侧栏仍可检索合并的标题/目录；正文全文搜索不可用。
- 最终安装包：`../../output/dsh-reader-20261020/release/dsh-remote-modern-0.2.1.tgz`，SHA256 `dc44e9e5e132e6a9334d690ac7bc56be5c8da9b07c0a53d46de4014890faa191`。本机插件管理器返回 version 0.2.1、`application=applied`。同版本替换包必须使用新 spec 路径，重复覆盖原 tgz 路径会被 pnpm 视为 Already up to date，DSH 返回 ambiguous-install。
- dahua 配套 `dsh-remote-session-reader` 已安装并运行；最终连接核验 revision 为 `f73f333abfc9e75d711a71eb98021bb4c3bbc68cedb229e3bcda7dc81ed42fc3`。升级只移除/重装此自有配套包，并核验内层结果；不可变目录的绝对 file URL 避免旧符号链接 realpath 缓存。
- 验收证据边界：自动化完成双向真实模型、目录及菜单 API、原生侧栏截图核验。Computer Use 点击持续报 `foreground window did not report a process id`，未把 API 成功或截图等同于全部点击通过。用户已自行验收并明确表示无需继续 Computer Use；其实际使用确认补齐最终验收，不逐项推断用户执行过每个菜单动作。
- 最后无需 Computer Use 的检查：重新构建及 26 项测试全部通过，源码/锁文件/安装包版本均为 0.2.1，29 个打包文件与本机安装内容逐文件哈希一致，打包清单及差异格式检查通过。推送前读取远端 main，与本地基线无分歧。没有在途模型任务或剩余实施事项；后续 GitHub CI 结果以实际运行为准。
- 本机证据和恢复脚本：`../../output/dsh-reader-20261020/validation-summary.json`（紧凑双向证据）、`e2e-state.json`、`local-history.json`、`remote-history.json`、`raw-audit.json`、`source-*-pages.json`、`check.mjs`、`e2e-reader.mjs`；旧会话核验在 `../../output/dsh-unified-20261020/user-sessions-*.json`。不提交会话日志和凭据。当前 Desktop API authority `127.0.0.1:51307`，进程重启后须重新发现；安装辅助脚本为 `../../output/dsh-unified-20261020/live-check.mjs`。
- 决策及纠错依据见 [implementation-notes.md](implementation-notes.md) 和 [LESSONS.md](LESSONS.md)。支持 DSH 0.2.1-rc.2；读取正文不含附件/工具结果。切换 guest 的草稿和滚动保留仍不保证。

## 2026-10-20：统一 SSH 工作区与跨主机会话引用

- 用户授权在本仓库直接开发、安装本机 DSH Desktop 验证后 git push。交付版本 0.2.0，基于 main 0.1.6；仅连接既有 dahua。
- 已实现 0.2.0：本地/SSH 统一侧栏、远端 main 插槽、目录折叠和搜索、会话置顶/重命名/归档、按主机新会话、顶层剪贴板复制、带 hostId 的链接打开、双向历史文本引用。
- 自动验证：构建及 24 项回归通过，覆盖真实 store 的 this 绑定、Cordis 方法 Proxy 与卸载、HTTP/WS RPC、失败不发送、消息来源过滤、引用上限、组合 bundle 转换以及原连接器测试。
- 真实 Desktop 0.2.1-rc.2 + dahua：本地目录和远端 tpu/holograms 同栏；远端旧会话及文件卡片可见；实际剪贴板读到 `dsh://sessions/…?hostId=ssh%3Adahua`。真实组合 bundle 转换成功。
- 双向端到端：两个专用会话互引，远端模型正确回复本地随机口令，本地模型正确回复远端随机口令。初始本地 Tsinghua 模型返回 AUTH；仅测试会话切到已配置 DeepSeek 账号模型后通过，未改账号凭据。
- 重要修复：真实测试发现 DSH 注入提示也属于 user/message，已按 source 过滤；热更新原有 dispose 事件失效导致旧 context 残留，已改为 effect disposer，并完整退出重启 Desktop 清除旧候选实例。已知失败及依据见 LESSONS。
- 已安装最终 `final/dsh-remote-modern-0.2.0.tgz`，插件管理器返回 applied。从修复版再次热更新后真实发送成功，回复 HOT-UPDATE-OK；引用块恰好 1 个，测试没有调用工具。全局新会话在 SSH 下保持 dahua/tpu；两个专用验收会话已归档。源码、构建产物和本文档随本节对应 git 提交交付。
- 最终安装包 SHA256：`ebe1e8e055c23aa0ac8a9e156384847f2d15dbcd23313e4b45e98f634a21bfd8`。
- 本机辅助脚本和证据位于仓库外 `../../output/dsh-unified-20261020/`。`e2e-state.json` 记录专用测试 ID，`e2e-transcript.json` 和 `e2e-audit.json` 记录通过的口令、单次展开及热更新证据；脚本凭据仅在内存使用，不进入 git。重启后本机后端 authority 为 `127.0.0.1:60804`，以后需重新发现。
- 边界：引用最近 40 条消息窗口、最多 24,000 字符/会话、4 会话/提示；仅用户/助手文本，不包含工具结果/附件。只针对 DSH rc.2；不迁移运行任务。切换视图可能重载 guest，草稿/滚动位置保留暂不保证。未新增长时间断网和多远端并行压力测试；原 Linux supervisor/upgrade 测试本次未重复执行（相关代码未改）。
- 决策依据见 [implementation-notes.md](implementation-notes.md)。

## 2026-10-17：0.1.6 自动升级重启与重连（已完成）

- 按用户要求将过期后端处理改为自动化：连接期间每 5 秒检查安装身份，连续两次不匹配后主动关闭本机 SSH carrier，进入重连；离线后重新连接也执行同样检查。
- 安装文件连续稳定后才重启；Linux 核验用户、bootstrap 路径、启动参数、父子关系、数据目录和记录的进程启动时间，只向归属明确的 supervisor 发送 SIGTERM。attach 锁避免多客户端重复重启，20 秒未退出则停止替换，不强杀。不在全局安装暂时不可读时回退到私有副本，不静默降级未知版本。
- 成功重连增加 revision，前端据此重新加载内嵌页；网关重新认证。修复 WebSocket 握手未完成时 socket reset 会导致宿主退出的问题。
- 构建及 16 项测试通过；Linux `npm run test:upgrade` 在 dahua 隔离目录通过（模拟未完成安装、存在私有副本、并发重启、普通断开后持久运行）。已加入 Linux CI。
- 已安装最终 0.1.6。dahua 真实 Desktop 验收：仅改变 package.json 修改时间模拟安装身份变化，文件内容不变；约 14.5 秒后 supervisor/child 自动替换，连接 revision 1→2，宿主继续运行、页面自动恢复，无手工重连/刷新。
- 自动重启可能中断对应 Web 后端正在执行的任务。远端目标仍为 0.2.1-rc.2；未知未来版本需先验证适配，不承诺任意版本自动运行。普通关闭视图/断开连接仍保留后端。
- 首轮真实测试发现 SSH 远端命令退出不代表转发通道退出，已改为显式结束本机 carrier；第二轮发现握手中 socket reset，回归测试精确复现后修复，最终整链路验收通过。未访问其他 SSH 主机、未发送模型消息。

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
