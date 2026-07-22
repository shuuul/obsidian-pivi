import type {
  ChatPerfRecorder,
  MessageContentAdapter,
  StreamingMarkdownValue,
} from '@pivi/pivi-react';
import { NOOP_CHAT_PERF_RECORDER } from '@pivi/pivi-react';
import { Component } from 'obsidian';

import type { RenderContentFn } from '@/ui/chat/rendering/MessageRenderer';

interface MountedStreamingMarkdown {
  readonly root: HTMLElement;
  readonly sealedRoot: HTMLElement;
  readonly tail: HTMLElement;
  readonly scopes: Component[];
  content: string;
  sealedOffset: number;
  disposed: boolean;
  generation: number;
  renderQueue: Promise<void>;
  scan: MarkdownScanState;
}

interface MarkdownScanState {
  offset: number;
  safeOffset: number;
  fence: string | null;
  displayMath: boolean;
  htmlDepth: number;
}

const HTML_BLOCK_OPEN = /^\s*<(address|article|aside|blockquote|details|dialog|div|dl|fieldset|figure|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|section|summary|table|ul)(?:\s|>|$)/i;
const HTML_BLOCK_CLOSE = /^\s*<\/(address|article|aside|blockquote|details|dialog|div|dl|fieldset|figure|footer|form|h[1-6]|header|main|nav|ol|p|pre|section|summary|table|ul)>\s*$/i;

/** Find the latest blank-line boundary that cannot split a fenced block. */
function createScanState(): MarkdownScanState {
  return { offset: 0, safeOffset: 0, fence: null, displayMath: false, htmlDepth: 0 };
}

function scanMarkdownAppend(markdown: string, state: MarkdownScanState): void {
  const append = markdown.slice(state.offset);
  let lineStart = 0;
  let lineEnd = append.indexOf('\n', lineStart);

  while (lineEnd >= 0) {
    const line = append.slice(lineStart, lineEnd);
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0];
      if (!state.fence) state.fence = marker ?? null;
      else if (state.fence === marker) state.fence = null;
    } else if (!state.fence) {
      const mathMarkers = trimmed.match(/\$\$/g)?.length ?? 0;
      if (mathMarkers % 2 === 1) state.displayMath = !state.displayMath;
      if (!state.displayMath) {
        if (HTML_BLOCK_CLOSE.test(line)) state.htmlDepth = Math.max(0, state.htmlDepth - 1);
        else if (HTML_BLOCK_OPEN.test(line) && !trimmed.endsWith('/>')) state.htmlDepth += 1;
      }
    }

    state.offset += lineEnd - lineStart + 1;
    if (
      trimmed === ''
      && !state.fence
      && !state.displayMath
      && state.htmlDepth === 0
    ) state.safeOffset = state.offset;

    lineStart = lineEnd + 1;
    lineEnd = append.indexOf('\n', lineStart);
  }
}

export function findStreamingMarkdownSealOffset(markdown: string): number {
  const state = createScanState();
  scanMarkdownAppend(markdown, state);
  return state.safeOffset;
}

function unloadScopes(parent: Component, state: MountedStreamingMarkdown): void {
  for (const scope of state.scopes.splice(0)) parent.removeChild(scope);
}

function clearMountedState(parent: Component, state: MountedStreamingMarkdown): void {
  state.generation += 1;
  unloadScopes(parent, state);
  state.sealedRoot.replaceChildren();
  state.tail.replaceChildren();
  state.content = '';
  state.sealedOffset = 0;
  state.renderQueue = Promise.resolve();
  state.scan = createScanState();
}

