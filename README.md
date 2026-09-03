# WeChat Codex Bridge

在个人微信里给本机的 OpenAI Codex CLI 派活，结果发回微信。

人不在电脑前的时候，微信是最顺手的入口。这个桥只轮询**扫码绑定者**发给 Bot 的消息，交给本机 `codex` 执行，再把结果回复到同一个对话。它**不读取你的普通微信聊天记录**。

## 这个项目的来历

改编自 [Wechat-ggGitHub/wechat-claude-code](https://github.com/Wechat-ggGitHub/wechat-claude-code)（微信接 Claude Code），MIT 协议。本项目复用了它的微信 iLink 消息层，把执行侧整个换成 Codex CLI，并收紧了权限边界：

- 用 `codex exec --json` 替换原有的 Claude runner，自行解析 Codex 的 JSONL 事件流
- 执行固定在单一工作目录 + `workspace-write` sandbox
- 移除远程切换工作目录的能力
- 移除"从模型回复中自动识别并回传本机文件"的行为

原作者的版权声明保留在 `LICENSE` 中。

## 安全边界

这是一个**能在你电脑上执行命令、入口在公网**的服务。以下限制是有意为之，请不要在自己的部署里放开：

- **只认扫码绑定的那个账号**。每条消息都会核对 `from_user_id`，不匹配直接丢弃。
- **Codex 固定以 `workspace-write` sandbox 在一个专用工作目录内运行**。
- **微信端不能切换工作目录**。`/cwd` 不接受远程路径。
- **不使用** `--dangerously-bypass-approvals-and-sandbox`。
- **不会自动回传文件**。模型回复里提到某个文件不会触发上传；只有显式的 `/send <相对路径>` 才发送，且路径必须落在工作目录内——`../` 越界和指向目录外的软链接都会被拒绝。单文件上限 25 MiB。

## 前置条件

- Node.js 22+
- 已安装并登录 `codex` CLI
- macOS 或 Linux，以及一个个人微信账号

模型：本机实测可稳定使用 `gpt-5.5`，为默认值。`gpt-5.6-terra` 需要更新的 Codex CLI，升级后可在微信里 `/model gpt-5.6-terra` 切换。

## 安装与启动

```bash
git clone https://github.com/Mindse-Tt/wechat-codex-bridge.git ~/Documents/wechat-codex-bridge
cd ~/Documents/wechat-codex-bridge
npm ci
npm run build
npm run setup
npm run daemon -- start
```

`npm run setup` 会弹出二维码，用**你自己的**微信扫描确认，然后填入一个专用工作目录，例如 `~/Documents/wechat-codex-workspace`。这个目录会成为 Codex 唯一能读写的地方，建议新建一个空目录，不要指向你的主目录或代码仓库。

## 微信命令

| 命令 | 作用 |
|---|---|
| `/help` | 查看命令 |
| `/status` | 当前 Codex thread、模型、工作目录 |
| `/clear` | 新开会话 |
| `/compact` | 下条消息新开 Codex thread |
| `/stop` | 终止当前任务并清空排队消息 |
| `/model <名称>` | 设置当前会话模型 |
| `/skills` | 列出可用的 Codex skills |
| `/send <相对路径>` | 把工作目录内的文件发回微信 |

直接发文字、图片、文件或语音即可派活。图片和文件会先下载到工作目录下的 `.wechat-inbox/`，再交给 Codex 读取。

## 运行管理

```bash
npm run daemon -- status
npm run daemon -- logs
npm run daemon -- restart
npm run daemon -- stop
```

## 已知限制

- **电脑必须开机联网**。合盖睡眠时收不到消息，这是本地执行的代价。
- **续聊时不能重传 sandbox 参数**。`codex exec resume` 不接受 `--sandbox` / `--cd`，会继承首轮 thread 的配置——这也是为什么首轮的目录和权限必须一次设对。
- 单条回复超过 4000 字会被分片发送。

## 本地状态

运行状态存放在 `~/.wechat-codex-bridge/`，包含**微信凭据**、会话、日志和配置。不要提交、不要分享、不要放进备份公开的位置。

## License

MIT。见 [LICENSE](./LICENSE)。
