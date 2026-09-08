import { SELECTED_TEXT_TEMPLATE_TOKEN } from '@pivi/agent/context/mentions';
import type { AuxQueryConfig, AuxQueryRunner } from '@pivi/agent/runtime/auxQueryRunner';
import type { SlashCatalogEntry } from '@pivi/agent/skills/commands/slashCommandEntry';

import {
  type PiviCliHost,
  registerPiviCli,
  runPiviCliCommand,
} from '@/app/cliRegistration';

function catalogEntry(name: string, content: string): SlashCatalogEntry {
  return {
    id: `command:${name}`,
    name,
    content,
    scope: 'workspace',
    source: 'user',
    kind: 'command',
    isEditable: true,
    isDeletable: true,
    displayPrefix: '/',
    insertPrefix: '/',
  };
}

interface RecordedQuery {
  config: AuxQueryConfig;
  prompt: string;
}

function createHost(options: {
  entries?: SlashCatalogEntry[];
  notes?: Record<string, string>;
  cliDefaultModel?: string;
  result?: string;
} = {}): { host: PiviCliHost; queries: RecordedQuery[]; runnerResets: () => number } {
  const queries: RecordedQuery[] = [];
  let runnerResets = 0;
  const result = options.result ?? 'command result';
  const runner: AuxQueryRunner = {
    query: async (config, prompt) => {
      queries.push({ config, prompt });
      return result;
    },
    reset: () => {
      runnerResets += 1;
    },
  };
  const entries = options.entries ?? [catalogEntry('summary', 'Summarize {{current_note_name}}: {{current_note}}')];
  const notes = options.notes ?? {};
  return {
    host: {
      readNote: async (file, path) => {
        const key = path ?? file ?? '';
        const content = notes[key];
        if (content === undefined) return null;
        const basename = key.split('/').pop()?.replace(/\.md$/i, '') ?? key;
        return { basename, content };
      },
      listWorkspaceEntries: async () => entries,
      createAuxQueryRunner: () => runner,
      getCliDefaultModel: () => options.cliDefaultModel ?? '',
      today: () => '2026-09-08',
    } satisfies PiviCliHost,
    queries,
    runnerResets: () => runnerResets,
  };
}

describe('runPiviCliCommand', () => {
  it('requires a command parameter', async () => {
    const { host } = createHost();
    await expect(runPiviCliCommand(host, {})).rejects.toThrow('command=');
  });

  it('reports unknown commands with available names', async () => {
    const { host } = createHost();
    await expect(runPiviCliCommand(host, { command: 'missing' }))
      .rejects.toThrow('missing');
    await expect(runPiviCliCommand(host, { command: 'missing' }))
      .rejects.toThrow('summary');
  });

  it('matches command names case-insensitively and strips the leading slash', async () => {
    const { host, queries } = createHost();
    await runPiviCliCommand(host, { command: '/Summary' });
    expect(queries).toHaveLength(1);
    expect(queries[0]!.prompt).toBe('Summarize :');
  });

  it('resolves the note, injects context variables, and forwards the model', async () => {
    const { host, queries } = createHost({
      notes: { 'Notes/Recipe.md': '# Recipe' },
    });
    await runPiviCliCommand(host, {
      command: 'summary',
      path: 'Notes/Recipe.md',
      model: 'deepseek/deepseek-chat',
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]!.prompt).toBe('Summarize Recipe: # Recipe');
    expect(queries[0]!.config.model).toBe('deepseek/deepseek-chat');
    expect(queries[0]!.config.systemPrompt).toContain('Pivi workspace command');
  });

  it('falls back to the CLI default model setting and then undefined', async () => {
    const withSetting = createHost({ cliDefaultModel: 'openai/gpt-4.1' });
    await runPiviCliCommand(withSetting.host, { command: 'summary' });
    expect(withSetting.queries[0]!.config.model).toBe('openai/gpt-4.1');

    const withoutSetting = createHost();
    await runPiviCliCommand(withoutSetting.host, { command: 'summary' });
    expect(withoutSetting.queries[0]!.config.model).toBeUndefined();
  });

  it('rejects model keys without the provider/model shape', async () => {
    const { host } = createHost();
    await expect(runPiviCliCommand(host, { command: 'summary', model: 'no-slash' }))
      .rejects.toThrow('provider/model');
  });

  it('reports unresolvable notes', async () => {
    const { host } = createHost();
    await expect(runPiviCliCommand(host, { command: 'summary', file: 'Missing' }))
      .rejects.toThrow('not found');
  });

  it('requires a selection parameter for selection commands', async () => {
    const { host } = createHost({
      entries: [catalogEntry('polish', `Polish ${SELECTED_TEXT_TEMPLATE_TOKEN}`)],
    });
    await expect(runPiviCliCommand(host, { command: 'polish' }))
      .rejects.toThrow('selection=');
    const selectionHost = createHost({
      entries: [catalogEntry('polish', `Polish ${SELECTED_TEXT_TEMPLATE_TOKEN}`)],
    });
    await runPiviCliCommand(selectionHost.host, {
      command: 'polish',
      selection: 'some text',
    });
    expect(selectionHost.queries[0]!.prompt).toBe('Polish some text');
  });

  it('caps oversized results', async () => {
    const { host } = createHost({ result: 'x'.repeat(60_000) });
    const output = await runPiviCliCommand(host, { command: 'summary' });
    expect(output.length).toBeLessThanOrEqual(50_000);
  });

  it('resets the aux runner after the query settles', async () => {
    const failing = createHost();
    jest.spyOn(failing.host, 'createAuxQueryRunner').mockImplementation(() => ({
      query: async () => {
        throw new Error('provider down');
      },
      reset: () => undefined,
    }));
    await expect(runPiviCliCommand(failing.host, { command: 'summary' }))
      .rejects.toThrow('provider down');

    const success = createHost();
    await runPiviCliCommand(success.host, { command: 'summary' });
    expect(success.runnerResets()).toBe(1);
  });
});

describe('registerPiviCli', () => {
  it('registers the pivi:run handler with declared flags', () => {
    const registrations: {
      command: string;
      description: string;
      flags: Record<string, unknown> | null;
    }[] = [];
    const plugin = {
      registerCliHandler: (
        command: string,
        description: string,
        flags: Record<string, unknown> | null,
        _handler: unknown,
      ) => {
        registrations.push({ command, description, flags });
      },
    };
    const { host } = createHost();
    registerPiviCli(plugin as never, host);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.command).toBe('pivi:run');
    expect(Object.keys(registrations[0]!.flags ?? {})).toEqual([
      'command',
      'file',
      'path',
      'model',
      'selection',
    ]);
    expect((registrations[0]!.flags?.command as { required?: boolean }).required).toBe(true);
  });
});
