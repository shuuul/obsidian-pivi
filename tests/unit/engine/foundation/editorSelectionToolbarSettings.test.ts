import { normalizeEditorSelectionToolbarSettings } from '@pivi/pivi-agent-core/foundation/settings';
import { DEFAULT_PIVI_SETTINGS } from '@pivi/pivi-agent-core/foundation/settingsDefaults';

const required = [
  { id: 'inline-edit', kind: 'pivi-action', actionId: 'inline-edit', enabled: true },
  { id: 'add-to-chat', kind: 'pivi-action', actionId: 'add-to-chat', enabled: true },
];

describe('normalizeEditorSelectionToolbarSettings', () => {
  it('repairs missing and malformed settings with required actions', () => {
    for (const value of [undefined, null, 'invalid', { shortcuts: 'invalid' }]) {
      expect(normalizeEditorSelectionToolbarSettings(value)).toEqual({ enabled: true, shortcuts: required });
    }
  });

  it('preserves legacy provider mapping', () => {
    expect(normalizeEditorSelectionToolbarSettings({ provider: 'off', shortcuts: [] }).enabled).toBe(false);
    expect(normalizeEditorSelectionToolbarSettings({ provider: 'pivi', shortcuts: [] }).enabled).toBe(true);
    expect(normalizeEditorSelectionToolbarSettings({ provider: 'note-toolbar', shortcuts: [] }).enabled).toBe(true);
    expect(normalizeEditorSelectionToolbarSettings({ enabled: false, provider: 'pivi', shortcuts: [] }).enabled).toBe(false);
  });

  it('maps curated legacy commands and retains unmatched arbitrary commands', () => {
    expect(normalizeEditorSelectionToolbarSettings({ shortcuts: [
      { id: 'bold-old', kind: 'obsidian-command', label: 'Forged', enabled: false, commandId: 'editor:toggle-bold', icon: 'forged' },
      { id: 'arbitrary', kind: 'obsidian-command', label: ' Plugin action ', enabled: true, commandId: 'plugin:action', icon: ' star ' },
    ] }).shortcuts).toEqual([
      ...required,
      { id: 'editor:toggle-bold', kind: 'editor-command', commandId: 'editor:toggle-bold', enabled: false },
      { id: 'arbitrary', kind: 'obsidian-command', label: 'Plugin action', commandId: 'plugin:action', icon: 'star', enabled: true },
    ]);
  });

  it('drops malformed records while preserving valid Pivi command sidebar fallback', () => {
    expect(normalizeEditorSelectionToolbarSettings({ shortcuts: [
      null,
      { id: 'bad', kind: 'obsidian-command', label: '', commandId: '' },
      { id: 'pivi', kind: 'pivi-command', label: '/summarize', piviCommandKey: ' stable ', enabled: false, executionTarget: 'bad' },
    ] }).shortcuts).toEqual([
      ...required,
      { id: 'pivi', kind: 'pivi-command', label: '/summarize', piviCommandKey: 'stable', enabled: false, executionTarget: 'sidebar' },
    ]);
  });

  it('repairs one missing required action in one canonical insertion pass', () => {
    expect(normalizeEditorSelectionToolbarSettings({ shortcuts: [required[1]] }).shortcuts).toEqual(required);
  });

  it('deduplicates canonical actions and editor commands', () => {
    const result = normalizeEditorSelectionToolbarSettings({ shortcuts: [
      { ...required[0], id: 'forged' },
      { ...required[0], enabled: false },
      { id: 'first', kind: 'editor-command', commandId: 'editor:toggle-bold', enabled: false },
      { id: 'second', kind: 'obsidian-command', commandId: 'editor:toggle-bold', label: 'Bold', enabled: true },
    ] });
    expect(result.shortcuts).toEqual([
      required[1],
      required[0],
      { id: 'editor:toggle-bold', kind: 'editor-command', commandId: 'editor:toggle-bold', enabled: false },
    ]);
  });

  it('remaps legacy IDs that collide with reserved and emitted IDs without dropping rows', () => {
    const result = normalizeEditorSelectionToolbarSettings({ shortcuts: [
      { id: 'inline-edit', kind: 'obsidian-command', label: 'One', commandId: 'plugin:one', enabled: true },
      { id: 'same', kind: 'obsidian-command', label: 'Two', commandId: 'plugin:two', enabled: true },
      { id: 'same', kind: 'pivi-command', label: '/three', piviCommandKey: 'three', enabled: true },
      { id: 'editor:toggle-bold', kind: 'pivi-command', label: '/four', piviCommandKey: 'four', enabled: true },
    ] });
    expect(result.shortcuts.map(item => item.id)).toEqual([
      'inline-edit', 'add-to-chat',
      'legacy:obsidian-command:inline-edit', 'same', 'legacy:pivi-command:same',
      'legacy:pivi-command:editor:toggle-bold',
    ]);
    expect(new Set(result.shortcuts.map(item => item.id)).size).toBe(result.shortcuts.length);
  });

  it('is stable on second normalization', () => {
    const once = normalizeEditorSelectionToolbarSettings({ shortcuts: [
      { id: 'inline-edit', kind: 'obsidian-command', label: 'One', commandId: 'plugin:one', enabled: true },
      { id: 'same', kind: 'pivi-command', label: '/one', piviCommandKey: 'one', enabled: true },
      { id: 'same', kind: 'pivi-command', label: '/two', piviCommandKey: 'two', enabled: false },
    ] });
    expect(normalizeEditorSelectionToolbarSettings(once)).toEqual(once);
  });

  it('uses normalized required actions as defaults', () => {
    expect(DEFAULT_PIVI_SETTINGS.editorSelectionToolbar).toEqual(normalizeEditorSelectionToolbarSettings(undefined));
  });
});
