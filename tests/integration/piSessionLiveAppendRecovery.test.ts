import { spawnSync } from 'node:child_process';

describe('production session append recovery', () => {
  it('persists and reopens a complete turn across metadata-only file changes', () => {
    const script = String.raw`
      import fs from 'node:fs';
      import os from 'node:os';
      import path from 'node:path';
      import { PiSessionStore } from '@pivi/pivi-agent-core/engine/pi/session/piSessionStore';
      import { SessionTreeStore } from '@pivi/pivi-agent-core/engine/pi/session/sessionTreeStore';

      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-live-append-recovery-'));
      try {
        const tree = SessionTreeStore.create(root);
        const userId = tree.appendUserMessage('Inspect notes');
        tree.appendMessageUi({
          targetEntryId: userId,
          displayContent: '/tests',
          turnRequest: {
            text: 'Inspect notes',
            currentNotePath: 'A.md',
            attachedFilePaths: ['A.md', 'B.md'],
          },
        });
        const sessionFile = tree.getVaultRelativeSessionFile();
        if (!sessionFile) throw new Error('Persistent session file was not created');
        const absolute = path.join(root, sessionFile);
        const before = fs.statSync(absolute, { bigint: true });
        fs.chmodSync(absolute, Number(before.mode) ^ 0o100);

        tree.syncAgentMessages([
          { role: 'user', content: 'Inspect notes', timestamp: 1 },
          {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'call-1', name: 'read', arguments: {} }],
            timestamp: 2,
          },
          {
            role: 'toolResult',
            toolCallId: 'call-1',
            toolName: 'read',
            content: [{ type: 'text', text: 'body' }],
            isError: false,
            timestamp: 3,
          },
          { role: 'assistant', content: [{ type: 'text', text: 'Done' }], timestamp: 4 },
        ]);

        const store = new PiSessionStore({ exists: async () => false }, root);
        const page = await store.openRecent({
          sessionFile,
          sessionId: tree.getSessionId(),
        }, 20);
        const assistant = page.messages.at(-1);
        console.log(JSON.stringify({
          roles: page.messages.map(message => message.role),
          displayContent: page.messages[0]?.displayContent,
          attachedFilePaths: page.messages[0]?.turnRequest?.attachedFilePaths,
          toolStatus: assistant?.toolCalls?.[0]?.status,
          toolResult: assistant?.toolCalls?.[0]?.result,
          final: assistant?.content,
        }));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    `;

    const result = spawnSync(process.execPath, [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      script,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production' },
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      roles: ['user', 'assistant'],
      displayContent: '/tests',
      attachedFilePaths: ['A.md', 'B.md'],
      toolStatus: 'completed',
      toolResult: 'body',
      final: 'Done',
    });
  });
});
