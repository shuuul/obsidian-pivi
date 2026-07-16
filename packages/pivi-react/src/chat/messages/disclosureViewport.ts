import type { BeginDisclosureResize } from './types';

const DISCLOSURE_HEIGHT_PROPERTY = '--pivi-expanded-content-max-height';
const SUBAGENT_HEIGHT_PROPERTY = '--pivi-subagent-expanded-max-height';
const DISCLOSURE_HEIGHT_RATIO = 1 / 3;
const SUBAGENT_HEIGHT_RATIO = 2 / 3;
const ANCHOR_QUIET_MS = 1_000;
const ANCHOR_MAX_MS = 5_000;
const ANCHOR_TOLERANCE_PX = 1;
const STEP_GROUP_STICKY_TOP_PROPERTY = '--pivi-tool-step-group-sticky-top';

export interface DisclosureViewportController {
  readonly beginDisclosureResize: BeginDisclosureResize;
  dispose(): void;
}

interface ActiveAnchor {
  readonly header: HTMLElement;
  readonly targetTop: number;
  readonly resizeObserver: ResizeObserver | null;
  quietTimer: number | null;
  deadlineTimer: number | null;
  firstFrame: number | null;
  secondFrame: number | null;
}

function getDisclosureRow(header: HTMLElement): HTMLElement | null {
  return header.closest<HTMLElement>('.pivi-message-virtual-row');
}

function isVerticalScrollContainer(element: HTMLElement): boolean {
  if (element.scrollHeight <= element.clientHeight + ANCHOR_TOLERANCE_PX) return false;
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  const { overflowY } = view.getComputedStyle(element);
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
}

function findInnerScrollContainer(
  header: HTMLElement,
  transcriptScroll: HTMLElement,
): HTMLElement | null {
  let inner: HTMLElement | null = null;
  let node: HTMLElement | null = header.parentElement;
  while (node && node !== transcriptScroll) {
    if (isVerticalScrollContainer(node)) {
      inner = node;
    }
    node = node.parentElement;
  }
  return inner;
}

function applyAnchorCorrection(
  header: HTMLElement,
  targetTop: number,
  transcriptScroll: HTMLElement,
): void {
  let delta = header.getBoundingClientRect().top - targetTop;
  if (Math.abs(delta) <= ANCHOR_TOLERANCE_PX) return;

  const innerScroll = findInnerScrollContainer(header, transcriptScroll);
  if (innerScroll) {
    innerScroll.scrollTop += delta;
    delta = header.getBoundingClientRect().top - targetTop;
  }
  if (Math.abs(delta) > ANCHOR_TOLERANCE_PX) {
    transcriptScroll.scrollTop += delta;
  }
}

