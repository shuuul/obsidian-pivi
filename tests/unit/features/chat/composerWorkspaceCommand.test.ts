import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';
import {
  createInlineContextToken,
  type InlineContextReference,
} from '@pivi/pivi-agent-core/context/inlineContext';

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
  const selectedTextContext: InlineContextReference = {
    type: 'editor-selection',
    notePath: 'example.md',
    noteName: 'example.md',
    selection: {
      from: { line: 0, ch: 0 },
      to: { line: 0, ch: 16 },
    },
    includedLines: { from: 1, to: 1 },
    text: '<selection_start>const value = 1;<selection_end>',
  };

  it('expands the runtime prompt while leaving surrounding composer text intact', async () => {
    const result = await resolveComposerWorkspaceCommand(
      '/review focus on naming',
      [reviewCommand],
      async () => ({
        selectedText: 'const value = 1;',
        selectedTextContext,
        currentNote: '# Example',
        currentNoteName: 'example',
        date: '7/15/2026',
      }),
    );

    const token = createInlineContextToken(selectedTextContext);
    expect(result).toEqual({
      displayContent: `Review this:\n${token}\nFile: example focus on naming`,
      promptContent: `Review this:\n${token}\nFile: example focus on naming`,
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
      .resolves.toEqual({
        displayContent: 'plain text',
        promptContent: 'plain text',
        missingSelectedText: false,
      });
    expect(getContext).not.toHaveBeenCalled();

    await expect(resolveComposerWorkspaceCommand('/review', [reviewCommand], getContext))
      .resolves.toEqual({
        displayContent: 'Review this:\n\nFile: ',
        promptContent: 'Review this:\n\nFile: ',
        missingSelectedText: true,
      });
  });
});
