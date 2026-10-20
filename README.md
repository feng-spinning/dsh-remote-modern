# dsh-remote-modern

[![CI](https://github.com/feng-spinning/dsh-remote-modern/actions/workflows/ci.yml/badge.svg)](https://github.com/feng-spinning/dsh-remote-modern/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](package.json)
[![DSH](https://img.shields.io/badge/dsh-0.2.1--rc.2-blueviolet.svg)](package.json)

English | [中文](README.zh.md)

An SSH remote-backend plugin for **DeepSeek Harness**. It connects the Web and
Desktop clients to a persistent dsh backend running on a remote host, so the
remote machine's workspace, sessions, files and terminal are what the GUI
operates on. Switching between local and remote is one click in the sidebar.

> **Compatibility.** Plugin 0.2.1 targets dsh `0.2.1-rc.2` on both hosts.
> The unified sidebar uses that release's workspace and layout services.
> Desktop uses its built-in browser bridge without modifying `app.asar`. See
> [Porting to another DSH version](#porting-to-another-dsh-version).

## Features

- **Native workspace sidebar** — local and SSH folders share DSH's own list,
  menus, search and dialogs. Remote folders add only a server name and connection
  dot. Add Workspace offers Local / Remote.
- **Cross-host session references** — Copy Session ID produces a link with
  `hostId`. The model can read the linked conversation on demand with the
  paginated `read_session` tool. Clipboard writes run in the Desktop parent document.
- **Host management** — discovers concrete `Host` aliases from your OpenSSH
  user config (recursively expanding `Include`), and accepts manually saved
  `user@host` entries with an optional port. Saved hosts live in your dsh home
  directory as `0600`, atomically written JSON.
- **Read-only host check** — reports OS, architecture, Node.js, npm and
  `base64` availability, plus whether a connector backend is already present,
  without creating or changing anything on the remote host.
- **Persistent remote backend** — the remote dsh process is owned by a
  supervisor that is independent of the SSH session. Disconnecting the client
  does not stop it; reconnecting attaches back to the same process.
- **Single SSH channel** — one `ssh` process per connection. It carries a
  dynamic SOCKS forward that reaches the remote backend's loopback port, so
  reconnects never depend on a fixed server-side port.
- **Per-host loopback gateway** — each host gets its own gateway on
  `127.0.0.1` with its own random cookie name and secret. It performs the
  remote browser authentication and rewrites authority, origin and cookies, so
  the remote page can be embedded as if it were local.
- **Reuses the remote profile** — the remote backend runs against the host's
  existing `DSH_HOME` (defaulting to `~/.dsh`), so credentials, workspaces and
  conversation history are the ones already there.
- **No local fallback** — while the tunnel is down the gateway answers `503`.
  Requests are never executed locally and mutations are never replayed.
- **Desktop and Web** — the same plugin serves both. Web embeds the remote page
  in the main pane's iframe; Desktop renders it in a sandboxed native view.

## Requirements

Local machine:

- **DeepSeek Harness `0.2.1-rc.2`** (Web or Desktop).
- **Node.js 24 or newer** with **pnpm** available on `PATH` — required by
  `dsh plugin`.
- **OpenSSH** on `PATH`. On Windows the plugin prefers
  `%SystemRoot%\System32\OpenSSH\ssh.exe` when present.

Remote host:

- **Linux** (the read-only probe requires `uname -s` to report `Linux`).
- **Node.js 24 or newer**, **npm** and **base64**.
- Key-based SSH authentication already working. The plugin runs `ssh` with
  `BatchMode=yes` and `StrictHostKeyChecking=yes`, so it never prompts for a
  password and never bypasses host-key verification. Run `ssh <host>` once in a
  terminal first to accept the host key.

The `ws` runtime dependency reads official WebSocket history streams.

## Install

Plugins are installed per dsh profile. `dsh plugin --profile <name> add <spec>`
forwards the spec to pnpm in the profile directory and records both the
dependency and the bundle layer, so a single command is enough.

```sh
# From npm, once published
dsh plugin --profile web add dsh-remote-modern

# From a git tag or the default branch
dsh plugin --profile web add github:feng-spinning/dsh-remote-modern

# From a packed tarball
npm pack
dsh plugin --profile web add file:/absolute/path/to/dsh-remote-modern-0.2.1.tgz

# From a source checkout you intend to edit (symlinked)
dsh plugin --profile web add link:/absolute/path/to/dsh-remote-modern
```

Then restart the backend and reopen the GUI:

```sh
dsh web
```

A **远程连接 / Remote connection** settings section manages hosts; Add Workspace
also offers Remote and host management. The package declares no `prepare` script, so git-hosted
installs need no `allowBuilds` approval — `lib/` is committed and CI verifies
it matches a fresh build.

### Desktop

Install the tarball through Desktop's own plugin manager. If it reports that a
restart is required, quit and reopen Desktop. The ordinary Web CLI does not
launch the reserved `desktop` profile.

Desktop 0.2.1 embeds the selected SSH host using its built-in
`dshDesktop.browser` lease and isolated webview. No `app.asar` patch is needed.
Connect from **Add Workspace → Remote** or the connection settings, then expand a remote folder.
Click a local session to switch back. The folder's **+** creates a chat on that
host; the global New Chat button follows the visible host. Switching may reload
the view: saved history persists, but unsent drafts and scroll positions are not
guaranteed across views.

While connected, the plugin checks the remote installation every five seconds.
After two changed samples it reconnects, waits for a stable installation, and
automatically restarts the connector-owned Web backend. Reconnection also checks
for upgrades made while disconnected. Linux process ownership, parent/child
commands, data home and recorded process start times are verified before sending
SIGTERM. Concurrent clients share one restart under the attach lock. A successful
reconnect reauthenticates the gateway and reloads the embedded page.

This restart can interrupt work running in that Web backend; saved conversations
remain in the same data directory. Disconnecting alone still leaves the backend
running. Unknown DSH versions outside the declared remote compatibility range,
unverifiable process ownership or a shutdown timeout stop automatic replacement
with a visible error. The plugin never silently downgrades an unsupported global
version or force-kills an unresponsive process. Upgrade support currently targets
remote `0.2.1-rc.2`; future DSH releases still require compatibility validation.

## Usage

1. In a terminal, run `ssh <host>` once so the host key is known and key auth
   works.
2. Open **远程连接 / Remote connection** in settings, or **Add Workspace → Remote → Manage SSH hosts**.
3. Add the host: either pick a discovered SSH config alias, or type
   `user@host` (and a port if it is not 22). Then run the read-only check.
4. Connect. The first connection installs a private, exact-version dsh runtime
   on the remote host if a matching CLI is not already available, then starts
   the backend. Progress is shown as *installing → starting → establishing SSH
   tunnel*.
5. Remote folders appear in the shared sidebar. Selecting a remote chat routes
   its files and terminal to that host. Select any local chat to return.
6. **断开 / Disconnect** closes the local SSH process and gateway. The remote
   backend keeps running, so reconnecting is fast.

### Referencing sessions in either direction

Choose **复制 Session ID** in a sidebar session's **···** menu:

```text
dsh://sessions/session-…?hostId=local
dsh://sessions/session-…?hostId=ssh%3Adahua
```

Paste a link and ask the model to read it. The original prompt is preserved;
no conversation text or XML appendix is added. `read_session` retrieves text only
when the model calls it. SSH aliases must already be configured; bare IDs do not
guess a host.

Each call returns at most 20 messages by default (configurable from 1 to 50),
bounded to 24,000 characters. Pages run newest to oldest against a fixed event
cursor, with chronological messages inside each page. Follow `nextCursor` until
`hasMore` is false to read all user/assistant text, including split long messages.
Runtime context, skill catalogs, reasoning, tool output and attachments are excluded.
Results enter the destination model context as tool results. Old XML appendices
are excluded from reads, but existing messages are not rewritten.

The connector installs a small versioned reader companion on the remote host.
Remote-to-local reads use a read-only mailbox over the existing authenticated SSH
gateway; no reverse port or local credential is exposed. The mailbox authorizes
only links pasted into that destination conversation through Desktop.
`hostId=local` always identifies the originating Desktop, never the Linux host.
Desktop and SSH must remain connected for these reads.

## How it works

### Connection path

```
GUI (Web iframe / Desktop native view)
  │  gateway origin  http://127.0.0.1:<gatewayPort>
  ▼
Gateway                    random secret, own cookie, Host/Origin checks
  │  loopback forward     local port → remote backend port
  ▼
SOCKS forward              created over the dynamic forward of one ssh process
  │  ssh -T -D 127.0.0.1:<socksPort> -- <target> sh -c '<bootstrap>'
  ▼
remote bootstrap           ~/.dsh-remote-modern/bootstrap/<sha256>.cjs
  │  attach → install-if-needed → detached supervisor
  ▼
remote supervisor          dsh --profile web --no-open --host 127.0.0.1 --port 0
  │
  ▼
remote dsh backend         serves the remote workspace against the remote DSH_HOME
```

`RemoteManager` owns the state machine per host: `connecting`, `connected`,
`reconnecting`, `disconnected`, with exponential backoff capped at 10 seconds
and jitter. Concurrent `connect` calls for one host converge on a single SSH
process. Disconnect aborts an in-flight startup rather than leaving an orphan.

### Where state lives

| Location | Contents |
|---|---|
| `$DSH_HOME/ssh-remote-modern/hosts.json` | Local saved host list, `0600`, atomic write |
| `~/.dsh-remote-modern/runtime/<version>/` | Private dsh install, used only when no matching CLI is already present |
| `~/.dsh-remote-modern/bootstrap/<sha256>.cjs` | The uploaded bootstrap, keyed by source hash |
| `~/.dsh-remote-modern/endpoint.json` | Current backend `{version, dataHome, pid, childPid, port, token}`, `0600` |
| `~/.dsh-remote-modern/backend.log` | Supervisor and backend output |
| `~/.dsh-remote-modern/attach.lock` | Serializes concurrent attaches |
| `$DSH_HOME` or `~/.dsh` on the remote | **Your existing dsh data**, reused and not relocated |

An `endpoint.json` is reused only when it declares the current version, the
expected `dataHome`, and both recorded processes are alive. A stale or
mismatched endpoint is ignored rather than migrated.

### Remote credentials

On Linux, if the non-interactive SSH environment has no `DEEPSEEK_API_KEY`,
the bootstrap reads it from the user's existing interactive bash/zsh
environment over a **dedicated file descriptor** (`>&3`) whose output is
discarded. The key is passed to the backend in remote process memory. It is not
written to the connector log, not included in the `DSH_SSH_READY` record, and
not copied from the local machine. No shell configuration file is modified.

## Security model

- **Host verification is never relaxed.** SSH always runs with
  `StrictHostKeyChecking=yes`, `BatchMode=yes`, `PermitLocalCommand=no`,
  `RemoteCommand=none`, `ControlMaster=no` and `ControlPath=none`.
- **The gateway is loopback-only** and bound to an ephemeral port. It requires
  both a matching `Host` header and a random per-connection secret delivered as
  an `HttpOnly; SameSite=Strict` cookie via a one-time `?sshAuth=` redirect.
  Requests with a cross-site `Origin` or `sec-fetch-site: cross-site` are
  rejected with `403`.
- **Remote secrets stay upstream.** The remote dsh token and remote session
  cookie exist only in local backend memory. `set-cookie` is stripped from
  responses, `authorization` is removed on the way upstream, and upstream
  `location` headers are rewritten so the remote authority never reaches the
  browser.
- **No silent local execution.** A detached gateway returns `503`; the client
  shows a waiting state. Mutations are never replayed automatically.
- **Remote targets are validated** against a strict alias/`user@host` pattern
  before any process is spawned, and passed after `--`, so a saved host cannot
  inject SSH options or shell commands.
- **The remote host is not modified beyond the connector directory.** Projects
  are not uploaded, `~/.ssh/config` is not edited, and the local model
  credentials are not copied.

## Limitations

- **Linux remote hosts only.** macOS and Windows remote hosts are unverified;
  the probe rejects them.
- **Exact-version coupling.** The connector installs and accepts only remote dsh
  `0.2.1-rc.2`. Local runtime versions are listed in the compatibility section;
  future Desktop versions require checking the native browser interface again.
- **No remote stop button.** Disconnecting is local-only by design; stopping the
  backend requires inspecting `endpoint.json` for the recorded PIDs on the
  remote host.
- **Not a pure front-end extension.** The plugin needs the local dsh backend
  running, and that backend must stay bound to loopback.
- **No service persistence.** The remote supervisor is a user process with no
  promise of restarting after a machine reboot.
- **No task migration.** The unified sidebar and text references do not move
  tasks or manage per-host system services.
- **Version-specific layout integration.** The gateway adapts selected remote
  UI modules to hide the duplicated sidebar and add navigation. Changes to
  official services or bundle structure require compatibility verification.

### Verification status

Windows Desktop `0.2.1-rc.2` and a real Linux SSH host have been used to verify
the shared sidebar, existing remote conversations, clipboard links and history
reads in both directions. Both models correctly returned a random phrase stored
only in the other host's disposable test conversation, using four and six actual
tool pages respectively. Prompt text remained unchanged. The 26 automated tests
cover native component/store reuse, routing, cleanup, history pagination, reference failures,
combined bundle transforms and connector regressions.
Separate Linux supervisor and upgrade tests remain available.
See [HANDOFF.md](HANDOFF.md) for detailed verification evidence.

## Porting to another DSH version

The target version is pinned in a few places. For a different dsh release,
update all of them and re-run `npm run check`:

| File | What to change |
|---|---|
| `src/remote-bootstrap.cjs` | `const VERSION = '0.2.1-rc.2'` (remote backend) |
| `src/tunnel.js` | the `endpoint.version !== '0.2.1-rc.2'` compatibility check (remote backend) |
| `package.json` | `engines.dsh` (local client support), and the `description` if it names a version |
| `src/guest-integration.js`, `src/unified-client.js` | Layout bundle structure, workspace/session services and prompt API |
| `test/helpers.js` | the fake endpoint `version` |
| `test/manager.test.js` | the `bootstrapCommand()` assertion on the embedded version |
| `test/supervisor.integration.js` | the `runtime/<version>/node_modules` path |

## Development

```sh
npm ci          # install locked dependencies
npm run build   # regenerate lib/ from src/
npm test        # local loopback required; no internet access
npm run check   # build + test, what CI runs
```

`lib/` is committed because the Cordis loader imports it directly; always
rebuild and commit it with your changes. See [CONTRIBUTING.md](CONTRIBUTING.md)
for the test matrix, manual verification steps and the code layout.

## License and credits

Apache-2.0. See [LICENSE](LICENSE).

The SSH config discovery and SOCKS forwarding modules derive from
[Yan-Zero/dsh-remote-ssh](https://github.com/Yan-Zero/dsh-remote-ssh)
(Apache-2.0); the original TypeScript sources are retained under
`src/upstream-*.ts` with their original comments. See [NOTICE](NOTICE).
