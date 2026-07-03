import type { ProviderLegacyAuthData, ProviderLegacyAuthStore } from '@pivi/pivi-agent-core/ports';
import * as fs from 'fs';

export function createFileProviderLegacyAuthStore(path: string | null): ProviderLegacyAuthStore | null {
  if (!path) {
    return null;
  }
  return {
    path,
    read: () => {
      if (!fs.existsSync(path)) {
        return null;
      }
      try {
        return JSON.parse(fs.readFileSync(path, 'utf-8')) as ProviderLegacyAuthData;
      } catch {
        return null;
      }
    },
    write: (data) => {
      fs.writeFileSync(path, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
    },
  };
}
