import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCodexArgs, parseCodexEvent } from '../codex/provider.js';

test('new Codex turn is restricted to the configured workspace', () => {
  const args = buildCodexArgs({
    prompt: '总结工作目录中的 README',
    cwd: '/tmp/workspace',
    model: 'gpt-5.6-terra',
  });

  assert.deepEqual(args, [
    'exec', '--json', '--sandbox', 'workspace-write', '--cd', '/tmp/workspace',
    '--skip-git-repo-check', '--model', 'gpt-5.6-terra', '-',
  ]);
  assert.equal(args.includes('--dangerously-bypass-approvals-and-sandbox'), false);
});

test('resumed Codex turn uses the persisted Codex thread id', () => {
  const args = buildCodexArgs({
    prompt: '继续并给出结果',
    cwd: '/tmp/workspace',
    resume: 'thread_123',
  });

  assert.deepEqual(args, [
    'exec', 'resume', '--json', '--skip-git-repo-check', 'thread_123', '-',
  ]);
  assert.equal(args.includes('--sandbox'), false);
  assert.equal(args.includes('--cd'), false);
});

test('Codex JSONL events yield a thread id and final message', () => {
  assert.deepEqual(
    parseCodexEvent('{"type":"thread.started","thread_id":"thread_123"}'),
    { type: 'thread', threadId: 'thread_123' },
  );
  assert.deepEqual(
    parseCodexEvent('{"type":"item.completed","item":{"type":"agent_message","text":"完成"}}'),
    { type: 'final', text: '完成' },
  );
  assert.deepEqual(
    parseCodexEvent('{"type":"turn.failed","error":{"message":"模型不可用"}}'),
    { type: 'error', message: '模型不可用' },
  );
});

test('older app-server events remain compatible', () => {
  assert.deepEqual(
    parseCodexEvent('{"method":"item/agentMessage/delta","params":{"delta":"处理中"}}'),
    { type: 'delta', text: '处理中' },
  );
  assert.deepEqual(
    parseCodexEvent('{"method":"item/completed","params":{"item":{"type":"agentMessage","text":"完成"}}}'),
    { type: 'final', text: '完成' },
  );
});
