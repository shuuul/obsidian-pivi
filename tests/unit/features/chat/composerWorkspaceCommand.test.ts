import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';

import { resolveComposerWorkspaceCommand } from '@/ui/chat/composer/ComposerWorkspaceCommand';

const reviewCommand: SlashCatalogEntry = {
  id: 'review',
  kind: 'command',
  name: 'review',
  description: 'Review selected text',
  content: 'Review this:\n{{selected_text}}\nFile: {{current_note_name}}',
  scope: 'workspace',
  source: 'user',
  isEditable: true,
  isDeletable: true,
  displayPrefix: '/',
  insertPrefix: '/',
};

describe('resolveComposerWorkspaceCommand', () => {
  it('expands the runtime prompt while leaving surrounding composer text intact', async () => {
    const result = await resolveComposerWorkspaceCommand(
      '/review focus on naming',
      [reviewCommand],
      async () => ({
        selectedText: 'const value = 1;',
        currentNote: '# Example',
        currentNoteName: 'example',
        date: '7/15/2026',
      }),
    );

    expect(result).toEqual({
      promptContent: 'Review this:\nconst value = 1;\nFile: example focus on naming',
      missingSelectedText: false,
    });
  });

  it('does not read command context for plain text and reports a missing required selection', async () => {
    const getContext = jest.fn(async () => ({
      selectedText: '',
      currentNote: '',
      currentNoteName: '',
      date: '7/15/2026',
    }));

    await expect(resolveComposerWorkspaceCommand('plain text', [reviewCommand], getContext))
      .resolves.toEqual({ promptContent: 'plain text', missingSelectedText: false });
    expect(getContext).not.toHaveBeenCalled();

    await expect(resolveComposerWorkspaceCommand('/review', [reviewCommand], getContext))
      .resolves.toEqual({
        promptContent: 'Review this:\n\nFile: ',
        missingSelectedText: true,
      });
  });
});
