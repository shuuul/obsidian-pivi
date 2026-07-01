import { Notice, setIcon } from 'obsidian';

import type { LeafSummary } from '../../../core/session/types';

function runSessionAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

export function formatLeafLabel(
  leaf: { messagePreview?: string | null },
  _index?: number,
): string {
  return leaf.messagePreview?.trim() || 'Session state';
}

export function formatLeafMeta(
  leaf: { messageCount?: number; turnCount?: number; depth?: number },
  _formatDate: (time: number) => string,
): string {
  const turns = leaf.turnCount ?? leaf.depth ?? leaf.messageCount ?? 0;
  return `${turns} ${turns === 1 ? 'turn' : 'turns'}`;
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
  listSessionLeaves: (sessionFile: string) => Promise<LeafSummary[]>;
}

export function renderHistoryBranches(options: RenderHistoryBranchesOptions): void {
  const branchesContainer = options.itemContainer.createDiv({
    cls: 'pivi-history-branches pivi-hidden',
  });

  const loadAndRenderBranches = async () => {
    const sessionFile = options.sessionFile;
    if (!sessionFile) return;

    branchesContainer.empty();
    const loadingEl = branchesContainer.createDiv({ cls: 'pivi-history-branches-loading' });
    setIcon(loadingEl, 'loader-2');
    loadingEl.createSpan({ text: ' Loading session states...' });

    try {
      const leaves = await options.listSessionLeaves(sessionFile);
      branchesContainer.empty();

      if (!leaves || leaves.length === 0) {
        branchesContainer.createDiv({
          cls: 'pivi-history-branches-empty',
          text: 'No session states found',
        });
        return;
      }

      const sortedLeaves = [...leaves].sort((a, b) => b.updatedAt - a.updatedAt);
      for (const [leafIndex, leaf] of sortedLeaves.entries()) {
        const isActiveLeaf = options.activeLeafId === leaf.leafId;
        const leafLabelText = formatLeafLabel(leaf, leafIndex);
        const leafItem = branchesContainer.createDiv({
          cls: `pivi-history-branch-item${isActiveLeaf ? ' active' : ''}`,
        });
        leafItem.setAttribute(
          'title',
          isActiveLeaf && options.isCurrent
            ? 'Active state in the current tab'
            : isActiveLeaf
              ? 'Saved state for this session'
            : 'Click to restore the current tab to this session state. Ctrl/Cmd-click or middle-click opens it in a new tab.',
        );

        const leafIcon = leafItem.createDiv({ cls: 'pivi-history-branch-icon' });
        setIcon(leafIcon, 'message-square');

        const leafContent = leafItem.createDiv({ cls: 'pivi-history-branch-content' });
        const leafHeader = leafContent.createDiv({ cls: 'pivi-history-branch-header' });
        const leafLabel = leafHeader.createDiv({
          cls: 'pivi-history-branch-label',
          text: leafLabelText,
        });
        leafLabel.setAttribute('title', leaf.messagePreview || 'Session state');

        if (isActiveLeaf) {
          leafHeader.createDiv({
            cls: 'pivi-history-branch-active-marker',
            text: options.isCurrent ? 'Active' : 'Saved',
          });
        }

        leafHeader.createDiv({
          cls: 'pivi-history-branch-date',
          text: formatLeafMeta(leaf, options.formatDate),
        });

        leafItem.addEventListener('click', (e) => {
          e.stopPropagation();
          if (options.isNewTabModifierClick(e) && options.onOpenSessionInNewTab) {
            e.preventDefault();
            runSessionAction(
              () => options.runHistoryAction(
                () => options.onOpenSessionInNewTab?.(options.sessionId, true, leaf.leafId),
                'Failed to load session state',
              ),
              'Failed to load session state',
            );
            return;
          }

          runSessionAction(
            () => options.runHistoryAction(
              () => options.onSelectSession(options.sessionId, leaf.leafId),
              'Failed to load session state',
            ),
            'Failed to load session state',
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
                'Failed to load session state',
              ),
              'Failed to load session state',
            );
          });
        }
      }
    } catch (error) {
      console.error('Pivi: failed to load branches', error);
      branchesContainer.empty();
      branchesContainer.createDiv({
        cls: 'pivi-history-branches-error',
        text: 'Failed to load session states',
      });
    }
  };

  options.expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isCollapsed = branchesContainer.hasClass('pivi-hidden');
    if (isCollapsed) {
      branchesContainer.removeClass('pivi-hidden');
      options.expandBtn.addClass('expanded');
      setIcon(options.expandBtn, 'chevron-down');

      const hasItems = branchesContainer.querySelectorAll('.pivi-history-branch-item').length > 0;
      if (!hasItems) {
        runSessionAction(loadAndRenderBranches, 'Failed to load session state');
      }
    } else {
      branchesContainer.addClass('pivi-hidden');
      options.expandBtn.removeClass('expanded');
      setIcon(options.expandBtn, 'chevron-right');
    }
  });
}
