import { spawnSync } from 'node:child_process';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { routeCommand, type CommandContext } from './commands/router.js';
import { loadConfig, saveConfig, type Config } from './config.js';
import { codexQuery } from './codex/provider.js';
import { DATA_DIR } from './constants.js';
import { logger } from './logger.js';
import { createSessionStore, type Session } from './session.js';
import { startQrLogin, waitForQrScan } from './wechat/login.js';
import { createMonitor } from './wechat/monitor.js';
import { createSender } from './wechat/send.js';
import { downloadFile, downloadImageFile, extractFirstFileItem, extractFirstImageUrl, extractText } from './wechat/media.js';
import { loadLatestAccount, type AccountData } from './wechat/accounts.js';
import { WeChatApi } from './wechat/api.js';
import { MessageType, type WeixinMessage } from './wechat/types.js';

const MAX_MESSAGE_LENGTH = 4000;

async function runSetup(): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });
  const qrPath = join(DATA_DIR, 'qrcode.png');
  while (true) {
    const { qrcodeUrl, qrcodeId } = await startQrLogin();
    const QRCode = await import('qrcode');
    writeFileSync(qrPath, await QRCode.toBuffer(qrcodeUrl, { type: 'png', width: 400, margin: 2 }));
    openFile(qrPath);
    console.log(`请用微信扫描二维码：${qrPath}`);
    try {
      await waitForQrScan(qrcodeId);
      break;
    } catch (error: unknown) {
      if (!(error instanceof Error) || !error.message.includes('expired')) throw error;
      console.log('二维码过期，正在刷新。');
    }
  }
  try { unlinkSync(qrPath); } catch { /* QR 已清理或不存在。 */ }
  const configured = loadConfig();
  const workspace = await promptUser('请输入专用 Codex 工作目录', configured.workingDirectory);
  saveConfig({ ...configured, workingDirectory: workspace.replace(/^~/, homedir()) });
  console.log('绑定成功。执行 npm run daemon -- start 启动服务。');
}

