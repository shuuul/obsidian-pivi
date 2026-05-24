import { App, SecretStorage } from 'obsidian';

export interface MockAppOptions {
  vaultBasePath?: string;
  leavesOfType?: unknown[];
  linkDest?: { path: string } | null;
}

/** Minimal Obsidian App for unit tests (vault + workspace + secretStorage). */
export function createMockApp(options: MockAppOptions = {}): App {
  const app = new App();
  Object.assign(app.vault.adapter, {
    basePath: options.vaultBasePath ?? '/mock/vault/path',
  });

  const leaves = options.leavesOfType ?? [];
  app.workspace.getLeavesOfType = jest.fn().mockReturnValue(leaves);

  if (!app.metadataCache) {
    app.metadataCache = {} as App['metadataCache'];
  }
  app.metadataCache.getFirstLinkpathDest = jest.fn().mockReturnValue(
    options.linkDest ?? null,
  );

  return app;
}

export function createMockSecretStorage(): SecretStorage {
  return new SecretStorage();
}
