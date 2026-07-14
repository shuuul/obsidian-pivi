import { appI18n } from '@/app/i18n';
import { MentionDropdownController } from '@/ui/shared/mention/MentionDropdownController';

describe('MentionDropdownController folder labels', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    appI18n.setLocale('en');
    HTMLElement.prototype.scrollIntoView = jest.fn();
  });

  afterEach(() => {
    appI18n.setLocale('en');
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

  it('closes the dropdown on Escape without consuming unrelated keys', () => {
    const container = document.body.createDiv();
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.value = '@no';
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
    expect(controller.isVisible()).toBe(true);

    expect(controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(true);
    expect(controller.isVisible()).toBe(false);
    expect(controller.handleKeydown(new KeyboardEvent('keydown', { key: 'a' }))).toBe(false);
    controller.destroy();
  });

  it('ignores Enter while IME composition is active', () => {
    const container = document.body.createDiv();
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.value = '@no';
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
    expect(controller.isVisible()).toBe(true);

    expect(controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))).toBe(false);
    expect(input.value).toBe('@no');
    expect(controller.isVisible()).toBe(true);
    controller.destroy();
  });

  it('syncs MCP mentions from composer text through the provider hooks', () => {
    const container = document.body.createDiv();
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    const mentioned = new Set<string>();
    const onMcpMentionChange = jest.fn();
    const controller = new MentionDropdownController(container, input, {
      onAttachFile: jest.fn(),
      onMcpMentionChange,
      getMentionedMcpServers: () => mentioned,
      setMentionedMcpServers: (next) => {
        mentioned.clear();
        for (const name of next) mentioned.add(name);
        return true;
      },
      addMentionedMcpServer: (name) => mentioned.add(name),
      getExternalContexts: () => [],
      getCachedVaultFolders: () => [],
      getCachedVaultFiles: () => [],
      normalizePathForVault: (path) => path ?? null,
    });
    controller.setMcpManager({
      getContextSavingServers: () => [{ name: 'remote' }],
    });

    controller.updateMcpMentionsFromText('please use /remote for this');

    expect(mentioned).toEqual(new Set(['remote']));
    expect(onMcpMentionChange).toHaveBeenCalledWith(new Set(['remote']));
    controller.destroy();
  });

  it('localizes the empty state', () => {
    appI18n.setLocale('zh-CN');
    const container = document.body.createDiv();
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.value = '@missing';
    input.selectionStart = input.selectionEnd = input.value.length;
    const controller = new MentionDropdownController(container, input, {
      onAttachFile: jest.fn(),
      getMentionedMcpServers: () => new Set(),
      setMentionedMcpServers: () => false,
      addMentionedMcpServer: jest.fn(),
      getExternalContexts: () => [],
      getCachedVaultFolders: () => [],
      getCachedVaultFiles: () => [],
      normalizePathForVault: (path) => path ?? null,
    });

    controller.handleInputChange();
    jest.advanceTimersByTime(200);

    expect(container.querySelector('.pivi-mention-empty')).toHaveTextContent('没有匹配项');
    controller.destroy();
  });
});
