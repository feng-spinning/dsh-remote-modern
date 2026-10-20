# dsh-remote-modern

[![CI](https://github.com/feng-spinning/dsh-remote-modern/actions/workflows/ci.yml/badge.svg)](https://github.com/feng-spinning/dsh-remote-modern/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](package.json)
[![DSH](https://img.shields.io/badge/dsh-0.2.1--rc.2-blueviolet.svg)](package.json)

[English](README.md) | 中文

为 **DeepSeek Harness** 提供的 SSH 远端后端插件。它把 Web 和 Desktop 客户端连接到运行在远端主机上的持久 dsh 后端，因此 GUI 操作的就是远端机器的工作区、会话、文件和终端。侧栏一键即可在本地与远端之间切换。

> **兼容性。** 0.2.1 插件针对本机及远端 dsh `0.2.1-rc.2`。统一侧栏使用此版本的工作区服务和布局接口；Desktop 使用应用内置的原生浏览器接口，无需修改 `app.asar`。参见[移植到其他 DSH 版本](#移植到其他-dsh-版本)。

## 功能

- **原生工作区侧栏** —— 本地和 SSH 目录共用 DSH 原生列表、菜单、搜索和对话框，远端目录只增加服务器名和连接点。「添加工作区」保留 Local / Remote 选择。
- **跨主机会话引用** —— 「复制 Session ID」生成带 `hostId` 的链接；模型通过 `read_session` 按需分页读取另一主机的会话。复制在 Desktop 顶层完成，避开隔离远端页面的剪贴板限制。
- **主机管理** —— 从 OpenSSH 用户配置中发现具体的 `Host` 别名（递归展开 `Include`），也支持手动保存 `user@host` 和可选端口。已保存主机以 `0600` 权限、原子写入的 JSON 存放在本机 dsh home 目录。
- **只读主机检测** —— 报告操作系统、架构、Node.js、npm、`base64` 情况以及远端是否已有连接器后端，全程不在远端创建或修改任何文件。
- **远端后端持久存活** —— 远端 dsh 进程由独立于 SSH 会话的 supervisor 持有。客户端断开不会停止它，重连会接回同一个进程。
- **单条 SSH 通道** —— 每个连接只启动一个 `ssh` 进程，承载一条动态 SOCKS 转发以到达远端后端的 loopback 端口，因此重连不依赖固定的服务端端口。
- **每主机独立 loopback 网关** —— 每个主机在 `127.0.0.1` 上拥有自己的网关，使用独立的随机 cookie 名与密钥。网关完成远端浏览器认证并改写 authority、origin 与 cookie，使远端页面可以像本地页面一样被嵌入。
- **复用远端既有配置** —— 远端后端使用主机已有的 `DSH_HOME`（默认 `~/.dsh`），因此凭据、工作区和历史会话就是远端原本那一份。
- **无本机降级执行** —— 隧道断开时网关返回 `503`，请求绝不会转到本机执行，也不会自动重放写操作。
- **同时服务 Desktop 与 Web** —— Web 在主内容区用 iframe 嵌入远端页面，Desktop 使用受沙箱约束的原生视图渲染。

## 环境要求

本机：

- **DeepSeek Harness `0.2.1-rc.2`**（Web 或 Desktop）。
- **Node.js 24 或更高**，且 `PATH` 中有 **pnpm**（`dsh plugin` 需要）。
- `PATH` 中有 **OpenSSH**。Windows 下优先使用 `%SystemRoot%\System32\OpenSSH\ssh.exe`。

远端主机：

- **Linux**（只读检测要求 `uname -s` 返回 `Linux`）。
- **Node.js 24 或更高**、**npm**、**base64**。
- SSH 密钥认证已可用。插件以 `BatchMode=yes` 和 `StrictHostKeyChecking=yes` 运行 `ssh`，因此不会提示输入密码，也不会跳过主机指纹校验。请先在终端执行一次 `ssh <主机>` 完成指纹确认。

运行依赖 `ws` 用于读取官方 WebSocket 历史流；安装时由包管理器处理。

## 安装

插件按 dsh profile 安装。`dsh plugin --profile <名称> add <spec>` 会把 spec 转发给 profile 目录中的 pnpm，并同时登记依赖和 bundle 层，一条命令即可完成。

```sh
# 已发布到 npm 后
dsh plugin --profile web add dsh-remote-modern

# 从 git 标签或默认分支安装
dsh plugin --profile web add github:feng-spinning/dsh-remote-modern

# 从打包好的 tarball 安装
npm pack
dsh plugin --profile web add file:/绝对路径/dsh-remote-modern-0.2.1.tgz

# 从准备修改的源码目录安装（软链接）
dsh plugin --profile web add link:/绝对路径/dsh-remote-modern
```

然后重启后端并重新打开 GUI：

```sh
dsh web
```

设置页提供「远程连接」分区，「添加工作区 → Remote」也可管理 SSH 主机。本包没有声明 `prepare` 脚本，因此从 git 安装不需要 `allowBuilds` 授权 —— `lib/` 已提交，且 CI 会校验它与重新构建的结果一致。

### Desktop

使用 Desktop 自身的插件管理器安装生成的 tarball。若返回“需要重启”，退出并重新打开 Desktop 后生效；普通 Web CLI 不负责启动 `desktop` profile。

从「添加工作区 → Remote」或设置中的「远程连接」选择主机，远端目录会加入左侧工作区列表。展开目录后点击会话即可打开；点击本地会话即可切回。目录旁的「+」在对应主机建会话，顶部「新会话」跟随当前可见主机。远端内容使用官方 `dshDesktop.browser` 租约和隔离分区；切换主机可能重新加载视图，已保存历史保留，暂未承诺未发送草稿及滚动位置的跨视图保留。

## 使用

连接期间每 5 秒检查远端安装，连续两次发现变化后自动重连；重新连接也会检查离线期间的升级。插件先等待安装文件稳定，再核验 Linux 进程用户、supervisor 与子进程命令、父子关系、数据目录和已记录的启动时间，向对应 supervisor 发送 SIGTERM，等待退出后启动新后端。并发连接共用 attach 锁，仅进行一次重启；重连完成后重新认证网关并刷新内嵌页面。

自动重启可能中断该 Web 后端正在执行的任务，已保存会话仍使用原数据目录。普通「断开」依旧不停止后端。进程归属无法核验、停止超时或远端版本超出兼容范围时显示明确错误；不强杀进程，不把未知全局版本静默降级。目前远端兼容目标为 `0.2.1-rc.2`，未来 DSH 版本仍需验证适配。

1. 在终端执行一次 `ssh <主机>`，确认主机指纹并验证密钥认证。
2. 从设置页打开**远程连接**，或选择**添加工作区 → Remote → 管理 SSH 主机**。
3. 添加主机：选择发现到的 SSH config 别名，或直接填写 `user@host`（非 22 端口请一并填写端口）。然后执行一次只读检测。
4. 点击连接。首次连接时，若远端没有匹配的 CLI，会在远端安装私有且版本精确的 dsh 运行时，随后启动后端。进度依次显示为*正在安装 → 正在启动 → 正在建立 SSH 隧道*。
5. 远端目录加入统一侧栏，点击远端会话后右侧文件和终端来自该远端。点击任一本地会话即可切回。
6. **断开**只会关闭本机 SSH 进程和网关，远端后端继续运行，因此重连很快。

### 双向引用会话

在统一侧栏会话的「···」菜单中选择「复制 Session ID」：

```text
dsh://sessions/session-…?hostId=local
dsh://sessions/session-…?hostId=ssh%3Adahua
```

粘贴链接并要求模型读取即可。用户发送的原文保持不变，不再追加会话正文或 XML。模型调用 `read_session` 时才读取。SSH 别名必须已配置；裸 ID 不会猜测主机。

每次默认返回最多 20 条用户/助手消息，可设置 1–50 条，单页最多 24,000 字符。分页固定在首次读取的事件位置，从近到远翻页，页内按时间顺序排列；用 `nextCursor` 继续读取，直到 `hasMore=false`，即可读完全部用户和助手文本。长消息也可续页。环境提示、技能目录、推理、工具输出和附件不在返回范围内。结果通过工具返回进入目标模型上下文。读取时排除旧 XML 附录，但不会改写已经保存的历史消息。

连接器会在远端安装配套读取插件。远端读本地通过已有认证 SSH 网关的只读请求队列完成，不增加反向端口，也不向模型暴露本机凭据；只授权通过 Desktop 粘贴到当前目标会话的具体链接。`hostId=local` 始终指发起连接的 Desktop，不会被当作 Linux 本机。读取时 Desktop 和 SSH 连接需要保持在线。

## 工作原理

### 连接链路

```
GUI（Web iframe / Desktop 原生视图）
  │  网关 origin  http://127.0.0.1:<网关端口>
  ▼
网关                        随机密钥、独立 cookie、Host/Origin 校验
  │  loopback 转发          本机端口 → 远端后端端口
  ▼
SOCKS 转发                  建立在单个 ssh 进程的动态转发之上
  │  ssh -T -D 127.0.0.1:<socksPort> -- <target> sh -c '<bootstrap>'
  ▼
远端 bootstrap              ~/.dsh-remote-modern/bootstrap/<sha256>.cjs
  │  attach → 按需安装 → 分离的 supervisor
  ▼
远端 supervisor             dsh --profile web --no-open --host 127.0.0.1 --port 0
  │
  ▼
远端 dsh 后端               基于远端 DSH_HOME 提供远端工作区
```

`RemoteManager` 为每个主机维护状态机：`connecting`、`connected`、`reconnecting`、`disconnected`，退避上限 10 秒并带抖动。对同一主机的并发 `connect` 会收敛到同一个 SSH 进程。断开时会中止仍在进行的启动流程，而不是留下孤儿进程。

### 状态存放位置

| 位置 | 内容 |
|---|---|
| `$DSH_HOME/ssh-remote-modern/hosts.json` | 本机已保存主机列表，`0600`，原子写入 |
| `~/.dsh-remote-modern/runtime/<版本>/` | 私有 dsh 安装，仅在远端没有匹配 CLI 时使用 |
| `~/.dsh-remote-modern/bootstrap/<sha256>.cjs` | 上传的 bootstrap，按源码哈希命名 |
| `~/.dsh-remote-modern/endpoint.json` | 当前后端 `{version, dataHome, pid, childPid, port, token}`，`0600` |
| `~/.dsh-remote-modern/backend.log` | supervisor 与后端输出 |
| `~/.dsh-remote-modern/attach.lock` | 串行化并发 attach |
| 远端的 `$DSH_HOME` 或 `~/.dsh` | **远端既有 dsh 数据**，复用且不迁移 |

只有当 `endpoint.json` 声明的版本正确、`dataHome` 匹配，且记录的两个进程都存活时才会被复用。过期或不匹配的 endpoint 会被忽略，而不是迁移。

### 远端凭据

在 Linux 上，如果非交互 SSH 环境没有 `DEEPSEEK_API_KEY`，bootstrap 会通过一个**专用文件描述符**（`>&3`）从用户已有的交互式 bash/zsh 环境中读取该变量，并丢弃该描述符的输出。密钥以远端进程内存的形式传给后端：不写入连接器日志、不出现在 `DSH_SSH_READY` 记录中、也不会从本机复制过来。不会修改任何 shell 配置文件。

## 安全模型

- **从不放松主机校验。** SSH 始终带 `StrictHostKeyChecking=yes`、`BatchMode=yes`、`PermitLocalCommand=no`、`RemoteCommand=none`、`ControlMaster=no`、`ControlPath=none`。
- **网关仅监听 loopback**，端口为临时端口。它同时要求 `Host` 头匹配，以及通过一次性 `?sshAuth=` 重定向下发的随机密钥对应的 `HttpOnly; SameSite=Strict` cookie。带跨站 `Origin` 或 `sec-fetch-site: cross-site` 的请求会被 `403` 拒绝。
- **远端机密留在上游。** 远端 dsh token 与远端会话 cookie 只存在于本机后端内存中。响应会剥除 `set-cookie`，上行请求会删除 `authorization`，上游 `location` 头会被改写，因此远端 authority 不会到达浏览器。
- **不会静默降级到本机。** 网关在断开状态返回 `503`，客户端显示等待状态，写操作绝不自动重放。
- **远端目标先校验再启动。** 保存的主机必须匹配严格的别名/`user@host` 模式，且作为 `--` 之后的参数传递，无法注入 SSH 选项或 shell 命令。
- **远端只新增连接器目录。** 不上传项目、不修改 `~/.ssh/config`、不复制本机模型凭据。

## 已知限制

- **仅支持 Linux 远端。** macOS 和 Windows 远端未经验证，只读检测会拒绝它们。
- **版本强耦合。** 连接器只安装并接受远端 dsh `0.2.1-rc.2`；本机客户端版本范围见兼容性声明。升级后需重新核对原生浏览器接口。
- **没有远端停止按钮。** 按设计，断开只作用于本机；停止后端需要在远端根据 `endpoint.json` 记录的 PID 自行确认进程身份后处理。
- **不是纯前端扩展。** 插件依赖本机 dsh 后端运行，且该后端必须仅监听 loopback。
- **没有服务化持久。** 远端 supervisor 是用户进程，不承诺机器重启后自动恢复。
- **不迁移任务。** 统一侧栏与文本引用不包括跨主机任务迁移或系统服务管理。
- **布局适配随版本验证。** 网关只对指定远端 UI 模块隐藏重复侧栏并添加导航；官方接口或 bundle 结构改变时需更新插件。

### 验证状态

在 Windows Desktop `0.2.1-rc.2` 与真实 Linux SSH 主机验证侧栏和双方历史读取。两个专用会话的真实模型分别调用 4 页、6 页读取工具，正确读出另一主机的随机口令，用户正文保持不变。26 项自动测试覆盖原生组件/store 复用、主机路由、卸载清理、历史分页、引用失败、组合 bundle 转换及原连接器回归。supervisor 和升级重启的独立 Linux 测试仍保留；完整 UI 验收状态见 [HANDOFF.md](HANDOFF.md)。

## 移植到其他 DSH 版本

目标版本固定写在以下几处。若要适配其他 dsh 版本，请全部修改后重新执行 `npm run check`：

| 文件 | 需要修改的内容 |
|---|---|
| `src/remote-bootstrap.cjs` | `const VERSION = '0.2.1-rc.2'`（远端后端） |
| `src/tunnel.js` | `endpoint.version !== '0.2.1-rc.2'` 兼容性检查（远端后端） |
| `package.json` | `engines.dsh`（本机客户端支持范围），以及 `description` 中提到的版本 |
| `src/guest-integration.js`、`src/unified-client.js` | 布局模块结构、工作区/会话服务、消息提交接口 |
| `test/helpers.js` | 模拟 endpoint 的 `version` |
| `test/manager.test.js` | 对 `bootstrapCommand()` 内嵌版本的断言 |
| `test/supervisor.integration.js` | `runtime/<版本>/node_modules` 路径 |

## 开发

```sh
npm ci          # 安装锁定依赖
npm run build   # 由 src/ 重新生成 lib/
npm test        # 单元测试，需要本机 loopback，不访问互联网
npm run check   # build + test，与 CI 一致
```

`lib/` 需要提交，因为 Cordis loader 直接引用它；修改源码后请务必重新构建并一并提交。测试矩阵、手工验证步骤与代码结构见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可与出处

Apache-2.0，见 [LICENSE](LICENSE)。

SSH 配置发现与 SOCKS 转发模块源自
[Yan-Zero/dsh-remote-ssh](https://github.com/Yan-Zero/dsh-remote-ssh)
（Apache-2.0）；原始 TypeScript 源码连同原有注释保留在 `src/upstream-*.ts`。见 [NOTICE](NOTICE)。
