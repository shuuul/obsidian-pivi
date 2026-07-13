import { getActiveDocument, getActiveWindow } from '@/ui/shared/dom';

describe('popout-safe DOM helpers', () => {
  const fallbackDocument = {} as Document;
  const fallbackWindow = {} as Window;

  beforeAll(() => {
    Object.defineProperties(globalThis, {
      activeDocument: { configurable: true, value: fallbackDocument },
      activeWindow: { configurable: true, value: fallbackWindow },
    });
  });

  afterAll(() => {
    Reflect.deleteProperty(globalThis, 'activeDocument');
    Reflect.deleteProperty(globalThis, 'activeWindow');
  });

  it('resolves the owner document and its window for an element', () => {
    const ownerWindow = {} as Window;
    const ownerDocument = { defaultView: ownerWindow } as Document;
    const element = { ownerDocument } as HTMLElement;

    expect(getActiveDocument(element)).toBe(ownerDocument);
    expect(getActiveWindow(element)).toBe(ownerWindow);
  });

  it('falls back to the active globals without an owning element', () => {
    expect(getActiveDocument()).toBe(fallbackDocument);
    expect(getActiveDocument(null)).toBe(fallbackDocument);
    expect(getActiveWindow()).toBe(fallbackWindow);
    expect(getActiveWindow(null)).toBe(fallbackWindow);
  });

  it('falls back to the active window when the owner document has no view', () => {
    const element = { ownerDocument: { defaultView: null } } as unknown as HTMLElement;

    expect(getActiveWindow(element)).toBe(fallbackWindow);
  });
});
