import type { App, Component } from 'obsidian';
import { MarkdownRenderer } from 'obsidian';

import type { PiviChatHost } from '@/app/hostContracts';
import { t } from '@/i18n';
import type { MentionBadgeParseContext } from '@/ui/shared/mention/mentionBadgeTypes';
import { buildExternalContextLookupFromPaths } from '@/ui/shared/mention/parseMessageMentions';
import { renderMentionBadges } from '@/ui/shared/mention/renderMentionBadges';

import { getActiveDocument } from '../../shared/dom';
import { buildExternalContextDisplayEntries } from '../../shared/utils/externalContext';
import { externalContextScanner } from '../../shared/utils/externalContextScanner';
import {
  normalizeObsidianAppLinksInMarkdown,
  processFileLinks,
} from '../../shared/utils/fileLink';
import { escapeMathDelimitersForStreaming } from '../../shared/utils/markdownMath';
import { trimEmptyEdgeParagraphs } from './markdownContentCleanup';
import { runRendererAction } from './messageRendererActions';
import type { RenderContentOptions } from './messageRendererTypes';

export interface MessageRendererMarkdownHost {
  readonly app: App;
  readonly plugin: PiviChatHost;
  readonly component: Component;
}

export function buildMentionBadgeContext(host: MessageRendererMarkdownHost): MentionBadgeParseContext {
  const mcpManager = host.plugin.getPiWorkspace()?.mcpServerManager ?? null;
  const mcpServerNames = new Set(
    (mcpManager?.getServers() ?? []).map((server) => server.name),
  );
  const skillCommandNames = new Set(
    host.plugin
      .getPiWorkspace()
      ?.skillProvider.listSkills()
      .map((skill) => skill.name) ?? [],
  );
  const externalPaths = host.plugin.settings.persistentExternalContextPaths ?? [];

  return {
    app: host.app,
    mcpServerNames,
    skillCommandNames,
    externalContextEntries: buildExternalContextDisplayEntries(externalPaths),
    getExternalContextLookup: buildExternalContextLookupFromPaths(
      externalPaths,
      (roots) => externalContextScanner.scanPaths(roots),
    ),
  };
}

export function getMarkdownRenderSourcePath(host: MessageRendererMarkdownHost): string {
  return host.app.workspace.getActiveFile()?.path ?? '';
}

export async function renderUserMessageText(
  host: MessageRendererMarkdownHost,
  el: HTMLElement,
  text: string,
  renderContent: (
    el: HTMLElement,
    markdown: string,
    options?: RenderContentOptions,
  ) => Promise<void>,
): Promise<void> {
  if (renderMentionBadges(el, text, buildMentionBadgeContext(host))) {
    return;
  }
  await renderContent(el, text);
}

export async function renderMarkdownContent(
  host: MessageRendererMarkdownHost,
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
      getMarkdownRenderSourcePath(host),
      host.component,
    );

    el.querySelectorAll('pre').forEach((pre) => {
      if (pre.parentElement?.classList.contains('pivi-code-wrapper')) return;

      const doc = getActiveDocument(pre);
      const wrapper = doc.createElement('div');
      wrapper.className = 'pivi-code-wrapper';
      pre.parentElement?.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);

      const code = pre.querySelector('code[class*="language-"]');
      if (code) {
        const match = code.className.match(/language-(\w+)/);
        if (match) {
          wrapper.classList.add('has-language');
          const label = doc.createElement('span');
          label.className = 'pivi-code-lang-label';
          label.textContent = match[1];
          wrapper.appendChild(label);
          label.addEventListener('click', () => {
            runRendererAction(async () => {
              const originalLabel = match[1];
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