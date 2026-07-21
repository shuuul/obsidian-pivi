import { EditorState } from '@codemirror/state';
import type { PluginValue, ViewUpdate } from '@codemirror/view';

import {
  createSelectionToolbarPluginClass,
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
  });
});
