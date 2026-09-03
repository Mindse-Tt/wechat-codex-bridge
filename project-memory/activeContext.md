# Active Context

- The project is a local personal WeChat iLink Bot bridge for Codex CLI.
- Only the QR-bound account is processed. The active workspace is configured locally during setup.
- Do not reintroduce remote `/cwd`, unrestricted sandbox flags, or automatic file discovery/upload.

## Next manual action

Run `npm run setup`, scan the QR code with the intended personal WeChat account, then run `npm run daemon -- start`.
