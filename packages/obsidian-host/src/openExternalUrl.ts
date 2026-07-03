import type { ExternalOpener } from '@pivi/pivi-agent-core/ports';

type SpawnChild = { unref: () => void };
type SpawnFn = (command: string, args: string[], options: { detached: boolean; stdio: 'ignore' }) => SpawnChild;

export async function openExternalUrl(url: string): Promise<void> {
  try {
    // Delegate to the OS default browser instead of navigating Obsidian's Electron renderer.
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
  } catch (error) {
    console.warn('Pivi: system browser opener failed', error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export const systemExternalOpener: ExternalOpener = {
  openExternalUrl,
};
