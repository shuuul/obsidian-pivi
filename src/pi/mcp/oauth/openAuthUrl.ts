/** Open OAuth authorization URL in the system browser (Obsidian/Electron). */
export function openAuthUrl(url: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- electron is external in the Obsidian bundle.
    const electron = require('electron') as {
      shell?: { openExternal?: (target: string) => Promise<void> };
    };
    if (electron.shell?.openExternal) {
      void electron.shell.openExternal(url).catch((error: unknown) => {
        console.warn('Obsius: shell.openExternal failed', error);
        window.open(url, '_blank');
      });
      return;
    }
  } catch (error) {
    console.warn('Obsius: electron shell unavailable for OAuth URL', error);
  }
  window.open(url, '_blank');
}
