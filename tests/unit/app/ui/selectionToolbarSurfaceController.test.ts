/** @jest-environment jsdom */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { mountSelectionToolbarSurface } from '@pivi/pivi-react/mount';

import { SelectionToolbarSurfaceController } from '@/app/ui/selectionToolbar/SelectionToolbarSurfaceController';
import type { InlineEditSurfaceSendPayload } from '@/app/ui/inlineEditSurface/types';
import type { EditorSelectionSnapshot } from '@/ui/shared/selectionToolbar/types';

const submitInlineEditTurn = jest.fn();
const buildInlineEditTurnContent = jest.fn((
  _prompt: string,
  _selectedText: string,
  _contextFiles: readonly unknown[],
) => 'turn-content');
const showSelectionHighlight = jest.fn();
const hideSelectionHighlight = jest.fn();
const mockHostOnShow = jest.fn();
const mockHostOnDismiss = jest.fn();
const mockGetCurrentSnapshot = jest.fn<EditorSelectionSnapshot | null, []>(() => null);
const mockDismissOverlay = jest.fn();
const mockCaptureEditorSelectionSnapshot = jest.fn<EditorSelectionSnapshot | null, [unknown]>(() => null);

jest.mock('@/ui/shared/selectionToolbar/selectionToolbarPlugin', () => ({
  captureEditorSelectionSnapshot: (editor: unknown) => mockCaptureEditorSelectionSnapshot(editor),
}));

jest.mock('@/app/editorSelectionToolbarRegistration', () => ({
  getSelectionToolbarHost: () => ({
    onShow: mockHostOnShow,
    onDismiss: mockHostOnDismiss,
    getOverlayElement: () => document.body,
    repositionOverlay: jest.fn(),
    dismissOverlay: mockDismissOverlay,
    hideOverlayPreservingSnapshot: jest.fn(),
    getCurrentSnapshot: () => mockGetCurrentSnapshot(),
  }),
}));

jest.mock('@/app/piviViewActivation', () => ({
  ensurePiviViewOpen: jest.fn(async () => ({
    getChatHandle: () => ({
      commands: {
        submitInlineEditTurn,
      },
    }),
  })),
}));

jest.mock('@/ui/shared/components/SelectionHighlight', () => ({
  showSelectionHighlight: (...args: unknown[]) => showSelectionHighlight(...args),
  hideSelectionHighlight: (...args: unknown[]) => hideSelectionHighlight(...args),
}));

jest.mock('@/app/ui/inlineEditHelpers', () => ({
  buildInlineEditTurnContent: (
    prompt: string,
    selectedText: string,
    contextFiles: readonly unknown[],
  ) => buildInlineEditTurnContent(prompt, selectedText, contextFiles),
}));

jest.mock('@pivi/pivi-react/mount', () => ({
  mountSelectionToolbarSurface: jest.fn(() => ({
    update: jest.fn(),
    dispose: jest.fn(async () => undefined),
  })),
}));

jest.mock('obsidian', () => ({
  MarkdownView: class MarkdownView {},
  Notice: class Notice {},
}));

const showInlineEditSession = jest.fn();
const setPromptInlineEditSession = jest.fn();
jest.mock('@/app/ui/inlineEditSurface', () => ({
  InlineEditSurfaceSession: jest.fn().mockImplementation(() => ({
    id: `inline-edit-mock-${Math.random()}`,
    show: showInlineEditSession,
    setPrompt: setPromptInlineEditSession,
    isDestroyed: jest.fn(() => false),
    destroy: jest.fn(),
    setStreaming: jest.fn(),
    setReplyText: jest.fn(),
    showError: jest.fn(),
    showDiffReview: jest.fn(),
  })),
}));

jest.mock('@/app/ui/obsidianPresentationPlatform', () => ({
  obsidianPresentationPlatform: {},
}));

jest.mock('@/app/i18n', () => ({
  appI18n: {},
  t: (key: string) => key,
}));

type MockSession = {
  id: string;
  setStreaming: jest.Mock;
  setReplyText: jest.Mock;
  showError: jest.Mock;
  showDiffReview: jest.Mock;
  isDestroyed: jest.Mock;
  destroy: jest.Mock;
};

