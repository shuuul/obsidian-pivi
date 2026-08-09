import {
  createSessionsTool,
  TOOL_PIVI_SESSIONS,
  type ToolSpec,
} from '@pivi/agent/tools';

function makeRecovery() {
  const read = jest.fn(async () => '## User\n\nQuestion\n\n## Agent\n\nAnswer');
  const listDeleted = jest.fn(async () => [{
    sessionFile: '.pivi/sessions/deleted.jsonl',
    deletedAt: 100,
    expiresAt: 200,
    retentionDays: 30,
  }]);
  const restore = jest.fn(async (sessionFile: string) => ({
    sessionId: 'session-1', title: 'Recovered session', sessionFile,
  }));
  return { recovery: { read, listDeleted, restore }, read, listDeleted, restore };
}

function getText(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
}

describe('createSessionsTool', () => {
  it('preserves the public ToolSpec contract', () => {
    const { recovery } = makeRecovery();
    const tool = createSessionsTool(recovery);
    expect(tool).toMatchObject({
      name: TOOL_PIVI_SESSIONS,
      label: 'Pivi Sessions',
      description: 'Read a durable Pivi session, list recoverable deleted sessions, or restore one and open it in a visible Pivi tab.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['read', 'list_deleted', 'restore'] },
          sessionFile: { type: 'string', description: 'Required for read and restore.' },
        },
        required: ['action'],
        additionalProperties: false,
      },
    });
  });

  it('reads one durable session by exact file path', async () => {
    const { recovery, read } = makeRecovery();
    const result = await createSessionsTool(recovery).execute('call-1', {
      action: 'read', sessionFile: '.pivi/sessions/active.jsonl',
    });
    expect(read).toHaveBeenCalledWith('.pivi/sessions/active.jsonl');
    expect(getText(result)).toBe('## User\n\nQuestion\n\n## Agent\n\nAnswer');
  });

  it('lists recoverable sessions with their expiry metadata', async () => {
    const { recovery, listDeleted } = makeRecovery();
    const result = await createSessionsTool(recovery).execute('call-1', { action: 'list_deleted' });
    expect(listDeleted).toHaveBeenCalledTimes(1);
    expect(JSON.parse(getText(result))).toEqual({ sessions: [{
      sessionFile: '.pivi/sessions/deleted.jsonl', deletedAt: 100, expiresAt: 200, retentionDays: 30,
    }] });
  });

  it('restores one queued session by exact file path', async () => {
    const { recovery, restore } = makeRecovery();
    const result = await createSessionsTool(recovery).execute('call-1', {
      action: 'restore', sessionFile: '.pivi/sessions/deleted.jsonl',
    });
    expect(restore).toHaveBeenCalledWith('.pivi/sessions/deleted.jsonl');
    expect(JSON.parse(getText(result))).toMatchObject({ sessionId: 'session-1', title: 'Recovered session' });
  });

  it('rejects an invalid action or a restore without sessionFile', async () => {
    const { recovery } = makeRecovery();
    const tool: ToolSpec = createSessionsTool(recovery);
    await expect(tool.execute('call-1', { action: 'unknown' })).rejects.toThrow('Invalid sessions action');
    await expect(tool.execute('call-2', { action: 'restore' })).rejects.toThrow('sessionFile is required');
  });
});
