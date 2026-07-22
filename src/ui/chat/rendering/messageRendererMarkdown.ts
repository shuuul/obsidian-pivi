import type { MentionBadgeParseContext } from '@pivi/pivi-agent-core/context/mentions';
import type { ChatTurnRequestSnapshot } from '@pivi/pivi-agent-core/foundation';
import { escapeMathDelimitersForStreaming } from '@pivi/pivi-agent-core/foundation/streamingMath';
import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';
import type { App, Component } from 'obsidian';
import { MarkdownRenderer, setIcon } from 'obsidian';

import type { PiviChatHost } from '@/app/hostContracts';
import { t } from '@/app/i18n';
import { createContextBadgeElement } from '@/ui/shared/context-badge/ContextBadgeRenderer';
import { createMentionVaultLookup } from '@/ui/shared/mention/createMentionVaultLookup';
import { renderMentionBadges } from '@/ui/shared/mention/renderMentionBadges';

import { getActiveDocument, getActiveWindow } from '../../shared/dom';
import { buildExternalContextDisplayEntries } from '../../shared/utils/externalContext';
import {
  normalizeObsidianAppLinksInMarkdown,
  processFileLinks,
} from '../../shared/utils/fileLink';
import { trimEmptyEdgeParagraphs } from './markdownContentCleanup';
import { runRendererAction } from './messageRendererActions';
import type { RenderContentOptions } from './messageRendererTypes';

export interface MarkdownContentRenderHost {
  readonly app: App;
  readonly component: Component;
}

export interface MessageRendererMarkdownHost extends MarkdownContentRenderHost {
  readonly plugin: PiviChatHost;
  readonly ports: ChatPorts;
}

export function buildMentionBadgeContext(
  host: MessageRendererMarkdownHost,
  turnRequest?: ChatTurnRequestSnapshot,
): MentionBadgeParseContext {
  const mcpServerNames = new Set(
    host.ports.catalog.listMcpServers().map((server) => server.name),
  );
  const skillCommandNames = new Set(
    host.ports.catalog.listSkills().map((skill) => skill.name),
  );
  const externalPaths = turnRequest
    ? (turnRequest.externalContextPaths ?? [])
    : host.ports.settings.getSettingsSnapshot().externalReadDirectories;

  return {
    vault: createMentionVaultLookup(host.app),
    mcpServerNames,
    skillCommandNames,
    externalContextEntries: buildExternalContextDisplayEntries(externalPaths),
  };
}

export function getMarkdownRenderSourcePath(host: MarkdownContentRenderHost): string {
  return host.app.workspace.getActiveFile()?.path ?? '';
}

const MERMAID_MIN_SCALE = 0.1;
const MERMAID_MAX_SCALE = 2;
const MERMAID_SCALE_STEP = 0.25;
const MERMAID_WHEEL_SCALE_SENSITIVITY = 0.006;
const mermaidObservers = new WeakMap<HTMLElement, MutationObserver>();

type MermaidWindow = Window & {
  MutationObserver?: typeof MutationObserver;
};

export function clampMermaidScale(scale: number): number {
  return Math.min(MERMAID_MAX_SCALE, Math.max(MERMAID_MIN_SCALE, scale));
}

export function getMermaidDiagramSize(svg: SVGSVGElement): { width: number; height: number } {
  const width = Number.parseFloat(svg.getAttribute('width') ?? '');
  const height = Number.parseFloat(svg.getAttribute('height') ?? '');
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }

  const viewBox = svg.viewBox?.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    return { width: viewBox.width, height: viewBox.height };
  }

  const rect = svg.getBoundingClientRect();
  return {
    width: rect.width > 0 ? rect.width : 800,
    height: rect.height > 0 ? rect.height : 400,
  };
}

function scrollNearestMessagesContainer(el: HTMLElement, deltaY: number): void {
  const messagesEl = el.closest<HTMLElement>('.pivi-messages');
  if (!messagesEl) return;
  messagesEl.scrollTop += deltaY;
}

