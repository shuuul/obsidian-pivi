import {
  DEFAULT_PIVI_SETTINGS,
} from '@pivi/pivi-agent-core/foundation/settingsDefaults';
import {
  normalizeEditorSelectionToolbarSettings,
} from '@pivi/pivi-agent-core/foundation/settings';

describe('normalizeEditorSelectionToolbarSettings', () => {
  it('returns an enabled toolbar with an empty shortcut list for missing or invalid values', () => {
    expect(normalizeEditorSelectionToolbarSettings(undefined)).toEqual({ enabled: true, shortcuts: [] });
    expect(normalizeEditorSelectionToolbarSettings(null)).toEqual({ enabled: true, shortcuts: [] });
    expect(normalizeEditorSelectionToolbarSettings('invalid')).toEqual({ enabled: true, shortcuts: [] });
    expect(normalizeEditorSelectionToolbarSettings({ shortcuts: 'invalid' })).toEqual({
      enabled: true,
      shortcuts: [],
    });
  });

  it('normalizes valid host and Pivi command shortcuts and drops invalid entries', () => {
    expect(normalizeEditorSelectionToolbarSettings({
      enabled: true,
      shortcuts: [
        {
          id: 'cmd-1',
          kind: 'obsidian-command',
          label: ' Toggle fold ',
          enabled: true,
          commandId: 'editor:toggle-fold',
          icon: ' fold-vertical ',
        },
        {
          id: 'cmd-1',
          kind: 'obsidian-command',
          label: 'Duplicate',
          enabled: true,
          commandId: 'editor:duplicate',
        },
        {
          id: 'pivi-1',
          kind: 'pivi-command',
          label: '/summarize',
          enabled: false,
          piviCommandKey: 'abc-key',
          icon: 'scan-text',
          executionTarget: 'invalid',
        },
        {
          id: 'bad-pivi',
          kind: 'pivi-command',
          label: 'Missing key',
          enabled: true,
        },
        {
          id: 'legacy-preset',
          kind: 'preset-prompt',
          label: 'Summarize',
          enabled: true,
          prompt: 'Summarize the selection.',
        },
        {
          id: 'bad-command',
          kind: 'obsidian-command',
          label: 'Missing command id',
          enabled: true,
        },
      ],
    })).toEqual({
      enabled: true,
      shortcuts: [
        {
          id: 'cmd-1',
          kind: 'obsidian-command',
          label: 'Toggle fold',
          enabled: true,
          commandId: 'editor:toggle-fold',
          icon: 'fold-vertical',
        },
        {
          id: 'pivi-1',
          kind: 'pivi-command',
          label: '/summarize',
          enabled: false,
          piviCommandKey: 'abc-key',
          executionTarget: 'sidebar',
          icon: 'scan-text',
        },
      ],
    });
  });

  it('accepts an explicit enabled boolean', () => {
    expect(normalizeEditorSelectionToolbarSettings({
      enabled: false,
      shortcuts: [],
    })).toEqual({ enabled: false, shortcuts: [] });
    expect(normalizeEditorSelectionToolbarSettings({
      enabled: true,
      shortcuts: [],
    })).toEqual({ enabled: true, shortcuts: [] });
  });

  it('maps legacy provider field for backward compatibility', () => {
    expect(normalizeEditorSelectionToolbarSettings({
      provider: 'pivi',
      shortcuts: [],
    })).toEqual({ enabled: true, shortcuts: [] });
    expect(normalizeEditorSelectionToolbarSettings({
      provider: 'note-toolbar',
      shortcuts: [],
    })).toEqual({ enabled: true, shortcuts: [] });
    expect(normalizeEditorSelectionToolbarSettings({
      provider: 'off',
      shortcuts: [],
    })).toEqual({ enabled: false, shortcuts: [] });
  });

  it('defaults unknown legacy providers to enabled', () => {
    expect(normalizeEditorSelectionToolbarSettings({
      provider: 'other',
      shortcuts: [],
    })).toEqual({ enabled: true, shortcuts: [] });
  });

  it('prefers the enabled field over the legacy provider field', () => {
    expect(normalizeEditorSelectionToolbarSettings({
      enabled: false,
      provider: 'pivi',
      shortcuts: [],
    })).toEqual({ enabled: false, shortcuts: [] });
  });

  it('is included in default Pivi settings', () => {
    expect(DEFAULT_PIVI_SETTINGS.editorSelectionToolbar).toEqual({
      enabled: true,
      shortcuts: [],
    });
  });
});
