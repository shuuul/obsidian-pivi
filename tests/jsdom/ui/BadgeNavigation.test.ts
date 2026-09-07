import type { App, WorkspaceLeaf } from 'obsidian';
import { Notice, TFile, TFolder } from 'obsidian';

import { registerSlashBadgeNavigation } from '@/app/hostPlatform';
import { createMentionVaultLookup } from '@/ui/shared/mention/createMentionVaultLookup';
import { createInlineMentionBadge } from '@/ui/shared/mention/inlineMentionBadgeDom';
import { renderMentionBadges } from '@/ui/shared/mention/renderMentionBadges';
import { openLinkTarget } from '@/ui/shared/utils/fileLink';
import { openNativeSettingsPage } from '@/ui/shared/utils/obsidianPrivateApi';

function fixture() {
  const file = Object.assign(new TFile(), { path: 'notes/Long file name.md', basename: 'Long file name' });
  const folder = Object.assign(new TFolder(), { path: 'notes', name: 'notes' });
  const revealInFolder = jest.fn();
  const setCollapsed = jest.fn();
  const explorer = { view: { revealInFolder, fileItems: { notes: { setCollapsed } } } };
  const leaves: WorkspaceLeaf[] = [];
  const workspace = {
    iterateAllLeaves: (visit: (leaf: WorkspaceLeaf) => void) => leaves.forEach(visit),
    getLeavesOfType: () => [explorer],
    revealLeaf: jest.fn().mockResolvedValue(undefined),
    openLinkText: jest.fn().mockResolvedValue(undefined),
  };
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => [file, folder].find(f => f.path === path) ?? null,
      getFiles: () => [file],
      getAllLoadedFiles: () => [folder, file],
    },
    metadataCache: { getFirstLinkpathDest: () => file },
    workspace,
  } as unknown as App;
  return { app, file, folder, workspace, leaves, explorer, revealInFolder, setCollapsed };
}

describe('badge navigation', () => {
  afterEach(() => document.body.replaceChildren());

  it.each([false, true])('reuses an existing file tab, including deferred=%s', async (deferred) => {
    const { app, file, leaves, workspace } = fixture();
    const leaf = {
      view: deferred ? {} : { file },
      getViewState: () => ({ type: 'markdown', state: { file: file.path } }),
    } as unknown as WorkspaceLeaf;
    leaves.push(leaf);
    await openLinkTarget(app, file.path);
    expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
    expect(workspace.openLinkText).not.toHaveBeenCalled();
  });

  it.each(['composer', 'history'])('opens a new tab from %s without replacing another note', async (surface) => {
    const { app, file, workspace } = fixture();
    const root = document.body.createDiv();
    if (surface === 'composer') {
      root.append(createInlineMentionBadge({ kind: 'file', raw: `@${file.path}`, path: file.path, label: file.basename }, app));
    } else {
      renderMentionBadges(root, `@${file.path} `, { vault: createMentionVaultLookup(app), mcpServerNames: new Set() }, app);
    }
    const badge = root.querySelector<HTMLElement>('.pivi-context-badge')!;
    expect(badge.title).toBe(file.path);
    badge.click();
    await Promise.resolve();
    expect(workspace.openLinkText).toHaveBeenCalledWith(file.path, '', 'tab');
  });

  it('does not mistake a deferred sidebar backlink target for a document tab', async () => {
    const { app, file, leaves, workspace } = fixture();
    const sidebar = {};
    Object.assign(workspace, { rightSplit: sidebar });
    leaves.push({
      view: {}, getRoot: () => sidebar,
      getViewState: () => ({ type: 'backlink', state: { file: file.path } }),
    } as unknown as WorkspaceLeaf);
    await openLinkTarget(app, file.path);
    expect(workspace.openLinkText).toHaveBeenCalledWith(file.path, '', 'tab');
    expect(workspace.revealLeaf).not.toHaveBeenCalled();
  });

  it.each(['composer', 'history'])('reveals and expands a folder in Files from %s', async (surface) => {
    const { app, folder, workspace, explorer, revealInFolder, setCollapsed } = fixture();
    const root = document.body.createDiv();
    if (surface === 'composer') {
      root.append(createInlineMentionBadge({ kind: 'folder', raw: '@notes/', path: folder.path, label: 'notes' }, app));
    } else {
      renderMentionBadges(root, '@notes/ ', { vault: createMentionVaultLookup(app), mcpServerNames: new Set() }, app);
    }
    root.querySelector<HTMLElement>('.pivi-context-badge')!.click();
    await Promise.resolve();
    expect(workspace.revealLeaf).toHaveBeenCalledWith(explorer);
    expect(revealInFolder).toHaveBeenCalledWith(folder);
    expect(setCollapsed).toHaveBeenCalledWith(false);
    expect(workspace.openLinkText).not.toHaveBeenCalled();
  });

  it.each(['click', 'Enter', ' '])('navigates command badges in both surfaces with %j, never executing them', async (action) => {
    const { app, workspace } = fixture();
    const navigate = jest.fn().mockResolvedValue(undefined);
    const unregister = registerSlashBadgeNavigation(app, navigate);
    const root = document.body.createDiv();
    root.append(createInlineMentionBadge({ kind: 'skill', raw: '/review', commandName: 'review' }, app));
    const history = root.createDiv();
    renderMentionBadges(history, '/review ', { vault: createMentionVaultLookup(app), mcpServerNames: new Set() }, app);
    for (const badge of root.querySelectorAll<HTMLElement>('.pivi-context-badge')) {
      expect(badge).toHaveAttribute('role', 'button');
      if (action === 'click') badge.click();
      else badge.dispatchEvent(new KeyboardEvent('keydown', { key: action, bubbles: true }));
    }
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith('review');
    expect(workspace.openLinkText).not.toHaveBeenCalled();
    unregister();
    await Promise.resolve();
  });

  it('keeps external folders inert and reports unavailable Files instead of opening a note', async () => {
    const { app, workspace } = fixture();
    const external = createInlineMentionBadge({ kind: 'folder', raw: '@external/', path: '/tmp/external', label: 'external' }, app);
    expect(external).not.toHaveAttribute('role', 'button');
    workspace.getLeavesOfType = () => [];
    const notice = jest.mocked(Notice);
    notice.mockClear();
    createInlineMentionBadge({ kind: 'folder', raw: '@notes/', path: 'notes', label: 'notes' }, app).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(notice).toHaveBeenCalled();
    expect(workspace.openLinkText).not.toHaveBeenCalled();
  });

  it('opens the localized native settings page and tolerates missing host internals', () => {
    const entry = document.body.createDiv();
    const click = jest.fn();
    entry.addEventListener('click', click);
    const setting = {
      open: jest.fn(), clearPageStack: jest.fn(), openTabById: jest.fn(),
      activeTab: { renderedItems: [{ children: [{ def: { type: 'page', name: '命令' }, settingEl: entry }] }] },
    };
    expect(openNativeSettingsPage({ setting } as unknown as App, 'pivi', '命令')).toBe(true);
    expect(setting.openTabById).toHaveBeenCalledWith('pivi');
    expect(setting.clearPageStack).toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
    expect(openNativeSettingsPage({ setting } as unknown as App, 'pivi', 'missing')).toBe(false);
    expect(openNativeSettingsPage({} as App, 'pivi', '命令')).toBe(false);
  });
});
