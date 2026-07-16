import { createDisclosureViewportController } from '../../packages/pivi-react/src/chat/messages/disclosureViewport';

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];

  readonly observed = new Set<Element>();
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  disconnect(): void {
    this.disconnected = true;
    this.observed.clear();
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  trigger(target: Element): void {
    if (this.disconnected || !this.observed.has(target)) return;
    this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

describe('disclosure viewport controller', () => {
  const originalResizeObserver = window.ResizeObserver;
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  const originalGetComputedStyle = window.getComputedStyle;
  let frames: Array<{ id: number; callback: FrameRequestCallback }> = [];
  let nextFrameId = 1;

  beforeEach(() => {
    FakeResizeObserver.instances = [];
    frames = [];
    nextFrameId = 1;
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: FakeResizeObserver,
    });
    window.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.push({ callback, id });
      return id;
    });
    window.cancelAnimationFrame = jest.fn((id: number) => {
      frames = frames.filter(frame => frame.id !== id);
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: originalResizeObserver,
    });
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    window.getComputedStyle = originalGetComputedStyle;
    jest.restoreAllMocks();
    jest.useRealTimers();
    document.body.replaceChildren();
  });

  function flushFrames(): void {
    while (frames.length > 0) {
      const pending = frames;
      frames = [];
      for (const frame of pending) frame.callback(performance.now());
    }
  }

  function createFixture(height = 600) {
    const scrollElement = document.createElement('div');
    Object.defineProperty(scrollElement, 'clientHeight', {
      configurable: true,
      value: height,
    });
    scrollElement.scrollTop = 0;
    const row = document.createElement('div');
    row.className = 'pivi-message-virtual-row';
    const header = document.createElement('button');
    row.appendChild(header);
    scrollElement.appendChild(row);
    document.body.appendChild(scrollElement);
    header.getBoundingClientRect = jest.fn(() => ({
      bottom: 420 - scrollElement.scrollTop,
      height: 20,
      left: 0,
      right: 100,
      top: 400 - scrollElement.scrollTop,
      width: 100,
      x: 0,
      y: 400 - scrollElement.scrollTop,
      toJSON: () => ({}),
    }));
    return { header, row, scrollElement };
  }

  it('tracks one third of the owner viewport and restores the prior style on dispose', () => {
    const { scrollElement } = createFixture();
    scrollElement.setCssProps({ '--pivi-expanded-content-max-height': '111px' });
    const controller = createDisclosureViewportController(scrollElement);

    expect(scrollElement.style.getPropertyValue('--pivi-expanded-content-max-height')).toBe('200px');
    expect(scrollElement.style.getPropertyValue('--pivi-subagent-expanded-max-height')).toBe('400px');

    Object.defineProperty(scrollElement, 'clientHeight', { configurable: true, value: 900 });
    FakeResizeObserver.instances[0]?.trigger(scrollElement);
    expect(scrollElement.style.getPropertyValue('--pivi-expanded-content-max-height')).toBe('300px');
    expect(scrollElement.style.getPropertyValue('--pivi-subagent-expanded-max-height')).toBe('600px');

    controller.dispose();
    expect(scrollElement.style.getPropertyValue('--pivi-expanded-content-max-height')).toBe('111px');
    expect(scrollElement.style.getPropertyValue('--pivi-subagent-expanded-max-height')).toBe('');
    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(true);
  });

  it('compensates repeated virtual-row growth without moving the activated header', () => {
    const { header, row, scrollElement } = createFixture(739);
    const controller = createDisclosureViewportController(scrollElement);
    expect(
      Number.parseFloat(
        scrollElement.style.getPropertyValue('--pivi-expanded-content-max-height'),
      ),
    ).toBeCloseTo(739 / 3);
    expect(
      Number.parseFloat(
        scrollElement.style.getPropertyValue('--pivi-subagent-expanded-max-height'),
      ),
    ).toBeCloseTo((739 * 2) / 3);
    controller.beginDisclosureResize(header);
    const rowObserver = FakeResizeObserver.instances.find(observer => observer.observed.has(row));

    scrollElement.scrollTop = 120;
    rowObserver?.trigger(row);
    flushFrames();
    expect(scrollElement.scrollTop).toBe(0);
    expect(header.getBoundingClientRect().top).toBe(400);

    scrollElement.scrollTop = 80;
    rowObserver?.trigger(row);
    flushFrames();
    expect(scrollElement.scrollTop).toBe(0);
    expect(header.getBoundingClientRect().top).toBe(400);

    controller.dispose();
  });

  it('releases anchoring when the user starts a scroll gesture', () => {
    const { header, row, scrollElement } = createFixture();
    const controller = createDisclosureViewportController(scrollElement);
    controller.beginDisclosureResize(header);
    const rowObserver = FakeResizeObserver.instances.find(observer => observer.observed.has(row));

    scrollElement.dispatchEvent(new WheelEvent('wheel'));
    scrollElement.scrollTop = 90;
    rowObserver?.trigger(row);
    flushFrames();

    expect(scrollElement.scrollTop).toBe(90);
    controller.dispose();
  });

  it('keeps keyboard disclosure anchoring but releases it for navigation keys', () => {
    const { header, row, scrollElement } = createFixture();
    const controller = createDisclosureViewportController(scrollElement);
    controller.beginDisclosureResize(header);
    const rowObserver = FakeResizeObserver.instances.find(observer => observer.observed.has(row));

    scrollElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    scrollElement.scrollTop = 70;
    rowObserver?.trigger(row);
    flushFrames();
    expect(scrollElement.scrollTop).toBe(0);

    scrollElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }));
    scrollElement.scrollTop = 70;
    rowObserver?.trigger(row);
    flushFrames();
    expect(scrollElement.scrollTop).toBe(70);

    controller.dispose();
  });

  function createDisclosureFixture(
    wrapperClass: string,
    headerClass: string,
    bodyClass: string,
    nestedInSubagent = false,
  ) {
    const { row, scrollElement } = createFixture();
    const wrapper = document.createElement('div');
    wrapper.className = `${wrapperClass} expanded`;
    const header = document.createElement('div');
    header.className = headerClass;
    const body = document.createElement('div');
    body.className = bodyClass;
    wrapper.append(header, body);
    if (nestedInSubagent) {
      const subagent = document.createElement('div');
      subagent.className = 'pivi-subagent-list expanded';
      const subagentContent = document.createElement('div');
      subagentContent.className = 'pivi-subagent-content';
      subagentContent.appendChild(wrapper);
      subagent.append(
        document.createElement('div'),
        subagentContent,
      );
      row.appendChild(subagent);
    } else {
      row.appendChild(wrapper);
    }
    Object.defineProperties(body, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, value: 100, writable: true },
    });
    header.getBoundingClientRect = jest.fn(() => ({
      bottom: 120,
      height: 20,
      left: 0,
      right: 100,
      top: 100,
      width: 100,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    }));
    body.getBoundingClientRect = jest.fn(() => ({
      bottom: 170,
      height: 100,
      left: 0,
      right: 100,
      top: 70,
      width: 100,
      x: 0,
      y: 70,
      toJSON: () => ({}),
    }));
    wrapper.getBoundingClientRect = jest.fn(() => ({
      bottom: 200,
      height: 120,
      left: 0,
      right: 100,
      top: 80,
      width: 100,
      x: 0,
      y: 80,
      toJSON: () => ({}),
    }));
    return { body, header, row, scrollElement, wrapper };
  }

  it('never mutates disclosure state when inner scrolling reaches its end', () => {
    const { row, scrollElement } = createFixture();
    const wrapper = document.createElement('div');
    wrapper.className = 'pivi-tool-call expanded';
    const header = document.createElement('button');
    header.className = 'pivi-tool-header';
    wrapper.appendChild(header);
    row.appendChild(wrapper);
    Object.defineProperties(wrapper, {
      clientHeight: { configurable: true, value: 220 },
      scrollHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 180, writable: true },
    });
    const click = jest.spyOn(header, 'click');
    const controller = createDisclosureViewportController(scrollElement);

    header.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    wrapper.dispatchEvent(new Event('scroll', { bubbles: true }));

    expect(click).not.toHaveBeenCalled();
    expect(wrapper.classList.contains('expanded')).toBe(true);
    controller.dispose();
  });

  it('adjusts the inner subagent scrollport when a nested sticky tool header collapses', () => {
    const { row, scrollElement } = createFixture();
    const subagent = document.createElement('div');
    subagent.className = 'pivi-subagent-list expanded';
    const subagentContent = document.createElement('div');
    subagentContent.className = 'pivi-subagent-content';
    Object.defineProperties(subagentContent, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, value: 150, writable: true },
    });
    const getComputedStyleSpy = jest.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = originalGetComputedStyle.call(window, element, pseudo);
      if (element === subagentContent) {
        return { ...style, overflowY: 'auto' } as CSSStyleDeclaration;
      }
      return style;
    });

    const group = document.createElement('div');
    group.className = 'pivi-tool-step-group expanded';
    const steps = document.createElement('div');
    steps.className = 'pivi-tool-step-group-steps';
    const stepItem = document.createElement('div');
    stepItem.className = 'pivi-tool-step-item';
    const tool = document.createElement('div');
    tool.className = 'pivi-tool-call expanded pivi-tool-call-in-step-group';
    const header = document.createElement('button');
    header.className = 'pivi-tool-header';
    tool.append(header, document.createElement('div'));
    stepItem.appendChild(tool);
    steps.appendChild(stepItem);
    group.append(document.createElement('button'), steps);
    subagentContent.appendChild(group);
    subagent.append(document.createElement('div'), subagentContent);
    row.appendChild(subagent);

    let headerTop = 118;
    header.getBoundingClientRect = jest.fn(() => ({
      bottom: headerTop + 20,
      height: 20,
      left: 0,
      right: 100,
      top: headerTop,
      width: 100,
      x: 0,
      y: headerTop,
      toJSON: () => ({}),
    }));

    const controller = createDisclosureViewportController(scrollElement);
    controller.beginDisclosureResize(header);

    headerTop = 168;
    tool.classList.remove('expanded');
    const rowObserver = FakeResizeObserver.instances.find(observer => observer.observed.has(row));
    rowObserver?.trigger(row);
    flushFrames();

    expect(subagentContent.scrollTop).toBe(200);
    getComputedStyleSpy.mockRestore();
    controller.dispose();
  });

  it('publishes each expanded steps header height as its child sticky offset', () => {
    const { row, scrollElement } = createFixture();
    const group = document.createElement('div');
    group.className = 'pivi-tool-step-group expanded';
    const header = document.createElement('button');
    header.className = 'pivi-tool-step-group-header';
    header.getBoundingClientRect = jest.fn(() => ({
      bottom: 19,
      height: 19,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    group.appendChild(header);
    row.appendChild(group);

    const controller = createDisclosureViewportController(scrollElement);

    expect(group.style.getPropertyValue('--pivi-tool-step-group-sticky-top')).toBe('19px');
    controller.dispose();
    expect(group.style.getPropertyValue('--pivi-tool-step-group-sticky-top')).toBe('');
  });

  it('does not shrink or expand wrappers on wheel after internal scroll end', () => {
    const { body, header, scrollElement, wrapper } = createDisclosureFixture(
      'pivi-subagent-list',
      'pivi-subagent-header',
      'pivi-subagent-content',
    );
    Object.defineProperty(wrapper, 'offsetHeight', { configurable: true, value: 120 });
    Object.defineProperty(header, 'offsetHeight', { configurable: true, value: 20 });
    const controller = createDisclosureViewportController(scrollElement);

    const down = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
    body.dispatchEvent(down);
    const up = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 });
    body.dispatchEvent(up);

    expect(down.defaultPrevented).toBe(false);
    expect(up.defaultPrevented).toBe(false);
    expect(wrapper.classList.contains('pivi-disclosure-chain-active')).toBe(false);
    expect(wrapper.style.getPropertyValue('--pivi-disclosure-chain-max-height')).toBe('');
    expect(wrapper.classList.contains('expanded')).toBe(true);
    controller.dispose();
  });

});
