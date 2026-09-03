import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { logger } from '../logger.js';

export interface CodexQueryOptions {
  prompt: string;
  cwd: string;
  resume?: string;
  model?: string;
  imagePaths?: string[];
  onProgress?: (text: string) => Promise<void> | void;
  abortController?: AbortController;
}

export interface CodexQueryResult {
  text: string;
  threadId: string;
  error?: string;
}

export type CodexEvent =
  | { type: 'thread'; threadId: string }
  | { type: 'delta'; text: string }
  | { type: 'progress'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }
  | { type: 'ignored' };

export function buildCodexArgs(options: Pick<CodexQueryOptions, 'prompt' | 'cwd' | 'resume' | 'model' | 'imagePaths'>): string[] {
  const args = options.resume ? ['exec', 'resume', '--json'] : ['exec', '--json', '--sandbox', 'workspace-write', '--cd', options.cwd];
  args.push('--skip-git-repo-check');
  if (options.model) args.push('--model', options.model);
  for (const imagePath of options.imagePaths ?? []) args.push('--image', imagePath);
  if (options.resume) args.push(options.resume);
  args.push('-');
  return args;
}

export function parseCodexEvent(line: string): CodexEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { type: 'ignored' };
  }
  if (!value || typeof value !== 'object') return { type: 'ignored' };
  const event = value as Record<string, unknown>;
  const type = stringValue(event.type);
  const method = typeof event.method === 'string' ? event.method : '';
  const params = asRecord(event.params);
  const item = asRecord(params?.item);

  // Codex CLI JSONL format (0.132.0 and newer).
  if (type === 'thread.started') {
    const threadId = stringValue(event.thread_id);
    return threadId ? { type: 'thread', threadId } : { type: 'ignored' };
  }
  if (type === 'item.completed') {
    const completedItem = asRecord(event.item);
    const itemType = stringValue(completedItem?.type);
    const text = stringValue(completedItem?.text);
    if (itemType === 'agent_message' && text) return { type: 'final', text };
  }
  if (type === 'error') {
    const message = stringValue(event.message);
    return message ? { type: 'error', message } : { type: 'ignored' };
  }
  if (type === 'turn.failed') {
    const error = asRecord(event.error);
    const message = stringValue(error?.message);
    return message ? { type: 'error', message } : { type: 'ignored' };
  }

  // Compatibility with the app-server event shape used by older Codex releases.
  if (method === 'thread/started') {
    const thread = asRecord(params?.thread);
    const threadId = stringValue(thread?.id) ?? stringValue(params?.threadId);
    return threadId ? { type: 'thread', threadId } : { type: 'ignored' };
  }
  if (method === 'item/agentMessage/delta') {
    const text = stringValue(params?.delta);
    return text ? { type: 'delta', text } : { type: 'ignored' };
  }
  if (method === 'item/completed' && item?.type === 'agentMessage') {
    const text = stringValue(item.text);
    if (!text) return { type: 'ignored' };
    return item.phase === 'commentary' ? { type: 'progress', text } : { type: 'final', text };
  }
  return { type: 'ignored' };
}

export async function codexQuery(options: CodexQueryOptions): Promise<CodexQueryResult> {
  const args = buildCodexArgs(options);
  logger.info('Starting Codex query', { cwd: options.cwd, model: options.model, resume: Boolean(options.resume) });
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn('codex', args, { cwd: options.cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error: unknown) {
      resolve({ text: '', threadId: '', error: errorMessage('无法启动 Codex', error) });
      return;
    }

    let threadId = options.resume ?? '';
    let finalText = '';
    let eventError = '';
    const stderr: string[] = [];
    const progress = new Set<string>();
    const finish = (error?: string): void => resolve({ text: finalText.trim(), threadId, error });
    const onAbort = (): void => { child.kill('SIGTERM'); };
    options.abortController?.signal.addEventListener('abort', onAbort, { once: true });

    child.stdin?.end(options.prompt);
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => stderr.push(chunk));
    const lines = createInterface({ input: child.stdout! });
    lines.on('line', (line) => {
      const event = parseCodexEvent(line);
      if (event.type === 'thread') threadId = event.threadId;
      if (event.type === 'final') finalText = event.text;
      if (event.type === 'error') eventError = event.message;
      if (event.type === 'progress' && !progress.has(event.text)) {
        progress.add(event.text);
        void Promise.resolve(options.onProgress?.(event.text)).catch(() => undefined);
      }
    });
    child.once('error', (error) => {
      options.abortController?.signal.removeEventListener('abort', onAbort);
      finish(errorMessage('Codex 进程异常', error));
    });
    child.once('close', (code) => {
      options.abortController?.signal.removeEventListener('abort', onAbort);
      if (options.abortController?.signal.aborted) return finish();
      if (eventError) return finish(eventError);
      if (code === 0) return finish(finalText.trim() ? undefined : 'Codex 未返回最终消息。');
      const detail = stderr.join('').trim();
      finish(eventError || detail || `Codex 退出，状态码 ${code ?? '未知'}。`);
    });
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function errorMessage(prefix: string, error: unknown): string {
  return `${prefix}: ${error instanceof Error ? error.message : String(error)}`;
}
