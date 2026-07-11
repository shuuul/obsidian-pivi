type TestWindow = typeof window & {
  cancelAnimationFrame?: (handle: number) => void;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
};

const testWindow = (globalThis.window ?? globalThis) as TestWindow;

if (!globalThis.window) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: testWindow,
    writable: true,
  });
}

/** Jest uses testEnvironment: node — stub browser Image used by provider logo preload. */
if (typeof testWindow.Image === 'undefined') {
  Object.defineProperty(testWindow, 'Image', {
    configurable: true,
    writable: true,
    value: class {
      src = '';
    },
  });
}

if (!testWindow.requestAnimationFrame) {
  testWindow.requestAnimationFrame = (callback: FrameRequestCallback): number => (
    Number(globalThis.setTimeout(() => callback(Date.now()), 0))
  );
}

if (!testWindow.cancelAnimationFrame) {
  testWindow.cancelAnimationFrame = (handle: number): void => {
    globalThis.clearTimeout(handle);
  };
}

