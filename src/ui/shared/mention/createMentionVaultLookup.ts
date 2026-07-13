import type { MentionVaultLookup } from '@pivi/obsidian-ui';
import { resolveVaultWikilinkTarget } from '@pivi/obsidian-ui';
import type { App } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

/** Adapts Obsidian `App` into the narrow vault lookup used by mention parsing. */
export function createMentionVaultLookup(app: App): MentionVaultLookup {
  return {
    getFiles() {
      return app.vault.getFiles().map((file) => ({
        path: file.path,
        basename: file.basename,
      }));
    },
    getFolders() {
      const loadedFiles = app.vault.getAllLoadedFiles?.() ?? [];
      const folders: Array<{ path: string; name: string }> = [];
      for (const entry of loadedFiles) {
        if (entry instanceof TFolder) {
          folders.push({ path: entry.path, name: entry.name });
        }
      }
      return folders;
    },
    getByPath(path) {
      const abstract = app.vault.getAbstractFileByPath(path);
      if (abstract instanceof TFile) {
        return { kind: 'file', path: abstract.path, basename: abstract.basename };
      }
      if (abstract instanceof TFolder) {
        return { kind: 'folder', path: abstract.path, name: abstract.name };
      }
      return null;
    },
    resolveWikilink(linkPath, sourcePath = '') {
      const target = resolveVaultWikilinkTarget(app, linkPath, sourcePath);
      if (target instanceof TFile) {
        return { kind: 'file', path: target.path, basename: target.basename };
      }
      if (target instanceof TFolder) {
        return { kind: 'folder', path: target.path, name: target.name };
      }
      return null;
    },
  };
}