type TestRecord = {
  snapshot: EditorSelectionSnapshot;
  session: MockSession;
  turnInFlight: boolean;
  cancel: (() => void) | null;
  attempt: number;
};

function createSnapshot(editor: EditorView): EditorSelectionSnapshot {
  const line = editor.state.doc.line(1);
  return {
    from: line.from,
    to: line.to,
    text: editor.state.sliceDoc(line.from, line.to),
    rect: { top: 0, bottom: 10, left: 0, right: 10 },
    editorView: editor,
  };
}

function createMockSession(): MockSession {
  return {
    id: `test-${Math.random()}`,
    setStreaming: jest.fn(),
    setReplyText: jest.fn(),
    showError: jest.fn(),
    showDiffReview: jest.fn(),
    isDestroyed: jest.fn(() => false),
    destroy: jest.fn(),
  };
}

function installRecord(controller: SelectionToolbarSurfaceController, snapshot: EditorSelectionSnapshot, session: MockSession): TestRecord {
  const record = { snapshot, session, turnInFlight: false, cancel: null, attempt: 0 };
  const sessions = (controller as unknown as { inlineEditSessions: Map<string, typeof record> }).inlineEditSessions;
  sessions.set(session.id, record);
  return record;
}

function createPayload(): InlineEditSurfaceSendPayload {
  return {
    prompt: 'rewrite this',
    contextFiles: [],
    model: 'test-model',
    thinkingLevel: 'off',
  };
}

function createController({
  shortcuts = [],
  activeView = null,
  workspace = {},
  executeCommandById = jest.fn(() => true),
}: {
  shortcuts?: unknown[];
  activeView?: unknown;
  workspace?: unknown;
  executeCommandById?: jest.Mock;
} = {}): SelectionToolbarSurfaceController {
  const plugin = {
    app: {
      workspace: {
        getActiveViewOfType: jest.fn(() => activeView),
        getLeavesOfType: jest.fn(() => activeView ? [{ view: activeView }] : []),
      },
      commands: { executeCommandById },
      vault: { read: jest.fn(async () => 'the full note') },
    },
    settings: {
      chatViewPlacement: 'right',
      editorSelectionToolbar: { shortcuts },
      model: 'test-model',
      thinkingLevel: 'off',
    },
    manifest: { id: 'pivi' },
    addEditorSelectionToChatInput: jest.fn(async () => undefined),
    ensureWorkspaceServices: jest.fn(async () => workspace),
    register: jest.fn(),
    getUiFacades: jest.fn(() => ({
      getSettingsSnapshot: (settings: { model: string; thinkingLevel: string }) => settings,
      chatUIConfig: {
        getModelOptions: () => [{ value: 'test-model', label: 'Test' }],
        getReasoningOptions: () => [{ value: 'off', label: 'Off' }],
        isAdaptiveReasoningModel: () => false,
        getDefaultReasoningValue: () => 'off',
      },
    })),
  };

  return new SelectionToolbarSurfaceController(plugin as never);
}

