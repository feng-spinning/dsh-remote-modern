# 交接记录

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
