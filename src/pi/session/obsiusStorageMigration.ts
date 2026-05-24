import {
  LEGACY_OBSIUS_SETTINGS_PATH,
  LEGACY_SESSIONS_PATH,
  OBSIUS_SETTINGS_PATH,
  OBSIUS_STORAGE_PATH,
} from '../../core/bootstrap/StoragePaths';
import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import {
  LEGACY_OBSIUS2_MCP_CONFIG_PATH,
  OBSIUS_MCP_CONFIG_PATH,
} from '../mcp/paths';
import { getObsiusSessionDir } from './obsiusSessionPaths';
import { SessionTreeStore } from './SessionTreeStore';

export const OBSIUS_STORAGE_MIGRATION_KEY = 'obsiusStorageV1';

interface LegacySessionMeta {
  id: string;
  title?: string;
  sessionId?: string | null;
  agentState?: Record<string, unknown>;
  createdAt?: number;
  lastResponseAt?: number;
  titleGenerationStatus?: 'pending' | 'success' | 'failed';
  currentNote?: string;
  externalContextPaths?: string[];
  enabledMcpServers?: string[];
}

export interface TabMigrationInput {
  tabId: string;
  conversationId: string | null;
  draftModel?: string | null;
}

export interface TabMigrationResult {
  tabId: string;
  sessionFile: string | null;
  leafId: string | null;
  draftModel?: string | null;
}

async function copyIfMissing(
  adapter: VaultFileAdapter,
  source: string,
  target: string,
): Promise<void> {
  if (await adapter.exists(target)) {
    return;
  }
  if (!(await adapter.exists(source))) {
    return;
  }
  const content = await adapter.read(source);
  await adapter.write(target, content);
}

/**
 * One-time vault migration from `.obsius2/` to `.obsius/`.
 * Maps legacy meta files to JSONL session paths when possible.
 */
export async function runObsiusStorageMigration(
  adapter: VaultFileAdapter,
  vaultPath: string,
  tabs: TabMigrationInput[],
): Promise<{ tabs: TabMigrationResult[]; conversationToSession: Map<string, string> }> {
  await adapter.ensureFolder(OBSIUS_STORAGE_PATH);
  await copyIfMissing(adapter, LEGACY_OBSIUS_SETTINGS_PATH, OBSIUS_SETTINGS_PATH);
  await copyIfMissing(adapter, LEGACY_OBSIUS2_MCP_CONFIG_PATH, OBSIUS_MCP_CONFIG_PATH);

  const conversationToSession = new Map<string, string>();
  const metaFiles = await adapter.listFiles(LEGACY_SESSIONS_PATH).catch(() => []);

  for (const metaPath of metaFiles.filter((p) => p.endsWith('.meta.json'))) {
    try {
      const raw = JSON.parse(await adapter.read(metaPath)) as LegacySessionMeta;
      const piSessionFile = raw.agentState?.piSessionFile;
      if (typeof piSessionFile === 'string' && piSessionFile.length > 0) {
        conversationToSession.set(raw.id, piSessionFile);
        const store = SessionTreeStore.open(vaultPath, piSessionFile);
        if (raw.title) {
          store.appendCustomMeta({
            title: raw.title,
            createdAt: raw.createdAt ?? Date.now(),
            lastResponseAt: raw.lastResponseAt,
            titleGenerationStatus: raw.titleGenerationStatus,
          });
        }
        if (raw.currentNote || raw.externalContextPaths || raw.enabledMcpServers) {
          store.appendUiContext({
            currentNote: raw.currentNote,
            externalContextPaths: raw.externalContextPaths,
            enabledMcpServers: raw.enabledMcpServers,
          });
        }
      }
    } catch {
      // skip corrupt meta
    }
  }

  getObsiusSessionDir(vaultPath);

  const migratedTabs: TabMigrationResult[] = tabs.map((tab) => {
    const sessionFile = tab.conversationId
      ? conversationToSession.get(tab.conversationId) ?? null
      : null;
    return {
      tabId: tab.tabId,
      sessionFile,
      leafId: null,
      ...(tab.draftModel ? { draftModel: tab.draftModel } : {}),
    };
  });

  return { tabs: migratedTabs, conversationToSession };
}
