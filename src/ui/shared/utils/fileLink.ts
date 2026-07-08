/**
 * Pivi - File Link Utilities
 *
 * Detects Obsidian wikilinks [[path/to/file]] in rendered content and makes
 * them clickable to open the file in Obsidian.
 */

import type { App, Component, TFile, WorkspaceLeaf } from 'obsidian';

import { getVaultFileByPath, revealWorkspaceLeaf } from './obsidianCompat';

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

function resolveFileInVault(app: App, linkPath: string): TFile | null {
  const file = app.metadataCache.getFirstLinkpathDest(linkPath, '');
  if (file) {
    return file;
  }

  const directFile = getVaultFileByPath(app, linkPath);
  if (directFile) {
    return directFile;
  }

  if (!linkPath.endsWith('.md')) {
    const withExt = getVaultFileByPath(app, linkPath + '.md');
    if (withExt) {
      return withExt;
    }
  }

  return null;
}

function fileExistsInVault(app: App, linkPath: string): boolean {
  return resolveFileInVault(app, linkPath) !== null;
}

function extractLinkPathFromTarget(linkTarget: string): string {
  const subpathIndex = linkTarget.search(/[#^]/);
  return subpathIndex >= 0 ? linkTarget.slice(0, subpathIndex) : linkTarget;
}

function extractSubpathFromTarget(linkTarget: string): string {
  const subpathIndex = linkTarget.search(/[#^]/);
  return subpathIndex >= 0 ? linkTarget.slice(subpathIndex) : '';
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
  link.className = 'pivi-file-link internal-link';
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

function getLeafFilePath(leaf: WorkspaceLeaf): string | null {
  const view = leaf.view as { file?: { path?: string } | null } | undefined;
  return view?.file?.path ?? null;
}

function findOpenLeafForFile(app: App, file: TFile): WorkspaceLeaf | null {
  let found: WorkspaceLeaf | null = null;
  const visit = (leaf: WorkspaceLeaf): void => {
    if (!found && getLeafFilePath(leaf) === file.path) {
      found = leaf;
    }
  };

  const workspace = app.workspace as App['workspace'] & {
    iterateAllLeaves?: (callback: (leaf: WorkspaceLeaf) => unknown) => void;
  };
  if (typeof workspace.iterateAllLeaves === 'function') {
    workspace.iterateAllLeaves(visit);
  } else {
    for (const leaf of app.workspace.getLeavesOfType('markdown')) {
      visit(leaf);
    }
  }

  return found;
}

async function revealExistingLinkTarget(
  app: App,
  leaf: WorkspaceLeaf,
  file: TFile,
  linkTarget: string,
): Promise<void> {
  await revealWorkspaceLeaf(app.workspace, leaf);
  const subpath = extractSubpathFromTarget(linkTarget);
  if (subpath) {
    await leaf.openFile(file, { active: true, state: { subpath } });
  }
}

function openLinkTarget(app: App, linkTarget: string): void {
  if (!linkTarget) return;
  const file = resolveFileInVault(app, extractLinkPathFromTarget(linkTarget));
  const openLeaf = file ? findOpenLeafForFile(app, file) : null;
  if (file && openLeaf) {
    void revealExistingLinkTarget(app, openLeaf, file, linkTarget).catch(() => {
      void app.workspace.openLinkText(linkTarget, '', 'tab');
    });
    return;
  }
  void app.workspace.openLinkText(linkTarget, '', 'tab');
}

function repairRenderedInternalLink(app: App, link: HTMLAnchorElement): void {
  const linkTarget = readLinkTargetFromElement(link);
  if (!linkTarget) return;

  const linkPath = extractLinkPathFromTarget(linkTarget);
  if (!linkPath || !fileExistsInVault(app, linkPath)) return;

  link.classList.add('pivi-file-link');
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

  embedEl.addClass('pivi-clickable-embed');
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
 * Handles both our custom .pivi-file-link and Obsidian's .internal-link.
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
      '.pivi-file-link, .internal-link, .pivi-clickable-embed'
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
    const link = target.closest<HTMLElement>('.pivi-clickable-embed');
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

function processInlineCodeVaultPaths(app: App, container: HTMLElement): void {
  container.querySelectorAll('code').forEach((codeEl) => {
    if (codeEl.parentElement?.tagName === 'PRE') return;

    const text = codeEl.textContent;
    if (!text || text.includes('[[')) return;

    const trimmed = text.trim();
    if (!trimmed || trimmed.endsWith('/')) return;

    const file = resolveFileInVault(app, trimmed);
    if (!file) return;

    const link = createWikilink(codeEl.ownerDocument, file.path, file.basename);
    codeEl.replaceWith(link);
  });
}

function shouldSkipTextNode(parent: HTMLElement): boolean {
  const tagName = parent.tagName.toUpperCase();
  if (tagName === 'PRE' || tagName === 'CODE' || tagName === 'A') {
    return true;
  }

  return !!parent.closest('pre, code, a, .pivi-file-link, .internal-link, .pivi-clickable-embed');
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

  // Also catch plain vault file paths written inside inline code (e.g. `folder/note.md`).
  processInlineCodeVaultPaths(app, container);

  // Modifying DOM while walking causes issues, so collect first
  for (const textNode of collectTextNodesWithLinks(container)) {
    processTextNode(app, textNode);
  }
}
