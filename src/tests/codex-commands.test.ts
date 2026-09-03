import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { routeCommand } from '../commands/router.js';
import type { Session } from '../session.js';

function context(text: string, workingDirectory = '/tmp/workspace') {
  const session: Session = { workingDirectory, state: 'idle', chatHistory: [] };
  return {
    accountId: 'account',
    session,
    text,
    updateSession: (partial: Partial<Session>) => Object.assign(session, partial),
    clearSession: () => session,
  };
}

test('微信端不能把 Codex 切换到任意工作目录', () => {
  const result = routeCommand(context('/cwd /tmp/elsewhere') as never);
  assert.equal(result.handled, true);
  assert.match(result.reply ?? '', /不能切换工作目录/);
});

test('模型命令只保存本会话的 Codex 模型选择', () => {
  const command = context('/model gpt-5.6-terra');
  const result = routeCommand(command as never);
  assert.equal(result.handled, true);
  assert.equal(command.session.model, 'gpt-5.6-terra');
});

test('文件回传仅允许受限工作目录中的相对路径', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'wechat-codex-command-'));
  const outsideDirectory = mkdtempSync(join(tmpdir(), 'wechat-codex-outside-'));
  writeFileSync(join(workspace, 'report.txt'), 'ok');
  writeFileSync(join(outsideDirectory, 'secret.txt'), 'secret');
  symlinkSync(join(outsideDirectory, 'secret.txt'), join(workspace, 'linked-secret.txt'));
  const inside = routeCommand(context('/send report.txt', workspace) as never);
  const outside = routeCommand(context(`/send ${join(outsideDirectory, 'secret.txt')}`, workspace) as never);
  const symlink = routeCommand(context('/send linked-secret.txt', workspace) as never);

  assert.equal(inside.sendFile, realpathSync(join(workspace, 'report.txt')));
  assert.match(outside.reply ?? '', /只能发送受限工作目录/);
  assert.match(symlink.reply ?? '', /只能发送受限工作目录/);
});