function appendSealedSegment(
  parent: Component,
  renderContent: RenderContentFn,
  recorder: ChatPerfRecorder,
  state: MountedStreamingMarkdown,
  markdown: string,
  blockId: string,
  phase: StreamingMarkdownValue['phase'],
): void {
  if (!markdown) return;
  const segment = state.root.ownerDocument.win.createDiv();
  segment.className = 'pivi-streaming-markdown-segment';
  state.sealedRoot.appendChild(segment);
  const scope = new Component();
  parent.addChild(scope);
  state.scopes.push(scope);
  const generation = state.generation;
  state.renderQueue = state.renderQueue.then(async () => {
    if (state.disposed || generation !== state.generation) return;
    const ownerWindow = segment.ownerDocument.defaultView;
    const startedAt = recorder.enabled ? recorder.now(ownerWindow) : 0;
    try {
      await renderContent(segment, markdown, { component: scope });
    } finally {
      if (recorder.enabled && ownerWindow) {
        recorder.onMarkdownRender(
          blockId,
          phase,
          markdown.length,
          Math.max(0, recorder.now(ownerWindow) - startedAt),
          ownerWindow,
        );
      }
    }
  });
}

function updateStreamingState(
  parent: Component,
  renderContent: RenderContentFn,
  recorder: ChatPerfRecorder,
  state: MountedStreamingMarkdown,
  value: StreamingMarkdownValue,
): void {
  const previousContent = state.content;
  const isAppend = value.content.startsWith(previousContent);
  if (!isAppend) clearMountedState(parent, state);

  state.content = value.content;
  if (value.phase === 'terminal') {
    clearMountedState(parent, state);
    state.content = value.content;
    state.tail.replaceChildren();
    appendSealedSegment(
      parent,
      renderContent,
      recorder,
      state,
      value.content,
      value.blockId,
      value.phase,
    );
    state.sealedOffset = value.content.length;
    return;
  }

  scanMarkdownAppend(value.content, state.scan);
  const sealOffset = state.scan.safeOffset;
  if (sealOffset > state.sealedOffset) {
    appendSealedSegment(
      parent,
      renderContent,
      recorder,
      state,
      value.content.slice(state.sealedOffset, sealOffset),
      value.blockId,
      value.phase,
    );
    state.sealedOffset = sealOffset;
    state.tail.textContent = value.content.slice(state.sealedOffset);
  } else if (isAppend) {
    state.tail.append(value.content.slice(previousContent.length));
  } else {
    state.tail.textContent = value.content.slice(state.sealedOffset);
  }
}

/** Stable streaming island: rendered prefix segments plus an escaped plain-text tail. */
export function createStreamingMarkdownContentAdapter(
  parent: Component,
  renderContent: RenderContentFn,
  recorder: ChatPerfRecorder = NOOP_CHAT_PERF_RECORDER,
): MessageContentAdapter<StreamingMarkdownValue> {
  const mounted = new WeakMap<HTMLElement, MountedStreamingMarkdown>();
  return {
    mount(container, value) {
      const root = container.ownerDocument.win.createDiv();
      root.className = 'pivi-streaming-markdown';
      const sealedRoot = container.ownerDocument.win.createDiv();
      sealedRoot.className = 'pivi-streaming-markdown-sealed';
      const tail = container.ownerDocument.win.createDiv();
      tail.className = 'pivi-streaming-markdown-tail';
      root.append(sealedRoot, tail);
      container.replaceChildren(root);
      const state: MountedStreamingMarkdown = {
        root,
        sealedRoot,
        tail,
        scopes: [],
        content: '',
        sealedOffset: 0,
        disposed: false,
        generation: 0,
        renderQueue: Promise.resolve(),
        scan: createScanState(),
      };
      mounted.set(container, state);
      updateStreamingState(parent, renderContent, recorder, state, value);
      return () => {
        state.disposed = true;
        clearMountedState(parent, state);
        mounted.delete(container);
        container.replaceChildren();
      };
    },
    update(container, value) {
      const state = mounted.get(container);
      if (!state) throw new Error(`Streaming Markdown block ${value.blockId} is not mounted`);
      updateStreamingState(parent, renderContent, recorder, state, value);
    },
  };
}
