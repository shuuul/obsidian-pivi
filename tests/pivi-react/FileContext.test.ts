import { TFile } from 'obsidian';

import { buildTurnSubmission } from '@/ui/chat/composer/ComposerSubmission';
import { FileContextManager } from '@/ui/chat/ui/FileContext';

jest.mock('@/ui/shared/mention/VaultMentionDataProvider', () => ({
  VaultMentionDataProvider: class {
    initializeInBackground() {}
    markFilesDirty() {}
    markFoldersDirty() {}
    getCachedVaultFiles() { return []; }
    getCachedVaultFolders() { return []; }
  },
}));

jest.mock('@/ui/shared/mention/MentionDropdownController', () => ({
  MentionDropdownController: class {
    destroy() {}
    handleInputChange() {}
    handleKeydown() { return false; }
    isVisible() { return false; }
    hide() {}
    containsElement() { return false; }
    setMcpManager() {}
    setAgentService() {}
  },
}));

function createFile(path: string): TFile {
  const file = new TFile();
  const name = path.split('/').pop() ?? path;
  Object.assign(file, {
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ''),
    extension: name.split('.').pop() ?? '',
  });
  return file;
}

function createManager(activeFile = createFile('notes/First.md')): FileContextManager {
  const app = {
    vault: {
      adapter: { basePath: '/vault' },
      getAbstractFileByPath: () => null,
      offref: jest.fn(),
      on: jest.fn(() => ({})),
    },
    workspace: {
      getActiveFile: () => activeFile,
      getLeaf: () => ({ openFile: jest.fn() }),
    },
  };
  return new FileContextManager(
    app as never,
    document.createElement('div'),
    { value: '', selectionStart: 0 } as never,
    { getExcludedTags: () => [] },
  );
}

function buildRequest(manager: FileContextManager) {
  return buildTurnSubmission({
    selectionController: { getContext: () => null },
    canvasSelectionController: { getContext: () => null },
    getFileContextManager: () => manager,
    getExternalContextSelector: () => null,
  } as never, { content: 'hello' }).turnRequest;
}

describe('FileContextManager turn-scoped cards', () => {
  it('auto-attaches the current note only to the first turn', () => {
    const manager = createManager();
    manager.autoAttachActiveFile();

    const first = buildRequest(manager);
    expect(first.currentNotePath).toBe('notes/First.md');
    expect(first.attachedFilePaths).toBeUndefined();

    manager.startSession();
    manager.clearAfterSend();
    manager.handleFileOpen(createFile('notes/Second.md'));

    const second = buildRequest(manager);
    expect(second.currentNotePath).toBeUndefined();
    expect(second.attachedFilePaths).toBeUndefined();
  });

  it('does not restore a current-note card for a session that already has messages', () => {
    const manager = createManager();

    manager.resetForLoadedSession(true);
    manager.setCurrentNote('notes/First.md');

    expect(manager.getCurrentNotePath()).toBeNull();
    expect(buildRequest(manager).currentNotePath).toBeUndefined();
  });
});
