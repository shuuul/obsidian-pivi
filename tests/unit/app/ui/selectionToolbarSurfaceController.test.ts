/** @jest-environment jsdom */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { SelectionToolbarSurfaceController } from '@/app/ui/selectionToolbar/SelectionToolbarSurfaceController';
import type { InlineEditSurfaceSendPayload } from '@/app/ui/inlineEditSurface/types';
import type { EditorSelectionSnapshot } from '@/ui/shared/selectionToolbar/types';

const submitInlineEditTurn = jest.fn();
const showSelectionHighlight = jest.fn();
const hideSelectionHighlight = jest.fn();
const mockHostOnShow = jest.fn();
const mockHostOnDismiss = jest.fn();

jest.mock('@/app/editorSelectionToolbarRegistration', () => ({
  getSelectionToolbarHost: () => ({
    onShow: mockHostOnShow,
    onDismiss: mockHostOnDismiss,
    getOverlayElement: () => document.body,
    repositionOverlay: jest.fn(),
    dismissOverlay: jest.fn(),
    hideOverlayPreservingSnapshot: jest.fn(),
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
  buildInlineEditTurnContent: jest.fn(() => 'turn-content'),
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

function createController(): SelectionToolbarSurfaceController {
  const plugin = {
    app: {
      workspace: {
        getActiveViewOfType: jest.fn(() => null),
      },
    },
    settings: {
      chatViewPlacement: 'right',
      editorSelectionToolbar: { shortcuts: [] },
      model: 'test-model',
      thinkingLevel: 'off',
    },
    manifest: { id: 'pivi' },
    ensureWorkspaceServices: jest.fn(async () => ({})),
    register: jest.fn(),
    getUiFacades: jest.fn(),
  };

  return new SelectionToolbarSurfaceController(plugin as never);
}

describe('SelectionToolbarSurfaceController inline edit guards', () => {
  let editor: EditorView;
  let snapshot: EditorSelectionSnapshot;

  beforeEach(() => {
    jest.clearAllMocks();
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
});