function enhanceMermaidDiagram(container: HTMLElement): void {
  if (container.dataset.piviMermaidEnhanced === 'true') return;

  const svg = container.querySelector<SVGSVGElement>('svg');
  if (!svg) return;
  container.classList.add('pivi-rendered-mermaid');

  const doc = getActiveDocument(container);
  const scroll = doc.win.createDiv();
  scroll.className = 'pivi-mermaid-scroll';
  const zoomSurface = doc.win.createDiv();
  zoomSurface.className = 'pivi-mermaid-zoom-surface';

  const parent = container.parentElement;
  if (!parent) return;

  container.dataset.piviMermaidEnhanced = 'true';

  parent.insertBefore(scroll, container);
  scroll.appendChild(zoomSurface);
  zoomSurface.appendChild(container);

  const controls = doc.win.createDiv();
  controls.className = 'pivi-mermaid-controls';
  scroll.appendChild(controls);

  let scale = 1;
  let resetButton: HTMLButtonElement | null = null;
  const getFitToWidthScale = () => {
    const size = getMermaidDiagramSize(svg);
    const viewportWidth = scroll.clientWidth > 0 ? scroll.clientWidth - 16 : 0;
    if (size.width <= 0 || viewportWidth <= 0) return 1;
    return viewportWidth / size.width;
  };

  const applyScale = () => {
    const size = getMermaidDiagramSize(svg);
    const scaledWidth = Math.ceil(size.width * scale);
    const scaledHeight = Math.ceil(size.height * scale);
    const viewportWidth = scroll.clientWidth > 0 ? scroll.clientWidth - 16 : 0;
    zoomSurface.style.width = `${Math.max(scaledWidth, viewportWidth)}px`;
    zoomSurface.style.height = `${scaledHeight}px`;
    container.style.transform = `scale(${scale})`;
    const scaleLabel = `${Math.round(scale * 100)}%`;
    scroll.dataset.piviMermaidScale = scaleLabel;
    if (resetButton) resetButton.textContent = scaleLabel;
  };

  const setScale = (nextScale: number) => {
    scale = clampMermaidScale(nextScale);
    applyScale();
  };

  const makeButton = (label: string, ariaLabel: string, onClick: () => void, icon?: string): HTMLButtonElement => {
    const button = doc.win.createEl('button');
    button.type = 'button';
    button.className = 'pivi-mermaid-control-btn';
    if (icon) {
      button.addClass('pivi-mermaid-control-btn-icon');
      setIcon(button, icon);
    } else {
      button.textContent = label;
    }
    button.setAttribute('aria-label', ariaLabel);
    button.setAttribute('title', ariaLabel);
    button.addEventListener('click', onClick);
    controls.appendChild(button);
    return button;
  };

  makeButton('−', t('chat.mermaid.zoomOut'), () => {
    setScale(scale - MERMAID_SCALE_STEP);
  });
  resetButton = makeButton('100%', t('chat.mermaid.resetZoom'), () => {
    setScale(1);
  });
  makeButton('+', t('chat.mermaid.zoomIn'), () => {
    setScale(scale + MERMAID_SCALE_STEP);
  });
  makeButton('', t('chat.mermaid.fitToWidth'), () => {
    setScale(getFitToWidthScale());
  }, 'stretch-horizontal');

  scroll.addEventListener('wheel', (event) => {
    const wantsZoom = event.ctrlKey || event.metaKey;
    const hasHorizontalPan = Math.abs(event.deltaX) > 0.5;
    const hasVerticalZoom = wantsZoom && Math.abs(event.deltaY) > 0.5;
    if (!hasHorizontalPan && !hasVerticalZoom) return;
    event.preventDefault();
    if (hasHorizontalPan) {
      scroll.scrollLeft += event.deltaX;
    }
    if (hasVerticalZoom) {
      const nextScale = scale * Math.exp(-event.deltaY * MERMAID_WHEEL_SCALE_SENSITIVITY);
      setScale(nextScale);
    } else if (hasHorizontalPan && Math.abs(event.deltaY) > 0.5) {
      scrollNearestMessagesContainer(scroll, event.deltaY);
    }
  }, { passive: false });

  applyScale();
  getActiveWindow(container).requestAnimationFrame(applyScale);
}

export function enhanceMermaidDiagrams(el: HTMLElement): () => void {
  const enhanceAll = () => {
    el.querySelectorAll<HTMLElement>('.mermaid, .block-language-mermaid').forEach(enhanceMermaidDiagram);
  };

  enhanceAll();

  const win = getActiveWindow(el) as MermaidWindow;
  if (typeof win.MutationObserver === 'undefined') return () => undefined;

  mermaidObservers.get(el)?.disconnect();
  const MutationObserverCtor = win.MutationObserver;
  const observer = new MutationObserverCtor(() => enhanceAll());
  mermaidObservers.set(el, observer);
  observer.observe(el, { childList: true, subtree: true });
  const timeout = win.setTimeout(() => {
    enhanceAll();
    observer.disconnect();
    if (mermaidObservers.get(el) === observer) {
      mermaidObservers.delete(el);
    }
  }, 5000);
  return () => {
    win.clearTimeout(timeout);
    observer.disconnect();
    if (mermaidObservers.get(el) === observer) mermaidObservers.delete(el);
  };
}

