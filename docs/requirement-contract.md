# 微信 Codex 桥接：需求约定

## Goal

将上游的微信到 Claude Code 桥接改为仅调用本机 Codex CLI 的桥接服务。

## Inputs

- 上游仓库 `Wechat-ggGitHub/wechat-claude-code` 的微信 iLink 消息层。
- 本机已安装的 `codex` CLI。

## Constraints

- 不调用 Claude CLI、Claude SDK 或 Anthropic API。
- 只处理扫码绑定微信账号发来的消息。
- Codex 仅在一个配置的工作目录内以 `workspace-write` sandbox 运行。
- 微信命令不得切换到任意目录。
- 禁止从模型回复中自动识别并回传任意本机文件；仅允许显式的、位于工作目录下的 `/send`。

## Assumptions

- Mac 保持开机和联网时，微信守护进程才可响应。
- 当前 Codex CLI 支持 `codex exec --json` 和 `codex exec resume`。

## Deliverable

可构建的 TypeScript 项目、单元测试、中文运行说明和 macOS daemon 管理脚本。

## Verification

- 类型检查与单元测试通过。
- 源码中不存在 Claude CLI/SDK 调用。
- 新会话命令参数固定为工作目录和 `workspace-write` sandbox；续聊由该 Codex thread 继承首次创建时的沙箱与目录。
