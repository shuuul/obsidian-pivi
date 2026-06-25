/**
 * Obsius - File Link Utilities
 *
 * Detects Obsidian wikilinks [[path/to/file]] in rendered content and makes
 * them clickable to open the file in Obsidian.
 */

import type { App, Component } from 'obsidian';

import { getVaultFileByPath } from './obsidianCompat';

/**
 * Regex pattern to match Obsidian wikilinks in text content.
 *
 * Matches:
 * - Standard wikilinks: [[note]] or [[folder/note]]
 * - Wikilinks with display text: [[note|display text]]
 * - Wikilinks with headings: [[note#heading]]
 * - Wikilinks with block references: [[note^block]]
 *
 * Image embeds ![[image.png]] are matched separately so their visible syntax can
 * stay intact while becoming clickable.
 */
const WIKILINK_PATTERN_SOURCE = '(?<!!)\\[\\[([^\\]|#^]+)(?:#[^\\]|]+)?(?:\\^[^\\]|]+)?(?:\\|[^\\]]+)?\\]\\]';
const EMBED_PATTERN_SOURCE = '!\\[\\[([^\\]|#^]+)(?:#[^\\]|]+)?(?:\\^[^\\]|]+)?(?:\\|[^\\]]+)?\\]\\]';
const OBSIDIAN_APP_MARKDOWN_LINK_PATTERN = /(!?)\[([^\]\n]*)\]\((app:\/\/obsidian\.md\/[^)\s]+|obsidian:\/\/[^)\s]+)\)/g;

/** Creates a fresh regex instance to avoid global state issues */
function createWikilinkPattern(): RegExp {
  return new RegExp(WIKILINK_PATTERN_SOURCE, 'g');
}

function createEmbedPattern(): RegExp {
  return new RegExp(EMBED_PATTERN_SOURCE, 'g');
}

interface WikilinkMatch {
  index: number;
  fullMatch: string;
  linkPath: string;
  linkTarget: string;
  displayText: string;
}

function buildWikilinkMatch(
  fullMatch: string,
  linkPath: string,
  index: number,
  isEmbed = false,
): WikilinkMatch {
  const pipeIndex = fullMatch.lastIndexOf('|');
  const displayText = isEmbed
    ? fullMatch
    : (pipeIndex > 0 ? fullMatch.slice(pipeIndex + 1, -2) : linkPath);

  return {
    index,
    fullMatch,
    linkPath,
    linkTarget: extractLinkTarget(fullMatch),
    displayText,
  };
}

export function extractLinkTarget(fullMatch: string): string {
  const inner = fullMatch.startsWith('![[')
    ? fullMatch.slice(3, -2)
    : fullMatch.slice(2, -2);
  const pipeIndex = inner.indexOf('|');
  return pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner;
}

function collectLinkMatches(
  app: App,
  text: string,
  pattern: RegExp,
  isEmbed: boolean,
): WikilinkMatch[] {
  const matches: WikilinkMatch[] = [];

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const fullMatch = match[0];
    const linkPath = match[1];

    if (!fileExistsInVault(app, linkPath)) continue;

    matches.push(buildWikilinkMatch(fullMatch, linkPath, match.index, isEmbed));
  }

  return matches;
}

/**
 * Finds all wikilinks in text that exist in the vault.
 * Sorted by index descending for end-to-start processing.
 */
function findWikilinks(app: App, text: string): WikilinkMatch[] {
  const matches = [
    ...collectLinkMatches(app, text, createWikilinkPattern(), false),
    ...collectLinkMatches(app, text, createEmbedPattern(), true),
  ];
  return matches.sort((a, b) => b.index - a.index);
}

function fileExistsInVault(app: App, linkPath: string): boolean {
  const file = app.metadataCache.getFirstLinkpathDest(linkPath, '');
  if (file) {
    return true;
  }

  const directFile = getVaultFileByPath(app, linkPath);
  if (directFile) {
    return true;
  }

  if (!linkPath.endsWith('.md')) {
    const withExt = getVaultFileByPath(app, linkPath + '.md');
    if (withExt) {
      return true;
    }
  }

  return false;
}

