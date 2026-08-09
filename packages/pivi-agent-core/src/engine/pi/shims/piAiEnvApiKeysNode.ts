import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { configurePiAiEnvironmentHost } from './piAiEnvApiKeys';

/** Install ambient process/file credential discovery for the Desktop composition only. */
export function configureNodePiAiEnvironmentHost(): void {
  configurePiAiEnvironmentHost({
    getEnvironmentVariable: (name) => process.env[name],
    shouldReadProcessEnvironmentFallback: () => !!process.versions?.bun
      && Object.keys(process.env).length === 0,
    readProcessEnvironment: () => {
      try {
        return readFileSync('/proc/self/environ', 'utf-8');
      } catch {
        return null;
      }
    },
    hasFile: existsSync,
    getHomeDirectory: homedir,
    joinPath: join,
  });
}
