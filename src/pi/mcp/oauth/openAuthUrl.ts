/** Open OAuth authorization URL in the system browser (Obsidian/Electron). */
type SpawnChild = { unref: () => void };
type SpawnFn = (command: string, args: string[], options: { detached: boolean; stdio: 'ignore' }) => SpawnChild;

export function openAuthUrl(url: string): void {
  let electronError: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- electron is external in the Obsidian bundle.
    const electron = require('electron') as {
      shell?: { openExternal?: (target: string) => Promise<void> };
    };
    if (electron.shell?.openExternal) {
      void electron.shell.openExternal(url).catch((error: unknown) => {
        console.warn('Pivi: shell.openExternal failed', error);
        openUrlWithSystemHandler(url);
      });
      return;
    }
  } catch (error) {
    electronError = error;
  }
  if (!openUrlWithSystemHandler(url)) {
    console.warn('Pivi: electron shell unavailable for OAuth URL', electronError);
  }
}

function openUrlWithSystemHandler(url: string): boolean {
  try {
    // Match pi-coding-agent's behavior: delegate to the OS default browser instead
    // of navigating an Electron/Obsidian renderer window to the OAuth route.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Node child_process is available in Obsidian desktop.
    const { spawn } = require('child_process') as { spawn: SpawnFn };
    const command = process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'rundll32'
        : 'xdg-open';
    const args = process.platform === 'win32'
      ? ['url.dll,FileProtocolHandler', url]
      : [url];
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch (error) {
    console.warn('Pivi: system browser opener failed', error);
    return false;
  }
}
