/** Open OAuth authorization URL in the system browser (Obsidian/Electron). */
export function openAuthUrl(url: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- electron is external in the Obsidian bundle.
    const electron = require('electron') as {
      shell?: { openExternal?: (target: string) => Promise<void> };
    };
    if (electron.shell?.openExternal) {
      void electron.shell.openExternal(url);
      return;
    }
  } catch {
    // Fall through to window.open when electron is unavailable (tests).
  }
  window.open(url, '_blank');
}
