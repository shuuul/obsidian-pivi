import type { BeginDisclosureResize } from './types';

const DISCLOSURE_HEIGHT_PROPERTY = '--pivi-expanded-content-max-height';
const DISCLOSURE_HEIGHT_RATIO = 1 / 3;
const ANCHOR_QUIET_MS = 1_000;
const ANCHOR_MAX_MS = 5_000;
const ANCHOR_TOLERANCE_PX = 1;
const STEP_GROUP_STICKY_TOP_PROPERTY = '--pivi-tool-step-group-sticky-top';
const CHAIN_ACTIVE_CLASS = 'pivi-disclosure-chain-active';
const CHAIN_SHIFT_PROPERTY = '--pivi-disclosure-chain-shift';
const CHAIN_CLIP_PROPERTY = '--pivi-disclosure-chain-clip-bottom';
const SCROLL_END_TOLERANCE_PX = 1;

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

interface DisclosureParts {
  readonly body: HTMLElement;
  readonly header: HTMLElement;
  readonly wrapper: HTMLElement;
}

function isNestedDisclosure(wrapper: HTMLElement): boolean {
  return !!wrapper.parentElement?.closest(
    '.pivi-subagent-content, .pivi-tool-step-group-steps',
  );
}

function getDisclosureParts(wrapper: HTMLElement): DisclosureParts | null {
  let headerSelector: string;
  let bodySelector: string;
  if (wrapper.classList.contains('pivi-subagent-list')) {
    headerSelector = ':scope > .pivi-subagent-header';
    bodySelector = ':scope > .pivi-subagent-content';
  } else if (wrapper.classList.contains('pivi-tool-step-group')) {
    headerSelector = ':scope > .pivi-tool-step-group-header';
    bodySelector = ':scope > .pivi-tool-step-group-steps';
  } else {
    headerSelector = ':scope > .pivi-tool-header';
    bodySelector = ':scope > .pivi-tool-content';
  }
  const header = wrapper.querySelector<HTMLElement>(headerSelector);
  const body = wrapper.querySelector<HTMLElement>(bodySelector);
  return header && body ? { body, header, wrapper } : null;
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
  const ResizeObserverCtor = ownerWindow.ResizeObserver;
  let active: ActiveAnchor | null = null;
  let disposed = false;
  let chainFrame: number | null = null;
  const watchedBodies = new Set<HTMLElement>();

  const syncHeight = () => {
    const height = scrollElement.clientHeight || scrollElement.getBoundingClientRect().height;
    if (height <= 0) return;
    scrollElement.style.setProperty(
      DISCLOSURE_HEIGHT_PROPERTY,
      `${height * DISCLOSURE_HEIGHT_RATIO}px`,
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

  const clearDisclosureChain = (body: HTMLElement) => {
    body.classList.remove(CHAIN_ACTIVE_CLASS);
    body.style.removeProperty(CHAIN_SHIFT_PROPERTY);
    body.style.removeProperty(CHAIN_CLIP_PROPERTY);
  };

  const ensureBodyWatched = (body: HTMLElement) => {
    if (watchedBodies.has(body)) return;
    watchedBodies.add(body);
    body.addEventListener('scroll', scheduleDisclosureChainSync, { passive: true });
  };

  const syncDisclosureChains = () => {
    chainFrame = null;
    const seenBodies = new Set<HTMLElement>();
    for (const wrapper of scrollElement.querySelectorAll<HTMLElement>(
      '.pivi-subagent-list.expanded, .pivi-tool-step-group.expanded, .pivi-tool-call.expanded',
    )) {
      if (isNestedDisclosure(wrapper)) continue;
      const parts = getDisclosureParts(wrapper);
      if (!parts) continue;
      const { body, header } = parts;
      seenBodies.add(body);
      ensureBodyWatched(body);
      const maxScrollTop = body.scrollHeight - body.clientHeight;
      if (
        maxScrollTop <= SCROLL_END_TOLERANCE_PX
        || body.scrollTop < maxScrollTop - SCROLL_END_TOLERANCE_PX
      ) {
        clearDisclosureChain(body);
        continue;
      }
      const currentShift = Number.parseFloat(
        body.style.getPropertyValue(CHAIN_SHIFT_PROPERTY),
      ) || 0;
      const bodyRect = body.getBoundingClientRect();
      const naturalBodyTop = bodyRect.top - currentShift;
      const headerRect = header.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      const shift = headerRect.bottom - naturalBodyTop;
      if (shift <= 0) {
        clearDisclosureChain(body);
        continue;
      }
      const visibleHeight = Math.max(
        0,
        Math.min(bodyRect.height, wrapperRect.bottom - headerRect.bottom),
      );
      body.style.setProperty(CHAIN_SHIFT_PROPERTY, `${shift}px`);
      body.style.setProperty(
        CHAIN_CLIP_PROPERTY,
        `${Math.max(0, bodyRect.height - visibleHeight)}px`,
      );
      body.classList.add(CHAIN_ACTIVE_CLASS);
    }
    for (const body of scrollElement.querySelectorAll<HTMLElement>(
      `.${CHAIN_ACTIVE_CLASS}`,
    )) {
      if (!seenBodies.has(body)) clearDisclosureChain(body);
    }
  };

  const scheduleDisclosureChainSync = () => {
    if (disposed || chainFrame !== null) return;
    chainFrame = ownerWindow.requestAnimationFrame(syncDisclosureChains);
  };

  const clearWatchedBodies = () => {
    for (const body of watchedBodies) {
      body.removeEventListener('scroll', scheduleDisclosureChainSync);
    }
    watchedBodies.clear();
  };

  const viewportObserver = typeof ResizeObserverCtor === 'function'
    ? new ResizeObserverCtor(() => {
        syncHeight();
        syncStepGroupStickyOffsets();
        scheduleDisclosureChainSync();
      })
    : null;
  viewportObserver?.observe(scrollElement);
  syncHeight();

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
          scrollElement.scrollTop += delta;
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
          scheduleDisclosureChainSync();
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
  scrollElement.addEventListener('scroll', scheduleDisclosureChainSync, true);
  syncStepGroupStickyOffsets();
  scheduleDisclosureChainSync();

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
      scrollElement.removeEventListener('scroll', scheduleDisclosureChainSync, true);
      clearWatchedBodies();
      if (chainFrame !== null) ownerWindow.cancelAnimationFrame(chainFrame);
      chainFrame = null;
      for (const body of scrollElement.querySelectorAll<HTMLElement>(
        `.${CHAIN_ACTIVE_CLASS}`,
      )) {
        clearDisclosureChain(body);
      }
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
    },
  };
}
