# Progress

## Completed

- Replaced the upstream Claude runner with `codex exec --json` and thread resume support.
- Added a Codex JSONL parser compatible with the locally verified CLI event format.
- Restricted execution to one workspace using `workspace-write`.
- Blocked remote working-directory changes and workspace-escaping `/send` paths, including symlinks.
- Added seven tests; type check, build, tests, and daemon status command passed on 2026-08-24.

## Current state

The daemon is not running and no WeChat QR pairing has been performed in this adaptation.
