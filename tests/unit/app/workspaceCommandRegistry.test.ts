const mockEnsurePiviViewOpen = jest.fn();

jest.mock('@/app/piviViewActivation', () => ({
  ensurePiviViewOpen: mockEnsurePiviViewOpen,
}));

import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';
import { extractInlineContextTokensFromMessage } from '@pivi/pivi-agent-core/context/inlineContext';
import {
  getWorkspaceCommandFullId,
  WorkspaceCommandRegistry,
} from '@/app/workspaceCommandRegistry';

const entry: SlashCatalogEntry = {
  id: 'summarize',
  kind: 'command',
  name: 'summarize',
  description: 'Summarize text',
  argumentHint: 'summarize',
  icon: 'list-collapse',
  integrationKey: 'stable-key',
  content: 'Summarize:\n\n{{selected_text}}',
  scope: 'workspace',
  source: 'user',
  isEditable: true,
  isDeletable: true,
  displayPrefix: '/',
  insertPrefix: '/',
};

function createHarness(selectedText = 'Selected text') {
  const sendWorkspaceCommandInNewSession = jest.fn(async (_content: string) => true);
  mockEnsurePiviViewOpen.mockResolvedValue({
    getChatHandle: () => ({ commands: { sendWorkspaceCommandInNewSession } }),
  });
  const ownerWindow = {
    ntb: { getSelection: () => selectedText },
    getSelection: () => ({ toString: () => selectedText }),
  };
  const markdownView = {
    containerEl: { ownerDocument: { defaultView: ownerWindow } },
    editor: {
      getSelection: () => selectedText,
      getCursor: (which: 'from' | 'to') => ({
        line: 0,
        ch: which === 'from' ? 0 : selectedText.length,
      }),
      getLine: () => selectedText,
    },
    file: { basename: 'Note', name: 'Note.md', path: 'Note.md' },
    getMode: () => 'source',
  };
  const commands: Array<{ id: string; name: string; icon?: string; callback?: () => void }> = [];
  const host = {
    app: {
      workspace: { getActiveViewOfType: () => markdownView },
      vault: { read: jest.fn(async () => 'Whole note') },
    },
    manifest: { id: 'pivi' },
    settings: { chatViewPlacement: 'right-sidebar' as const },
    addCommand: jest.fn((command) => { commands.push(command); return command; }),
    removeCommand: jest.fn(),
  };
  return {
    commands,
    host,
    registry: new WorkspaceCommandRegistry(host as never),
    sendWorkspaceCommandInNewSession,
  };
}

describe('WorkspaceCommandRegistry', () => {
  beforeEach(() => jest.clearAllMocks());

  it('registers a stable icon-bearing Obsidian command and removes it on reconcile', () => {
    const { commands, host, registry } = createHarness();

    registry.reconcile([entry]);
    registry.reconcile([{ ...entry, name: 'summary' }]);

    expect(commands[0]).toMatchObject({
      id: 'workspace-command-stable-key',
      icon: 'list-collapse',
    });
    expect(commands[1]?.id).toBe(commands[0]?.id);
    expect(host.removeCommand).toHaveBeenCalledWith(
      getWorkspaceCommandFullId('pivi', 'stable-key'),
    );
  });

  it('resolves the selected text and sends it in a new session', async () => {
    const { commands, registry, sendWorkspaceCommandInNewSession } = createHarness();
    registry.reconcile([entry]);

    commands[0]?.callback?.();
    await new Promise(resolve => setTimeout(resolve, 0));

    const sentContent = sendWorkspaceCommandInNewSession.mock.calls[0]?.[0] ?? '';
    const extracted = extractInlineContextTokensFromMessage(sentContent);
    expect(extracted.messageWithoutInlineContextTokens.trim()).toBe('Summarize:');
    expect(extracted.contexts).toEqual([
      expect.objectContaining({
        notePath: 'Note.md',
        noteName: 'Note.md',
        text: '<selection_start>Selected text<selection_end>',
      }),
    ]);
  });

  it('does not send a prompt that requires a missing selection', async () => {
    const { commands, registry, sendWorkspaceCommandInNewSession } = createHarness('');
    registry.reconcile([entry]);

    commands[0]?.callback?.();
    await Promise.resolve();

    expect(sendWorkspaceCommandInNewSession).not.toHaveBeenCalled();
  });
});