function extractLinkPathFromTarget(linkTarget: string): string {
  const subpathIndex = linkTarget.search(/[#^]/);
  return subpathIndex >= 0 ? linkTarget.slice(0, subpathIndex) : linkTarget;
}

function getPathBasename(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
}

function shouldIncludeWikilinkAlias(linkTarget: string, displayText: string): boolean {
  const trimmedDisplay = displayText.trim();
  if (!trimmedDisplay) return false;

  const pathOnly = extractLinkPathFromTarget(linkTarget);
  const basename = getPathBasename(pathOnly);
  const withoutMd = pathOnly.endsWith('.md') ? pathOnly.slice(0, -3) : pathOnly;
  const basenameWithoutMd = basename.endsWith('.md') ? basename.slice(0, -3) : basename;

  return ![
    linkTarget,
    pathOnly,
    withoutMd,
    basename,
    basenameWithoutMd,
  ].includes(trimmedDisplay);
}

function toObsidianMarkdownLink(linkTarget: string, displayText: string, isEmbed: boolean): string {
  if (isEmbed) {
    return `![[${linkTarget}]]`;
  }

  const alias = shouldIncludeWikilinkAlias(linkTarget, displayText)
    ? `|${displayText.trim()}`
    : '';
  return `[[${linkTarget}${alias}]]`;
}

export function normalizeObsidianAppLinksInMarkdown(markdown: string): string {
  return markdown.replace(
    OBSIDIAN_APP_MARKDOWN_LINK_PATTERN,
    (fullMatch, embedMarker: string, displayText: string, uri: string) => {
      const linkTarget = normalizeObsidianUriTarget(uri);
      if (!linkTarget) return fullMatch;
      return toObsidianMarkdownLink(linkTarget, displayText, embedMarker === '!');
    },
  );
}

/**
 * Creates a link element for a wikilink.
 * Click handling is done via event delegation in registerFileLinkHandler.
 */
function createWikilink(
  ownerDocument: Document,
  linkTarget: string,
  displayText: string
): HTMLElement {
  const link = ownerDocument.createElement('a');
  link.className = 'obsius2-file-link internal-link';
  link.textContent = displayText;
  link.setAttribute('data-href', linkTarget);
  link.setAttribute('href', linkTarget);
  return link;
}

function normalizeObsidianUriTarget(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    if (url.protocol === 'app:' && url.hostname === 'obsidian.md') {
      return decodeURIComponent(url.pathname.replace(/^\//, ''));
    }
    if (url.protocol === 'obsidian:') {
      return decodeURIComponent(url.searchParams.get('file') ?? '');
    }
  } catch {
    // Not a URL; treat as a vault path.
  }

  return trimmed;
}

function readLinkTargetFromElement(element: Element): string {
  const htmlElement = element as HTMLElement;
  const rawTarget = htmlElement.dataset?.href
    || element.getAttribute('data-href')
    || element.getAttribute('data-path')
    || element.getAttribute('href')
    || element.getAttribute('src')
    || element.getAttribute('alt')
    || '';
  return normalizeObsidianUriTarget(rawTarget);
}

function openLinkTarget(app: App, linkTarget: string): void {
  if (!linkTarget) return;
  void app.workspace.openLinkText(linkTarget, '', 'tab');
}

function repairRenderedInternalLink(app: App, link: HTMLAnchorElement): void {
  const linkTarget = readLinkTargetFromElement(link);
  if (!linkTarget) return;

  const linkPath = extractLinkPathFromTarget(linkTarget);
  if (!linkPath || !fileExistsInVault(app, linkPath)) return;

  link.classList.add('obsius2-file-link');
  link.classList.add('internal-link');
  link.setAttribute('data-href', linkTarget);
  link.setAttribute('href', linkTarget);
  if (!(link.textContent || '').trim()) {
    link.textContent = linkTarget;
  }
}

function repairRenderedEmbed(app: App, embedEl: HTMLElement): void {
  const linkTarget = readLinkTargetFromElement(embedEl);
  const linkPath = extractLinkPathFromTarget(linkTarget);
  if (!linkPath || !fileExistsInVault(app, linkPath)) return;

  embedEl.addClass('obsius2-clickable-embed');
  embedEl.setAttribute('data-href', linkTarget);
  embedEl.setAttribute('role', 'link');
  embedEl.setAttribute('tabindex', '0');
  if (!embedEl.getAttribute('aria-label')) {
    embedEl.setAttribute('aria-label', `Open ${linkTarget} in Obsidian`);
  }
}

/**
 * Registers a delegated click handler for file links on a container.
 * Should be called once on the messages container.
 * Handles both our custom .obsius2-file-link and Obsidian's .internal-link.
 */
export function registerFileLinkHandler(
  app: App,
  container: HTMLElement,
  component: Component
): void {
  component.registerDomEvent(container, 'click', (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    // Handle both our links and Obsidian's internal links
    const link = target.closest<HTMLElement>(
      '.obsius2-file-link, .internal-link, .obsius2-clickable-embed'
    );

    if (link) {
      event.preventDefault();
      openLinkTarget(app, readLinkTargetFromElement(link));
    }
  });

  component.registerDomEvent(container, 'keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    const target = event.target as HTMLElement;
    const link = target.closest<HTMLElement>('.obsius2-clickable-embed');
    if (link) {
      event.preventDefault();
      openLinkTarget(app, readLinkTargetFromElement(link));
    }
  });
}

function processRenderedEmbeds(app: App, container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('.internal-embed, .media-embed, .image-embed').forEach((embedEl) => {
    repairRenderedEmbed(app, embedEl);

    embedEl.querySelectorAll<HTMLElement>('img').forEach((imgEl) => {
      if (!imgEl.getAttribute('data-href')) {
        const embedTarget = embedEl.getAttribute('data-href');
        if (embedTarget) {
          imgEl.setAttribute('data-href', embedTarget);
        }
      }
      repairRenderedEmbed(app, imgEl);
    });
  });
}

function processInlineLinkText(app: App, container: HTMLElement, codeEl: HTMLElement): void {
  const text = codeEl.textContent;
  if (!text || !text.includes('[[')) return;

  const matches = findWikilinks(app, text);
  if (matches.length === 0) return;

  codeEl.textContent = '';
  codeEl.appendChild(buildFragmentWithLinks(container.ownerDocument, text, matches));
}

function shouldSkipTextNode(parent: HTMLElement): boolean {
  const tagName = parent.tagName.toUpperCase();
  if (tagName === 'PRE' || tagName === 'CODE' || tagName === 'A') {
    return true;
  }

  return !!parent.closest('pre, code, a, .obsius2-file-link, .internal-link, .obsius2-clickable-embed');
}

function collectTextNodesWithLinks(container: HTMLElement): Text[] {
  const walker = container.ownerDocument.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        if (shouldSkipTextNode(parent)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }

  return textNodes;
}

function buildFragmentWithLinks(ownerDocument: Document, text: string, matches: WikilinkMatch[]): DocumentFragment {
  const fragment = ownerDocument.createDocumentFragment();
  let currentIndex = text.length;

  for (const { index, fullMatch, linkTarget, displayText } of matches) {
    const endIndex = index + fullMatch.length;

    if (endIndex < currentIndex) {
      fragment.insertBefore(
        ownerDocument.createTextNode(text.slice(endIndex, currentIndex)),
        fragment.firstChild
      );
    }

    fragment.insertBefore(createWikilink(ownerDocument, linkTarget, displayText), fragment.firstChild);
    currentIndex = index;
  }

  if (currentIndex > 0) {
    fragment.insertBefore(
      ownerDocument.createTextNode(text.slice(0, currentIndex)),
      fragment.firstChild
    );
  }

  return fragment;
}

function processTextNode(app: App, node: Text): boolean {
  const text = node.textContent;
  if (!text || !text.includes('[[')) return false;

  const matches = findWikilinks(app, text);
  if (matches.length === 0) return false;

  node.parentNode?.replaceChild(buildFragmentWithLinks(node.ownerDocument, text, matches), node);
  return true;
}

/**
 * Call after MarkdownRenderer.renderMarkdown().
 * Catches wikilinks that remain as raw text after rendering, especially inline code spans.
 */
export function processFileLinks(app: App, container: HTMLElement): void {
  if (!app || !container) return;

  processRenderedEmbeds(app, container);

  // Repair resolved internal links and normalize Obsidian app URIs back to vault paths.
  container.querySelectorAll('a.internal-link, a[href^="app://obsidian.md/"], a[href^="obsidian://"]').forEach((linkEl) => {
    repairRenderedInternalLink(app, linkEl as HTMLAnchorElement);
  });

  // Wikilinks in inline code aren't rendered by Obsidian's MarkdownRenderer
  container.querySelectorAll('code').forEach((codeEl) => {
    if (codeEl.parentElement?.tagName === 'PRE') return;
    processInlineLinkText(app, container, codeEl);
  });

  // Modifying DOM while walking causes issues, so collect first
  for (const textNode of collectTextNodesWithLinks(container)) {
    processTextNode(app, textNode);
  }
}
