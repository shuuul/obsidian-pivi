import type { AuthContextHost } from '@pivi/agent/ports';
import * as fs from 'fs';

export function createSystemAuthContextHost(): AuthContextHost {
  return {
    getEnvironmentVariable: (name) => process.env[name],
    fileExists: (path) => fs.existsSync(path),
    getHomeDirectory: () => process.env.HOME ?? '',
  };
}