export function createDisclosureViewportController(
  scrollElement: HTMLElement,
): DisclosureViewportController {
  const ownerWindow = scrollElement.ownerDocument.defaultView;
  if (!ownerWindow) {
    return { beginDisclosureResize: () => {}, dispose: () => {} };
  }

  const previousHeightValue = scrollElement.style.getPropertyValue(DISCLOSURE_HEIGHT_PROPERTY);
  const previousHeightPriority = scrollElement.style.getPropertyPriority(DISCLOSURE_HEIGHT_PROPERTY);
  const previousSubagentHeightValue = scrollElement.style.getPropertyValue(SUBAGENT_HEIGHT_PROPERTY);
  const previousSubagentHeightPriority = scrollElement.style.getPropertyPriority(SUBAGENT_HEIGHT_PROPERTY);
  const ResizeObserverCtor = ownerWindow.ResizeObserver;
  let active: ActiveAnchor | null = null;
  let disposed = false;

  const syncHeight = () => {
    const height = scrollElement.clientHeight || scrollElement.getBoundingClientRect().height;
    if (height <= 0) return;
    scrollElement.style.setProperty(
      DISCLOSURE_HEIGHT_PROPERTY,
      `${height * DISCLOSURE_HEIGHT_RATIO}px`,
    );
    scrollElement.style.setProperty(
      SUBAGENT_HEIGHT_PROPERTY,
      `${height * SUBAGENT_HEIGHT_RATIO}px`,
    );
  };

  const syncStepGroupStickyOffsets = () => {
    for (const group of scrollElement.querySelectorAll<HTMLElement>(
      '.pivi-tool-step-group.expanded',
    )) {
      const header = group.querySelector<HTMLElement>(
        ':scope > .pivi-tool-step-group-header',
      );
      if (!header) continue;
      const height = header.getBoundingClientRect().height || header.offsetHeight;
      if (height > 0) {
        group.style.setProperty(STEP_GROUP_STICKY_TOP_PROPERTY, `${height}px`);
      }
    }
  };

  const viewportObserver = typeof ResizeObserverCtor === 'function'
    ? new ResizeObserverCtor(() => {
        syncHeight();
        syncStepGroupStickyOffsets();
      })
    : null;
  viewportObserver?.observe(scrollElement);
  syncHeight();
  syncStepGroupStickyOffsets();

  const clearAnchor = () => {
    const current = active;
    active = null;
    if (!current) return;
    current.resizeObserver?.disconnect();
    if (current.quietTimer !== null) ownerWindow.clearTimeout(current.quietTimer);
    if (current.deadlineTimer !== null) ownerWindow.clearTimeout(current.deadlineTimer);
    if (current.firstFrame !== null) ownerWindow.cancelAnimationFrame(current.firstFrame);
    if (current.secondFrame !== null) ownerWindow.cancelAnimationFrame(current.secondFrame);
  };

  const scheduleCorrection = () => {
    const current = active;
    if (!current) return;
    if (current.firstFrame !== null) ownerWindow.cancelAnimationFrame(current.firstFrame);
    if (current.secondFrame !== null) ownerWindow.cancelAnimationFrame(current.secondFrame);
    current.firstFrame = ownerWindow.requestAnimationFrame(() => {
      if (active !== current) return;
      current.firstFrame = null;
      current.secondFrame = ownerWindow.requestAnimationFrame(() => {
        if (active !== current) return;
        current.secondFrame = null;
        if (!current.header.isConnected) {
          clearAnchor();
          return;
        }
        const delta = current.header.getBoundingClientRect().top - current.targetTop;
        if (Math.abs(delta) > ANCHOR_TOLERANCE_PX) {
          applyAnchorCorrection(current.header, current.targetTop, scrollElement);
        }
      });
    });
  };

  const resetQuietTimer = () => {
    const current = active;
    if (!current) return;
    if (current.quietTimer !== null) ownerWindow.clearTimeout(current.quietTimer);
    current.quietTimer = ownerWindow.setTimeout(clearAnchor, ANCHOR_QUIET_MS);
  };

  const beginDisclosureResize: BeginDisclosureResize = (header) => {
    if (disposed || header.ownerDocument.defaultView !== ownerWindow) return;
    const row = getDisclosureRow(header);
    if (!row) return;
    clearAnchor();
    const resizeObserver = typeof ResizeObserverCtor === 'function'
      ? new ResizeObserverCtor(() => {
          scheduleCorrection();
          resetQuietTimer();
          syncStepGroupStickyOffsets();
        })
      : null;
    active = {
      header,
      targetTop: header.getBoundingClientRect().top,
      resizeObserver,
      quietTimer: null,
      deadlineTimer: null,
      firstFrame: null,
      secondFrame: null,
    };
    resizeObserver?.observe(row);
    active.deadlineTimer = ownerWindow.setTimeout(clearAnchor, ANCHOR_MAX_MS);
    scheduleCorrection();
    resetQuietTimer();
  };

  const cancelForUserGesture = () => clearAnchor();
  const cancelForNavigationKey = (event: KeyboardEvent) => {
    if (
      event.key === 'ArrowDown'
      || event.key === 'ArrowLeft'
      || event.key === 'ArrowRight'
      || event.key === 'ArrowUp'
      || event.key === 'End'
      || event.key === 'Home'
      || event.key === 'PageDown'
      || event.key === 'PageUp'
    ) {
      clearAnchor();
    }
  };
  scrollElement.addEventListener('wheel', cancelForUserGesture, { passive: true });
  scrollElement.addEventListener('touchstart', cancelForUserGesture, { passive: true });
  scrollElement.addEventListener('pointerdown', cancelForUserGesture);
  scrollElement.addEventListener('keydown', cancelForNavigationKey);

  return {
    beginDisclosureResize,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearAnchor();
      viewportObserver?.disconnect();
      scrollElement.removeEventListener('wheel', cancelForUserGesture);
      scrollElement.removeEventListener('touchstart', cancelForUserGesture);
      scrollElement.removeEventListener('pointerdown', cancelForUserGesture);
      scrollElement.removeEventListener('keydown', cancelForNavigationKey);
      for (const group of scrollElement.querySelectorAll<HTMLElement>(
        '.pivi-tool-step-group',
      )) {
        group.style.removeProperty(STEP_GROUP_STICKY_TOP_PROPERTY);
      }
      if (previousHeightValue) {
        scrollElement.style.setProperty(
          DISCLOSURE_HEIGHT_PROPERTY,
          previousHeightValue,
          previousHeightPriority,
        );
      } else {
        scrollElement.style.removeProperty(DISCLOSURE_HEIGHT_PROPERTY);
      }
      if (previousSubagentHeightValue) {
        scrollElement.style.setProperty(
          SUBAGENT_HEIGHT_PROPERTY,
          previousSubagentHeightValue,
          previousSubagentHeightPriority,
        );
      } else {
        scrollElement.style.removeProperty(SUBAGENT_HEIGHT_PROPERTY);
      }
    },
  };
}
