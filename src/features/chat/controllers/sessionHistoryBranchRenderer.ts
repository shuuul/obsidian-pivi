import { Notice, setIcon } from 'obsidian';

import { AgentServices } from '../../../core/agent/AgentServices';

function runSessionAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

export function formatLeafLabel(
  leaf: { leafId: string; label?: string | null },
  index?: number,
): string {
  const label = leaf.label?.trim();
  if (label) {
    return label;
  }
  const ordinal = typeof index === 'number' ? ` ${index + 1}` : '';
  return `Branch${ordinal} · ${leaf.leafId.slice(0, 7)}`;
}

export function formatLeafMeta(
  leaf: { leafId: string; updatedAt: number; messageCount?: number; depth?: number },
  formatDate: (time: number) => string,
): string {
  const parts = [formatDate(leaf.updatedAt), `Leaf ${leaf.leafId.slice(0, 7)}`];
  if (typeof leaf.messageCount === 'number') {
    parts.push(`${leaf.messageCount} message${leaf.messageCount === 1 ? '' : 's'}`);
  }
  if (typeof leaf.depth === 'number' && leaf.depth > 0) {
    parts.push(`${leaf.depth} step${leaf.depth === 1 ? '' : 's'} deep`);
  }
  return parts.join(' · ');
}

export interface RenderHistoryBranchesOptions {
  itemContainer: HTMLElement;
  expandBtn: HTMLElement;
  sessionId: string;
  sessionFile?: string;
  activeLeafId?: string | null;
  isCurrent: boolean;
  formatDate: (time: number) => string;
  isNewTabModifierClick: (event: MouseEvent) => boolean;
  runHistoryAction: (action: () => Promise<void> | void, errorMessage: string) => Promise<void>;
  onSelectSession: (id: string, leafId?: string | null) => Promise<void>;
  onOpenSessionInNewTab?: (id: string, activate?: boolean, leafId?: string | null) => Promise<void>;
}

export function renderHistoryBranches(options: RenderHistoryBranchesOptions): void {
  const branchesContainer = options.itemContainer.createDiv({
    cls: 'obsius2-history-branches obsius2-hidden',
  });

  const loadAndRenderBranches = async () => {
    const sessionFile = options.sessionFile;
    if (!sessionFile) return;

    branchesContainer.empty();
    const loadingEl = branchesContainer.createDiv({ cls: 'obsius2-history-branches-loading' });
    setIcon(loadingEl, 'loader-2');
    loadingEl.createSpan({ text: ' Loading branches...' });

    try {
      const service = AgentServices.getSessionHistoryService();
      if (!service.listLeaves) {
        return;
      }
      const leaves = await service.listLeaves(sessionFile, null);
      branchesContainer.empty();

      if (!leaves || leaves.length === 0) {
        branchesContainer.createDiv({
          cls: 'obsius2-history-branches-empty',
          text: 'No branches found',
        });
        return;
      }

      const sortedLeaves = [...leaves].sort((a, b) => b.updatedAt - a.updatedAt);
      for (const [leafIndex, leaf] of sortedLeaves.entries()) {
        const isActiveLeaf = options.activeLeafId === leaf.leafId;
        const leafLabelText = formatLeafLabel(leaf, leafIndex);
        const leafItem = branchesContainer.createDiv({
          cls: `obsius2-history-branch-item${isActiveLeaf ? ' active' : ''}`,
        });
        leafItem.setAttribute(
          'title',
          isActiveLeaf && options.isCurrent
            ? 'Active leaf in the current tab'
            : isActiveLeaf
              ? 'Saved active leaf for this session'
            : 'Click to switch the current tab to this leaf. Ctrl/Cmd-click or middle-click opens it in a new tab.',
        );

        const leafIcon = leafItem.createDiv({ cls: 'obsius2-history-branch-icon' });
        setIcon(leafIcon, 'git-branch');

        const leafContent = leafItem.createDiv({ cls: 'obsius2-history-branch-content' });
        const leafHeader = leafContent.createDiv({ cls: 'obsius2-history-branch-header' });
        const leafLabel = leafHeader.createDiv({
          cls: 'obsius2-history-branch-label',
          text: leafLabelText,
        });
        leafLabel.setAttribute('title', leaf.label || `Branch ${leaf.leafId}`);

        if (isActiveLeaf) {
          leafHeader.createDiv({
            cls: 'obsius2-history-branch-active-marker',
            text: options.isCurrent ? 'Active' : 'Saved leaf',
          });
        }

        leafHeader.createDiv({
          cls: 'obsius2-history-branch-date',
          text: formatLeafMeta(leaf, options.formatDate),
        });

        leafContent.createDiv({
          cls: 'obsius2-history-branch-preview',
          text: leaf.messagePreview || 'Empty branch',
        });

        leafItem.addEventListener('click', (e) => {
          e.stopPropagation();
          if (options.isNewTabModifierClick(e) && options.onOpenSessionInNewTab) {
            e.preventDefault();
            runSessionAction(
              () => options.runHistoryAction(
                () => options.onOpenSessionInNewTab?.(options.sessionId, true, leaf.leafId),
                'Failed to load branch',
              ),
              'Failed to load branch',
            );
            return;
          }

          runSessionAction(
            () => options.runHistoryAction(
              () => options.onSelectSession(options.sessionId, leaf.leafId),
              'Failed to load branch',
            ),
            'Failed to load branch',
          );
        });

        if (options.onOpenSessionInNewTab) {
          leafItem.addEventListener('auxclick', (e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
            runSessionAction(
              () => options.runHistoryAction(
                () => options.onOpenSessionInNewTab?.(options.sessionId, true, leaf.leafId),
                'Failed to load branch',
              ),
              'Failed to load branch',
            );
          });
        }
      }
    } catch (error) {
      console.error('Obsius: failed to load branches', error);
      branchesContainer.empty();
      branchesContainer.createDiv({
        cls: 'obsius2-history-branches-error',
        text: 'Failed to load branches',
      });
    }
  };

  options.expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isCollapsed = branchesContainer.hasClass('obsius2-hidden');
    if (isCollapsed) {
      branchesContainer.removeClass('obsius2-hidden');
      options.expandBtn.addClass('expanded');
      setIcon(options.expandBtn, 'chevron-down');

      const hasItems = branchesContainer.querySelectorAll('.obsius2-history-branch-item').length > 0;
      if (!hasItems) {
        runSessionAction(loadAndRenderBranches, 'Failed to load branch');
      }
    } else {
      branchesContainer.addClass('obsius2-hidden');
      options.expandBtn.removeClass('expanded');
      setIcon(options.expandBtn, 'chevron-right');
    }
  });
}
