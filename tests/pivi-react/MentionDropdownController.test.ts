import { MentionDropdownController } from '@/ui/shared/mention/MentionDropdownController';

describe('MentionDropdownController folder labels', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    HTMLElement.prototype.scrollIntoView = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.replaceChildren();
  });

  it('omits the redundant @ in the dropdown but keeps it in the inserted token', () => {
    const container = document.body.createDiv();
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.value = '@not';
    input.selectionStart = input.selectionEnd = input.value.length;
    const controller = new MentionDropdownController(container, input, {
      onAttachFile: jest.fn(),
      getMentionedMcpServers: () => new Set(),
      setMentionedMcpServers: () => false,
      addMentionedMcpServer: jest.fn(),
      getExternalContexts: () => [],
      getCachedVaultFolders: () => [{ name: 'notes', path: 'notes' }],
      getCachedVaultFiles: () => [],
      normalizePathForVault: (path) => path ?? null,
    });

    controller.handleInputChange();
    jest.advanceTimersByTime(200);

    expect(container.querySelector('.pivi-mention-name-folder')).toHaveTextContent('notes/');
    expect(container.querySelector('.pivi-mention-name-folder')).not.toHaveTextContent('@notes/');

    expect(controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(true);
    expect(input.value).toBe('@notes/ ');
    controller.destroy();
  });
});
