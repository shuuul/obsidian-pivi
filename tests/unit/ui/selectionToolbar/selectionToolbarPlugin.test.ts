import { EditorState } from '@codemirror/state';
import type { PluginValue, ViewUpdate } from '@codemirror/view';

import {
  createSelectionToolbarPluginClass,
  refreshSelectionToolbarViews,
  resetSelectionToolbarViews,
  type SelectionToolbarPluginHandlers,
} from '@/ui/shared/selectionToolbar/selectionToolbarPlugin';

function createHandlers(
  overrides: Partial<SelectionToolbarPluginHandlers> = {},
): SelectionToolbarPluginHandlers {
  return {
    onSelection: jest.fn(),
    onSelectionCleared: jest.fn(),
    getInteractionState: () => ({
      isPointerDown: false,
      isKeyboardSelection: false,
      isContextOpening: false,
    }),
    ...overrides,
  };
}

function createMockView(doc: string, from: number, to: number) {
  const state = EditorState.create({
    doc,
    selection: { anchor: from, head: to },
  });
  return {
    state,
    dom: {
      ownerDocument: {
        defaultView: window,
      },
    },
    coordsAtPos: () => ({
      top: 10,
      bottom: 20,
      left: 5,
      right: 25,
    }),
  };
}

function createUpdate(view: ReturnType<typeof createMockView>, selectionSet: boolean): ViewUpdate {
  return {
    selectionSet,
    state: view.state,
  } as ViewUpdate;
}

function runPluginUpdate(plugin: PluginValue, update: ViewUpdate): void {
  if (!plugin.update) {
    throw new Error('Expected selection toolbar plugin to implement update()');
  }
  plugin.update(update);
}

describe('createSelectionToolbarPluginClass', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'activeWindow', {
      configurable: true,
      value: window,
    });
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'activeWindow');
    jest.restoreAllMocks();
  });

  it('clears the selection when the editor selection becomes empty', () => {
    const handlers = createHandlers();
    const PluginClass = createSelectionToolbarPluginClass(handlers);
    const view = createMockView('hello', 0, 0);
    const plugin = new PluginClass(view as never);

    runPluginUpdate(plugin, createUpdate(view, true));

    expect(handlers.onSelectionCleared).toHaveBeenCalledTimes(1);
  });

  it('does not notify again for an unchanged selection', () => {
    const handlers = createHandlers();
    const PluginClass = createSelectionToolbarPluginClass(handlers);
    const view = createMockView('hello', 0, 3);
    const plugin = new PluginClass(view as never);

    runPluginUpdate(plugin, createUpdate(view, true));
    runPluginUpdate(plugin, createUpdate(view, true));

    expect(handlers.onSelection).toHaveBeenCalledTimes(1);
  });

  it('notifies again for the same selection after the toolbar surface is dismissed', () => {
    const handlers = createHandlers();
    const PluginClass = createSelectionToolbarPluginClass(handlers);
    const view = createMockView('hello', 0, 3);
    const plugin = new PluginClass(view as never);

    runPluginUpdate(plugin, createUpdate(view, true));
    resetSelectionToolbarViews();
    runPluginUpdate(plugin, createUpdate(view, true));

    expect(handlers.onSelection).toHaveBeenCalledTimes(2);
    plugin.destroy?.();
  });

  it('notifies on selectionSet after rAF with geometry', () => {
    const handlers = createHandlers();
    const PluginClass = createSelectionToolbarPluginClass(handlers);
    const view = createMockView('hello', 0, 3);
    const plugin = new PluginClass(view as never);

    runPluginUpdate(plugin, createUpdate(view, true));

    expect(handlers.onSelection).toHaveBeenCalledWith({
      from: 0,
      to: 3,
      text: 'hel',
      rect: {
        top: 10,
        bottom: 20,
        left: 5,
        right: 25,
      },
      editorView: view,
    });
  });

  it('suppresses updates while the pointer is down when configured', () => {
    const handlers = createHandlers({
      shouldSuppressForPointerDown: () => true,
    });
    const PluginClass = createSelectionToolbarPluginClass(handlers);
    const view = createMockView('hello', 0, 3);
    const plugin = new PluginClass(view as never);

    runPluginUpdate(plugin, createUpdate(view, true));

    expect(handlers.onSelection).not.toHaveBeenCalled();
    plugin.destroy?.();
  });

  it('re-checks a suppressed mouse selection when pointerup does not create a transaction', () => {
    let pointerDown = true;
    const handlers = createHandlers({
      shouldSuppressForPointerDown: () => pointerDown,
    });
    const PluginClass = createSelectionToolbarPluginClass(handlers);
    const view = createMockView('hello', 0, 3);
    const plugin = new PluginClass(view as never);

    runPluginUpdate(plugin, createUpdate(view, true));
    expect(handlers.onSelection).not.toHaveBeenCalled();

    pointerDown = false;
    refreshSelectionToolbarViews();

    expect(handlers.onSelection).toHaveBeenCalledTimes(1);
    plugin.destroy?.();
  });

  it('refreshes only editor views in the pointer event owner document', () => {
    const firstHandlers = createHandlers({ shouldSuppressForPointerDown: () => true });
    const secondHandlers = createHandlers({ shouldSuppressForPointerDown: () => true });
    const PluginClass = createSelectionToolbarPluginClass(firstHandlers);
    const OtherPluginClass = createSelectionToolbarPluginClass(secondHandlers);
    const firstView = createMockView('first', 0, 3);
    const secondView = createMockView('second', 0, 3);
    const firstDocument = firstView.dom.ownerDocument as unknown as Document;
    const otherDocument = { defaultView: window } as unknown as Document;
    Object.defineProperty(secondView.dom, 'ownerDocument', {
      configurable: true,
      value: otherDocument,
    });
    const firstPlugin = new PluginClass(firstView as never);
    const secondPlugin = new OtherPluginClass(secondView as never);

    runPluginUpdate(firstPlugin, createUpdate(firstView, true));
    runPluginUpdate(secondPlugin, createUpdate(secondView, true));
    refreshSelectionToolbarViews(firstDocument);

    expect(firstHandlers.onSelection).toHaveBeenCalledTimes(1);
    expect(secondHandlers.onSelection).not.toHaveBeenCalled();
    firstPlugin.destroy?.();
    secondPlugin.destroy?.();
  });

  it('identifies the editor view that cleared or destroyed its selection', () => {
    const handlers = createHandlers();
    const PluginClass = createSelectionToolbarPluginClass(handlers);
    const view = createMockView('hello', 0, 0);
    const plugin = new PluginClass(view as never);

    runPluginUpdate(plugin, createUpdate(view, true));
    plugin.destroy?.();

    expect(handlers.onSelectionCleared).toHaveBeenNthCalledWith(1, view);
    expect(handlers.onSelectionCleared).toHaveBeenNthCalledWith(2, view);
  });
});
