# Technical Context

- Runtime: Node.js, TypeScript, local `codex` CLI.
- CLI invocation: new threads use `codex exec --json --sandbox workspace-write --cd <workspace>`; resume threads do not accept `--sandbox` or `--cd` and inherit the original thread configuration.
- Local smoke test on this Mac succeeded with model `gpt-5.5` and returned `thread.started` plus `item.completed` JSONL events.
- The installed Codex CLI does not support the locally configured `gpt-5.6-terra`; update Codex before selecting that model.
