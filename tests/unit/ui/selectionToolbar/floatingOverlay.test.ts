import { createFloatingOverlay } from '@/ui/shared/selectionToolbar/floatingOverlay';

interface TestDocumentListener {
  type: string;
  listener: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
}

function createTestDocument(): {
  document: Document;
  body: HTMLElement;
  listeners: TestDocumentListener[];
} {
  const listeners: TestDocumentListener[] = [];
  const body = {
    appendChild(element: HTMLElement) {
      return element;
    },
  } as unknown as HTMLElement;

  const document = {
    body,
    documentElement: {} as HTMLElement,
    activeElement: null as Element | null,
    win: {
      createDiv({ cls }: { cls?: string } = {}) {
        const classNames = new Set((cls ?? '').split(/\s+/).filter(Boolean));
        const element = {
          className: cls ?? '',
          classList: {
            add(...names: string[]) {
              for (const name of names) classNames.add(name);
              element.className = [...classNames].join(' ');
            },
            remove(...names: string[]) {
              for (const name of names) classNames.delete(name);
              element.className = [...classNames].join(' ');
            },
          },
          parentNode: body,
          contains(node: Node) {
            return node === element;
          },
          remove() {
            // no-op
          },
          addClass(name: string) {
            element.classList.add(name);
          },
          removeClass(name: string) {
            element.classList.remove(name);
          },
          setCssProps(props: Record<string, string>) {
            Object.assign(element, props);
          },
        } as unknown as HTMLElement;
        return element;
      },
    },
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      listeners.push({ type, listener, options });
    },
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      const index = listeners.findIndex((entry) => (
        entry.type === type && entry.listener === listener && entry.options === options
      ));
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
  } as unknown as Document;

  return { document, body, listeners };
}

function dispatch(
  listeners: TestDocumentListener[],
  type: string,
  event: Event,
): void {
  for (const entry of listeners) {
    if (entry.type !== type) {
      continue;
    }
    if (typeof entry.listener === 'function') {
      entry.listener(event);
    } else {
      entry.listener.handleEvent(event);
    }
  }
}

describe('createFloatingOverlay', () => {
  it('bumps generation on each show', () => {
    const { document } = createTestDocument();
    const overlay = createFloatingOverlay({
      ownerDocument: document,
      className: 'pivi-selection-toolbar-overlay',
    });

    expect(overlay.generation).toBe(0);
    overlay.show();
    expect(overlay.generation).toBe(1);
    overlay.show();
    expect(overlay.generation).toBe(2);
    overlay.destroy();
  });

  it('dismisses on Escape and notifies the caller', () => {
    const { document, listeners } = createTestDocument();
    const onDismiss = jest.fn();
    const overlay = createFloatingOverlay({
      ownerDocument: document,
      className: 'pivi-selection-toolbar-overlay',
      onDismiss,
    });

    overlay.show();
    dispatch(listeners, 'keydown', {
      key: 'Escape',
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    } as unknown as KeyboardEvent);

    expect(onDismiss).toHaveBeenCalledWith('escape');
    expect(overlay.element.className).toContain('pivi-selection-toolbar-overlay--hidden');
    overlay.destroy();
  });

  it('dismisses on pointerdown outside the overlay', () => {
    const { document, listeners } = createTestDocument();
    const onDismiss = jest.fn();
    const overlay = createFloatingOverlay({
      ownerDocument: document,
      className: 'pivi-selection-toolbar-overlay',
      onDismiss,
    });

    overlay.show();
    dispatch(listeners, 'pointerdown', {
      target: document.body,
    } as unknown as PointerEvent);

    expect(onDismiss).toHaveBeenCalledWith('pointer-outside');
    overlay.destroy();
  });

  it('removes listeners on destroy', () => {
    const { document, listeners } = createTestDocument();
    const overlay = createFloatingOverlay({
      ownerDocument: document,
      className: 'pivi-selection-toolbar-overlay',
    });

    overlay.destroy();
    expect(listeners).toHaveLength(0);
  });
});
