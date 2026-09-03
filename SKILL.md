---
name: wechat-codex-bridge
description: 在个人微信中受限地调用本机 Codex CLI；支持微信扫码、文字和附件、会话续接与显式文件回传。
---

# WeChat Codex Bridge

通过 iLink Bot API 将微信中发给 Bot 的消息交给本机 Codex 处理。

## 安全规则

- 只允许扫码绑定者消息；不得把 Bot 开放给其他联系人。
- 仅使用配置的工作目录与 `workspace-write` sandbox。
- 不得修改为 `danger-full-access` 或绕过审批。
- 只允许 `/send` 发送工作目录中的明确文件。

## 操作

首次使用：`npm run setup`，扫码并确认专用工作目录。

守护进程：`npm run daemon -- start|stop|restart|status|logs`。