describe('SelectionToolbarSurfaceController inline edit guards', () => {
  let editor: EditorView;
  let snapshot: EditorSelectionSnapshot;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentSnapshot.mockReturnValue(null);
    showInlineEditSession.mockClear();
    setPromptInlineEditSession.mockClear();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    editor = new EditorView({
      state: EditorState.create({ doc: 'selected text' }),
      parent,
    });
    snapshot = createSnapshot(editor);
  });

  afterEach(() => {
    editor.destroy();
    document.body.innerHTML = '';
  });

  it('ignores late submitInlineEditTurn completion after the active session changes', async () => {
    let resolveSubmit: (value: { assistantText: string }) => void = () => undefined;
    submitInlineEditTurn.mockImplementation(() => new Promise((resolve) => {
      resolveSubmit = resolve;
    }));

    const controller = createController();
    const staleSession = createMockSession();
    const nextSession = createMockSession();

    const staleRecord = installRecord(controller, snapshot, staleSession);

    const runPromise = (controller as unknown as {
      runInlineEditTurn: (
        record: TestRecord,
        payload: InlineEditSurfaceSendPayload,
      ) => Promise<void>;
    }).runInlineEditTurn(staleRecord, createPayload());

    (controller as unknown as { inlineEditSessions: Map<string, unknown> }).inlineEditSessions.delete(staleSession.id);
    installRecord(controller, snapshot, nextSession);

    resolveSubmit({ assistantText: '<replacement>updated</replacement>' });
    await runPromise;

    expect(staleSession.setStreaming).toHaveBeenCalledWith(true);
    expect(staleSession.setStreaming).not.toHaveBeenCalledWith(false);
    expect(staleSession.showDiffReview).not.toHaveBeenCalled();
    expect(staleSession.showError).not.toHaveBeenCalled();
    expect(showSelectionHighlight).not.toHaveBeenCalled();
    expect(hideSelectionHighlight).not.toHaveBeenCalled();
  });

  it('does not stream reply text after the session is destroyed', async () => {
    let onAssistantText: ((text: string) => void) | undefined;
    let resolveSubmit: (value: { assistantText: string }) => void = () => undefined;
    submitInlineEditTurn.mockImplementation((params: { onAssistantText?: (text: string) => void }) => {
      onAssistantText = params.onAssistantText;
      return new Promise((resolve) => {
        resolveSubmit = resolve;
      });
    });

    const controller = createController();
    const session = createMockSession();
    const record = installRecord(controller, snapshot, session);

    const runPromise = (controller as unknown as {
      runInlineEditTurn: (
        record: TestRecord,
        payload: InlineEditSurfaceSendPayload,
      ) => Promise<void>;
    }).runInlineEditTurn(record, createPayload());

    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (submitInlineEditTurn.mock.calls.length > 0) {
          resolve();
          return;
        }
        setTimeout(check, 0);
      };
      check();
    });
    session.setReplyText.mockClear();

    (controller as unknown as { inlineEditSessions: Map<string, unknown> }).inlineEditSessions.delete(session.id);
    session.isDestroyed.mockReturnValue(true);
    onAssistantText?.('<replacement>partial');

    expect(session.setReplyText).not.toHaveBeenCalled();

    resolveSubmit({ assistantText: 'done' });
    await runPromise;
  });

  it('ignores duplicate send while a turn is already in flight', async () => {
    let resolveSubmit: (value: { assistantText: string }) => void = () => undefined;
    submitInlineEditTurn.mockImplementation(() => new Promise((resolve) => {
      resolveSubmit = resolve;
    }));

    const controller = createController();
    const session = createMockSession();
    const record = installRecord(controller, snapshot, session);

    const controllerWithTurn = controller as unknown as {
      runInlineEditTurn: (
        record: TestRecord,
        payload: InlineEditSurfaceSendPayload,
      ) => Promise<void>;
    };

    const firstRun = controllerWithTurn.runInlineEditTurn(record, createPayload());
    const secondRun = controllerWithTurn.runInlineEditTurn(record, createPayload());

    expect(session.setStreaming).toHaveBeenCalledTimes(1);

    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (submitInlineEditTurn.mock.calls.length > 0) {
          resolve();
          return;
        }
        setTimeout(check, 0);
      };
      check();
    });
    resolveSubmit({ assistantText: 'plain clarification reply' });
    await Promise.all([firstRun, secondRun]);

    expect(submitInlineEditTurn).toHaveBeenCalledTimes(1);
  });

  it('preserves all inline sessions when the toolbar shows or dismisses', () => {
    const controller = createController();
    const firstSession = createMockSession();
    const secondSession = createMockSession();
    installRecord(controller, snapshot, firstSession);
    installRecord(controller, snapshot, secondSession);
    controller.register();

    const onShow = mockHostOnShow.mock.calls[0]?.[0] as
      | ((nextSnapshot: EditorSelectionSnapshot) => void)
      | undefined;
    const onDismiss = mockHostOnDismiss.mock.calls[0]?.[0] as (() => void) | undefined;
    onShow?.(snapshot);
    onDismiss?.();

    expect(firstSession.destroy).not.toHaveBeenCalled();
    expect(secondSession.destroy).not.toHaveBeenCalled();
    expect((controller as unknown as {
      inlineEditSessions: Map<string, unknown>;
    }).inlineEditSessions.size).toBe(2);
  });

  it('closes only the requested inline session', () => {
    const controller = createController();
    const firstSession = createMockSession();
    const secondSession = createMockSession();
    const firstRecord = installRecord(controller, snapshot, firstSession);
    installRecord(controller, snapshot, secondSession);

    (controller as unknown as {
      dismissRecord: (record: TestRecord) => void;
    }).dismissRecord(firstRecord);

    expect(firstSession.destroy).toHaveBeenCalledTimes(1);
    expect(secondSession.destroy).not.toHaveBeenCalled();
    const sessions = (controller as unknown as {
      inlineEditSessions: Map<string, unknown>;
    }).inlineEditSessions;
    expect(sessions.has(firstSession.id)).toBe(false);
    expect(sessions.has(secondSession.id)).toBe(true);
  });

  it('opens an inline edit session from the host snapshot when controller snapshot was cleared', () => {
    const controller = createController({ shortcuts: [{
      id: 'inline-edit', kind: 'pivi-action', actionId: 'inline-edit', enabled: true,
    }] });
    controller.register();
    mockGetCurrentSnapshot.mockReturnValue(snapshot);
    (controller as unknown as { currentSnapshot: EditorSelectionSnapshot | null }).currentSnapshot = null;

    (controller as unknown as { buildProps: () => { onItem: (id: string) => void } })
      .buildProps().onItem('inline-edit');

    expect(mockDismissOverlay).toHaveBeenCalledTimes(1);
    expect(showInlineEditSession).toHaveBeenCalledWith(snapshot);
    expect((controller as unknown as {
      inlineEditSessions: Map<string, unknown>;
    }).inlineEditSessions.size).toBe(1);
  });

  it('opens inline edit from the editor command selection snapshot', () => {
    const controller = createController();
    const editor = {};
    mockCaptureEditorSelectionSnapshot.mockReturnValueOnce(snapshot);

    expect(controller.openInlineEditForSelection(editor as never)).toBe(true);

    expect(mockCaptureEditorSelectionSnapshot).toHaveBeenCalledWith(editor);
    expect(showInlineEditSession).toHaveBeenCalledWith(snapshot);
  });

  it('dispatches curated editor commands by exact ID and ignores unknown item IDs', async () => {
    const executeCommandById = jest.fn(() => true);
    const controller = createController({
      shortcuts: [
        { id: 'editor:toggle-bold', kind: 'editor-command', commandId: 'editor:toggle-bold', enabled: true },
        { id: 'editor:toggle-italics', kind: 'editor-command', commandId: 'editor:toggle-italics', enabled: true },
      ],
      executeCommandById,
    });

    const onItem = (controller as unknown as {
      buildProps: () => { onItem: (id: string) => void };
    }).buildProps().onItem;
    onItem('editor:toggle-bold');
    onItem('editor:toggle-italics');
    onItem('missing');

    expect(executeCommandById.mock.calls).toEqual([
      ['editor:toggle-bold'],
      ['editor:toggle-italics'],
    ]);
  });

  it('dispatches Add to chat through the active editor path', async () => {
    const activeView = { editor: {}, file: { basename: 'Current note' } };
    const controller = createController({
      activeView,
      shortcuts: [{
        id: 'add-to-chat', kind: 'pivi-action', actionId: 'add-to-chat', enabled: true,
      }],
    });

    (controller as unknown as { buildProps: () => { onItem: (id: string) => void } })
      .buildProps().onItem('add-to-chat');
    await Promise.resolve();

    const plugin = (controller as unknown as {
      plugin: { addEditorSelectionToChatInput: jest.Mock };
    }).plugin;
    expect(plugin.addEditorSelectionToChatInput).toHaveBeenCalledWith(activeView.editor, activeView);
  });

  it('builds the floating toolbar in enabled persisted order only', () => {
    const controller = createController({ shortcuts: [
      { id: 'add-to-chat', kind: 'pivi-action', actionId: 'add-to-chat', enabled: true },
      { id: 'editor:toggle-bold', kind: 'editor-command', commandId: 'editor:toggle-bold', enabled: false },
      { id: 'inline-edit', kind: 'pivi-action', actionId: 'inline-edit', enabled: true },
    ] });

    const props = (controller as unknown as { buildProps: () => { items: Array<{ id: string }> } }).buildProps();
    expect(props.items.map(item => item.id)).toEqual(['add-to-chat', 'inline-edit']);
  });

  it('dismisses instead of mounting when every persisted item is disabled', () => {
    const controller = createController({ shortcuts: [{
      id: 'inline-edit', kind: 'pivi-action', actionId: 'inline-edit', enabled: false,
    }] });

    (controller as unknown as { render: () => void }).render();

    expect(mockDismissOverlay).toHaveBeenCalledTimes(1);
    expect(mountSelectionToolbarSurface).not.toHaveBeenCalled();
  });

  it('no-ops Ask AI when neither controller nor host has a snapshot', () => {
    const controller = createController();
    controller.register();
    mockGetCurrentSnapshot.mockReturnValue(null);
    (controller as unknown as { currentSnapshot: EditorSelectionSnapshot | null }).currentSnapshot = null;

    (controller as unknown as { openInlineEdit: (prefill?: string) => void }).openInlineEdit();

    expect(mockDismissOverlay).not.toHaveBeenCalled();
    expect(showInlineEditSession).not.toHaveBeenCalled();
    expect((controller as unknown as {
      inlineEditSessions: Map<string, unknown>;
    }).inlineEditSessions.size).toBe(0);
  });

  it('keeps sidebar Pivi shortcuts on the registered workspace command path', async () => {
    const executeCommandById = jest.fn(() => true);
    const controller = createController({
      shortcuts: [{
        id: 'sidebar-command',
        kind: 'pivi-command',
        label: '/summarize',
        enabled: true,
        piviCommandKey: 'stable-key',
        executionTarget: 'sidebar',
      }],
      executeCommandById,
    });
    (controller as unknown as { currentSnapshot: EditorSelectionSnapshot | null }).currentSnapshot = snapshot;

    await (controller as unknown as { handleShortcut: (id: string) => Promise<void> })
      .handleShortcut('sidebar-command');

    expect(executeCommandById).toHaveBeenCalledWith('pivi:workspace-command-stable-key');
    expect(showInlineEditSession).not.toHaveBeenCalled();
  });

  it('runs an inline Pivi shortcut by stable key and injects selected text only through the canonical block', async () => {
    submitInlineEditTurn.mockResolvedValue({ assistantText: '<replacement>updated</replacement>' });
    const MarkdownView = (jest.requireMock('obsidian') as { MarkdownView: new () => {
      editor?: unknown;
      file?: unknown;
    } }).MarkdownView;
    const originatingView = new MarkdownView();
    const originatingEditor = {};
    originatingView.editor = originatingEditor;
    originatingView.file = { basename: 'Current note' };
    snapshot.editor = originatingEditor as never;
    const controller = createController({
      shortcuts: [{
        id: 'inline-command',
        kind: 'pivi-command',
        label: '/renamed-command',
        enabled: true,
        piviCommandKey: 'stable-key',
        executionTarget: 'inline-edit',
      }],
      activeView: originatingView,
      workspace: {
        slashCommandCatalog: {
          listWorkspaceEntries: jest.fn(async () => [{
            kind: 'command',
            integrationKey: 'stable-key',
            name: 'new-name',
            content: 'Rewrite {{selected_text}} from {{current_note_name}}: {{current_note}}',
          }]),
        },
      },
    });
    (controller as unknown as { currentSnapshot: EditorSelectionSnapshot | null }).currentSnapshot = snapshot;

    await (controller as unknown as { handleShortcut: (id: string) => Promise<void> })
      .handleShortcut('inline-command');

    expect(showInlineEditSession).toHaveBeenCalledWith(snapshot);
    expect(buildInlineEditTurnContent).toHaveBeenCalledWith(
      'Rewrite  from Current note: the full note',
      'selected text',
      [],
    );
    expect(submitInlineEditTurn).toHaveBeenCalledTimes(1);
    expect(setPromptInlineEditSession).toHaveBeenCalledWith('Rewrite  from Current note: the full note');
  });
});
