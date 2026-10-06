# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`0.1.2` is the first version published as a standalone repository. The plugin
code is unchanged from the `0.1.2` build; only packaging, manifests and
documentation were adapted for redistribution.

## [0.1.2]

### Fixed

- Reuse the remote host's existing `DSH_HOME` (defaulting to `~/.dsh`) instead
  of pointing the remote backend at a private connector state directory. A
  fresh connector state produced an empty profile, so remote credentials,
  workspaces and conversation history appeared to be missing.
- Refuse to reuse an `endpoint.json` that does not declare the expected
  `dataHome`, so reconnecting cannot silently attach to a stale empty backend.
  Existing old state directories are neither migrated nor deleted.
- On Linux, when the non-interactive SSH environment has no
  `DEEPSEEK_API_KEY`, read the value from the user's existing interactive
  bash/zsh environment over a dedicated file descriptor. The key stays in
  remote process memory: it is not written to the connector log, not returned
  over SSH, and not copied from the local machine. Shell configuration is not
  modified.

## [0.1.1]

### Added

- Desktop (Electron) support: the remote page is rendered in a sandboxed,
  non-persistent native `WebContentsView` with its own session, no Node
  integration and no remote preload. The capability bridge is exposed only to
  the top-level application window.
- Gateway authentication for the native view, and hide/re-show reuse so the
  remote page survives switching away.

### Changed

- Windows: the native view is offset below the custom titlebar so window
  controls remain usable.

## [0.1.0]

### Added

- SSH host management: discovery of concrete `Host` aliases from the OpenSSH
  user config (including recursive `Include` expansion) plus manually saved
  `user@host` entries, with an optional port.
- Read-only host detection reporting OS, architecture, Node.js, npm and
  `base64` availability without creating anything on the remote host.
- One persistent remote dsh backend per host, started by an uploaded bootstrap
  supervisor that outlives the SSH session.
- A single OpenSSH dynamic SOCKS channel per connection, plus a per-host
  loopback gateway that terminates browser authentication and rewrites
  authority, origin and cookie headers.
- Client UI on the public `sidebar.footer.action`, `settings.section` and
  `shell.overlay` slots: host picker, status, connection progress, disconnect
  and automatic reconnect.

[0.1.2]: https://github.com/feng-spinning/dsh-remote-modern/releases/tag/v0.1.2
[0.1.1]: https://github.com/feng-spinning/dsh-remote-modern/releases/tag/v0.1.1
[0.1.0]: https://github.com/feng-spinning/dsh-remote-modern/releases/tag/v0.1.0