async function runDaemon(): Promise<void> {
  const config = loadConfig();
  const account = loadLatestAccount();
  if (!account) throw new Error('未找到微信绑定，请先执行 npm run setup。');
  const api = new WeChatApi(account.botToken, account.baseUrl);
  const sender = createSender(api, account.accountId);
  const sessions = createSessionStore();
  const session = sessions.load(account.accountId);
  session.workingDirectory = config.workingDirectory;
  sessions.save(account.accountId, session);
  const queue: WeixinMessage[] = [];
  let processing = false;
  let controller: AbortController | undefined;

  const drain = async (): Promise<void> => {
    if (processing) return;
    processing = true;
    while (queue.length) {
      const message = queue.shift();
      if (message) await handleMessage(message, account, session, sessions, sender, config, (next) => { controller = next; });
    }
    processing = false;
  };

  const monitor = createMonitor(api, {
    onMessage: async (message) => {
      const text = message.item_list ? extractTextFromItems(message.item_list) : '';
      if (message.message_type === MessageType.USER && text.startsWith('/stop') && controller) {
        controller.abort();
        queue.length = 0;
        await sender.sendText(message.from_user_id ?? '', message.context_token ?? '', '⏹ 已停止当前 Codex 任务。');
        return;
      }
      queue.push(message);
      void drain();
    },
    onSessionExpired: () => console.error('微信会话已过期，请重新执行 npm run setup 扫码绑定。'),
  });
  const stop = (): void => { monitor.stop(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  logger.info('Codex bridge started', { accountId: account.accountId, workspace: config.workingDirectory });
  await monitor.run();
}

async function handleMessage(
  message: WeixinMessage,
  account: AccountData,
  session: Session,
  sessions: ReturnType<typeof createSessionStore>,
  sender: ReturnType<typeof createSender>,
  config: Config,
  setController: (controller: AbortController | undefined) => void,
): Promise<void> {
  if (message.message_type !== MessageType.USER || !message.from_user_id || !message.item_list) return;
  if (account.userId && message.from_user_id !== account.userId) return;
  const fromUserId = message.from_user_id;
  const contextToken = message.context_token ?? '';
  const text = extractTextFromItems(message.item_list);

  if (text.startsWith('/')) {
    const context: CommandContext = {
      accountId: account.accountId,
      session,
      text,
      updateSession: (partial) => { Object.assign(session, partial, { workingDirectory: config.workingDirectory }); sessions.save(account.accountId, session); },
      clearSession: () => sessions.clear(account.accountId, session),
      getChatHistoryText: (limit) => sessions.getChatHistoryText(session, limit),
    };
    const result = routeCommand(context);
    if (result.reply) return sendText(sender, fromUserId, contextToken, result.reply);
    if (result.sendFile) {
      await sender.sendFile(fromUserId, contextToken, result.sendFile);
      return;
    }
    if (result.codexPrompt) {
      await runCodex(result.codexPrompt, [], fromUserId, contextToken, account, session, sessions, sender, config, setController);
    }
    return;
  }

  const imageItem = extractFirstImageUrl(message.item_list);
  const fileItem = extractFirstFileItem(message.item_list);
  if (!text && !imageItem && !fileItem) return sendText(sender, fromUserId, contextToken, '暂不支持此类型消息，请发送文字、语音、图片或文件。');
  const tempPaths: string[] = [];
  try {
    const uploadDirectory = join(config.workingDirectory, '.wechat-inbox');
    mkdirSync(uploadDirectory, { recursive: true });
    const imagePath = imageItem ? await downloadImageFile(imageItem, uploadDirectory) : null;
    if (imagePath) tempPaths.push(imagePath);
    const filePath = fileItem ? await downloadFile(fileItem, uploadDirectory) : null;
    if (filePath) tempPaths.push(filePath);
    const prompt = filePath
      ? `${text || '请分析附件。'}\n\n用户上传的文件位于：${filePath}\n请先读取文件再回答。`
      : text || '请分析这张图片。';
    await runCodex(prompt, imagePath ? [imagePath] : [], fromUserId, contextToken, account, session, sessions, sender, config, setController);
  } finally {
    for (const path of tempPaths) {
      try { unlinkSync(path); } catch { /* 临时文件已经被清理。 */ }
    }
  }
}

async function runCodex(
  userPrompt: string,
  imagePaths: string[],
  fromUserId: string,
  contextToken: string,
  account: AccountData,
  session: Session,
  sessions: ReturnType<typeof createSessionStore>,
  sender: ReturnType<typeof createSender>,
  config: Config,
  setController: (controller: AbortController | undefined) => void,
): Promise<void> {
  const controller = new AbortController();
  setController(controller);
  session.state = 'processing';
  session.workingDirectory = config.workingDirectory;
  sessions.addChatMessage(session, 'user', userPrompt);
  sessions.save(account.accountId, session);
  const stopTyping = sender.startTyping(fromUserId, contextToken);
  let lastProgress = '';
  try {
    const prompt = [
      '你正在通过微信协助用户。仅在当前工作目录中工作；不要请求、读取或发送工作目录外的文件。',
      '如需把生成文件发回微信，请告知用户使用 /send 相对路径 明确发送；不要只输出任意本机路径。',
      config.systemPrompt,
      `用户请求：\n${userPrompt}`,
    ].filter(Boolean).join('\n\n');
    const result = await codexQuery({
      prompt,
      cwd: config.workingDirectory,
      resume: session.codexThreadId,
      model: session.model ?? config.model ?? 'gpt-5.5',
      imagePaths,
      abortController: controller,
      onProgress: async (progress) => {
        const clean = progress.trim();
        if (clean && clean !== lastProgress) {
          lastProgress = clean;
          await sendText(sender, fromUserId, contextToken, `进度：${clean}`);
        }
      },
    });
    if (result.threadId) session.codexThreadId = result.threadId;
    if (result.text) {
      sessions.addChatMessage(session, 'assistant', result.text);
      await sendText(sender, fromUserId, contextToken, result.text);
    } else if (result.error && !controller.signal.aborted) {
      logger.error('Codex query failed', { error: result.error });
      await sendText(sender, fromUserId, contextToken, `Codex 处理失败：${result.error}`);
    }
  } finally {
    session.state = 'idle';
    sessions.save(account.accountId, session);
    stopTyping();
    setController(undefined);
  }
}

async function sendText(sender: ReturnType<typeof createSender>, to: string, token: string, text: string): Promise<void> {
  for (const chunk of splitMessage(text)) await sender.sendText(to, token, chunk);
}

function splitMessage(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > MAX_MESSAGE_LENGTH) {
    const index = Math.max(remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH), remaining.lastIndexOf('。', MAX_MESSAGE_LENGTH), MAX_MESSAGE_LENGTH);
    chunks.push(remaining.slice(0, index));
    remaining = remaining.slice(index).trimStart();
  }
  return remaining ? [...chunks, remaining] : chunks;
}

function extractTextFromItems(items: NonNullable<WeixinMessage['item_list']>): string {
  return items.map(extractText).filter(Boolean).join('\n');
}

function promptUser(question: string, defaultValue: string): Promise<string> {
  return new Promise((resolve) => {
    const input = createInterface({ input: process.stdin, output: process.stdout });
    input.question(`${question} [${defaultValue}]: `, (answer) => { input.close(); resolve(answer.trim() || defaultValue); });
  });
}

function openFile(path: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', path] : [path];
  const result = spawnSync(command, args, { stdio: 'ignore' });
  if (result.error) logger.warn('Unable to open QR image', { path, error: result.error.message });
}

const command = process.argv[2];
const task = command === 'setup' ? runSetup() : runDaemon();
task.catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('Bridge failed', { error: message });
  console.error(`服务失败：${message}`);
  process.exit(1);
});