export async function renderUserMessageText(
  host: MessageRendererMarkdownHost,
  el: HTMLElement,
  text: string,
  turnRequest: ChatTurnRequestSnapshot | undefined,
  renderContent: (
    el: HTMLElement,
    markdown: string,
    options?: RenderContentOptions,
  ) => Promise<void>,
): Promise<void> {
  const autoAttachedNotePath = turnRequest?.currentNotePath;
  const textTarget = autoAttachedNotePath
    ? el.ownerDocument.win.createDiv()
    : el;

  if (autoAttachedNotePath) {
    el.empty();
    const badges = el.ownerDocument.win.createDiv();
    badges.className = 'pivi-user-context-badges';
    badges.appendChild(createContextBadgeElement(
      { kind: 'file', token: `[[${autoAttachedNotePath}]]`, path: autoAttachedNotePath },
      {
        inline: true,
        onClick: () => { void host.app.workspace.openLinkText(autoAttachedNotePath, ''); },
      },
    ));
    el.append(badges, textTarget);
  }

  if (renderMentionBadges(
    textTarget,
    text,
    buildMentionBadgeContext(host, turnRequest),
    host.app,
  )) {
    return;
  }
  await renderContent(textTarget, text);
}

export async function renderMarkdownContent(
  host: MarkdownContentRenderHost,
  el: HTMLElement,
  markdown: string,
  options?: RenderContentOptions,
): Promise<void> {
  el.addClass('markdown-rendered');
  el.addClass('pivi-markdown-rendered');
  el.empty();

  try {
    const normalizedMarkdown = normalizeObsidianAppLinksInMarkdown(markdown);
    const renderMarkdown = options?.deferMath
      ? escapeMathDelimitersForStreaming(normalizedMarkdown)
      : normalizedMarkdown;
    await MarkdownRenderer.render(
      host.app,
      renderMarkdown,
      el,
      options?.sourcePath ?? getMarkdownRenderSourcePath(host),
      options?.component ?? host.component,
    );

    el.querySelectorAll<HTMLElement>('ul.contains-task-list').forEach((list) => {
      list.classList.add('pivi-markdown-task-list');
    });
    el.querySelectorAll<HTMLElement>('li.task-list-item').forEach((item) => {
      item.classList.add('pivi-markdown-task-item');
    });

    const component = options?.component ?? host.component;
    component.register(enhanceMermaidDiagrams(el));

    el.querySelectorAll('pre').forEach((pre) => {
      // Obsidian keeps YAML frontmatter in a hidden pre as a metadata source.
      // Treating that placeholder as a normal code block creates an empty shell
      // with a misleading YAML copy label in isolated Markdown previews.
      if (pre.classList.contains('frontmatter')) return;
      if (pre.parentElement?.classList.contains('pivi-code-wrapper')) return;

      const doc = getActiveDocument(pre);
      const wrapper = doc.win.createDiv();
      wrapper.className = 'pivi-code-wrapper';
      pre.parentElement?.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);

      const code = pre.querySelector('code[class*="language-"]');
      if (code) {
        const match = code.className.match(/language-(\w+)/);
        if (match?.[1]) {
          const language = match[1];
          wrapper.classList.add('pivi-code-wrapper--language');
          const label = doc.win.createSpan();
          label.className = 'pivi-code-lang-label';
          label.textContent = language;
          wrapper.appendChild(label);
          label.addEventListener('click', () => {
            runRendererAction(async () => {
              const originalLabel = language;
              if (!originalLabel) return;

              try {
                await navigator.clipboard.writeText(code.textContent || '');
                label.textContent = t('common.copied');
                window.setTimeout(() => { label.textContent = originalLabel; }, 1500);
              } catch {
                // Clipboard API may fail in non-secure contexts
              }
            });
          });
        }
      }

      const copyBtn = pre.querySelector('.copy-code-button');
      if (copyBtn) {
        copyBtn.classList.add('pivi-code-copy-button');
        wrapper.appendChild(copyBtn);
      }
    });

    if (renderMarkdown.includes('[[') || renderMarkdown.includes('`')) {
      processFileLinks(host.app, el);
    }

    trimEmptyEdgeParagraphs(el);
  } catch {
    el.createDiv({
      cls: 'pivi-render-error',
      text: t('chat.stream.renderFailed'),
    });
  }
}
