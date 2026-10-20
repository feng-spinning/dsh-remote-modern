# Contributing

Thanks for taking a look. This document covers the development setup, the
checks CI runs, and how to cut a release.

Repository: <https://github.com/feng-spinning/dsh-remote-modern>

## Releasing

1. Update `CHANGELOG.md` and bump `version` in `package.json`. If the target
   dsh release changed, also follow *Porting to another DSH version* in the
   README and update `engines.dsh`.
2. Run `npm run check` and commit the regenerated `lib/`.
3. Tag and push: `git tag v<version> && git push --follow-tags`.
4. Create the GitHub release from the tag, so the `CHANGELOG.md` comparison
   links resolve.
5. Optionally publish to npm with `npm publish`. The `files` field limits the
   tarball to `src/`, `lib/`, `assets/`, the bundle patch, both READMEs and the
   licence files. The runtime dependency `ws` is installed by the package manager.

The CI badge and the `repository`, `homepage` and `bugs` fields in
`package.json` point at the repository above; update them if the project moves.

## Development setup

Requirements: **Node.js 24 or newer** and OpenSSH on `PATH`.
Install the locked dependencies before building or testing.

```sh
npm ci
npm run build   # regenerate lib/ from src/
npm test        # unit tests (node:test)
npm run check   # build + test, what CI runs
```

### Why `lib/` is committed

The Cordis loader imports `./src/plugin.js` for the host side, and that module
imports the compiled `../lib/socks.js` and `../lib/ssh-config.js`. The web
client bundle is served from `./lib/client.js`. Both are produced from
`src/` by `scripts/build.mjs`:

- `src/upstream-socks.ts` → `lib/socks.js`
- `src/upstream-ssh-config.ts` → `lib/ssh-config.js`
- `src/client.js` → `lib/client.js`, wrapped in the platform's
  `window.__ModuleLoader__.load({...})` factory with React supplied by the host

Because the loader reads the committed files, always run `npm run build` and
commit the result. CI fails if `lib/` differs from a fresh build.

## Tests

```sh
npm test                        # test/*.test.js
node test/supervisor.integration.js   # optional, needs a real dsh CLI
```

`npm test` uses Node's built-in test runner and local loopback servers.
It does not access the internet:

| File | Covers |
|---|---|
| `test/client.test.js` | native component/store reuse without child redeclaration, global New Chat host routing, unchanged prompts and cleanup |
| `test/federation.test.js` | host-qualified IDs, actual-user filtering, bounded history, unavailable hosts and combined UI bundles |
| `test/remote-api.test.js` | authenticated HTTP/WebSocket RPC, stream cancellation and authorization without changing prompts |
| `test/session-reader.test.js` | backwards pagination, long-message continuation, skipped runtime messages and session-scoped mailbox grants |
| `test/bootstrap.test.js` | `reusableEndpoint`: only a live endpoint declaring the current version **and** data home is reused |
| `test/gateway.test.js` | gateway authentication, Host/Origin enforcement, header and cookie rewriting, WebSocket upgrade, and that a detached gateway answers `503` without replaying a mutation |
| `test/manager.test.js` | connect pooling, a stable gateway URL across reconnects, target validation before spawning, serialized host saves, disconnect cancelling an in-flight startup |
| `test/socks.test.js` | SOCKS negotiation with deliberately fragmented replies, and byte forwarding to the declared loopback port |

`test/supervisor.integration.js` is **not** part of `npm test`. It starts a
real `@deepseek-ai/dsh` CLI as the remote supervisor, so it needs that package
resolvable locally. Point `DSH_TEST_CLI_PACKAGE` at a specific install to
override the default lookup, or install the CLI globally:

```sh
DSH_TEST_CLI_PACKAGE=/path/to/node_modules/@deepseek-ai/dsh \
  node test/supervisor.integration.js
```

It verifies that the supervisor survives the attaching process exiting, that
concurrent attaches reuse one identity, and that closing the gateway leaves the
remote backend running. It cleans up its own temporary directory and processes.

## Manual verification against a real host

Neither the unit tests nor the integration test exercise a real SSH
connection. Before a release, verify by hand on a host you own:

1. `ssh <host>` once in a terminal so the host key is known and key auth works.
   The plugin runs with `BatchMode=yes` and `StrictHostKeyChecking=yes`, so it
   never prompts for a password and always verifies fingerprints.
2. In the GUI, open **远程连接 / Remote connection**, run the read-only check,
   then connect.
3. Confirm the remote workspace, sessions, files and terminal are all served by
   the remote host.
4. Disconnect and reconnect. The remote backend should survive; check
   `~/.dsh-remote-modern/endpoint.json` and `~/.dsh-remote-modern/backend.log`
   on the remote host.

`scripts/verify-remote-environment.mjs <host>` is a read-only diagnostic for
the most common remote problem — a `DEEPSEEK_API_KEY` that exists only in an
interactive shell:

```sh
node scripts/verify-remote-environment.mjs <host>
# MODEL_ENV_CHECK {"keyPresent":true}
```

`scripts/live-gateway.mjs` exercises the gateway against an already-running
loopback dsh backend without involving SSH at all.

## Code layout

| Path | Role |
|---|---|
| `src/plugin.js` | Host entry. Registers the five `sshRemote/*` API routes and owns the manager |
| `src/manager.js` | `RemoteManager`: host persistence, connection state machine, reconnect policy |
| `src/gateway.js` | Per-host loopback HTTP/WebSocket gateway and browser authentication |
| `src/tunnel.js` | SSH argument construction, read-only probe, dynamic SOCKS tunnel, bootstrap upload |
| `src/remote-bootstrap.cjs` | Uploaded to the remote host; installs/reuses a dsh CLI and owns the backend supervisor |
| `src/client.js` | Client settings, connection management and remote main pane |
| `src/native-sidebar.js` | Decorates native component seats; preserves child-slot declarations and store identity |
| `src/session-reader.js` | Fixed-cursor pagination of user/assistant text |
| `src/remote-reader.js`, `src/reader-broker.js` | Remote companion and authenticated Desktop read mailbox |
| `src/upstream-*.ts` | Upstream Apache-2.0 sources retained verbatim (see `NOTICE`) |

## Style

Match the surrounding code: 2-space indent, single quotes, no semicolon-free
lines in `src/client.js` (it is compiled as-is into the browser bundle),
`node:`-prefixed imports, and comments only where the reason is not obvious
from the code. Keep Chinese UI strings in `src/client.js` and Chinese error
messages in the host modules — they are user-facing text, not source comments.

## Pull requests

- Keep behaviour changes separate from formatting or documentation changes.
- Run `npm run check` and commit the regenerated `lib/`.
- Note in the description whether you tested against a real SSH host, and on
  which platforms. macOS remote hosts and Windows remote hosts are currently
  unverified — see the limitations section of the README.
