import { AgentServices } from '../agent/AgentServices';
import type { VaultFileAdapter } from '../storage/VaultFileAdapter';
import type {
  Conversation,
  ConversationMeta,
  SessionMetadata,
} from '../types';
import { normalizeSessionMetadata, resolveAgentState } from './sessionMetadata';
import { SESSIONS_PATH } from './StoragePaths';

export { SESSIONS_PATH };

export class SessionStorage {
  constructor(private adapter: VaultFileAdapter) {}

  getMetadataPath(id: string): string {
    return `${SESSIONS_PATH}/${id}.meta.json`;
  }

  async saveMetadata(metadata: SessionMetadata): Promise<void> {
    const filePath = this.getMetadataPath(metadata.id);
    const content = JSON.stringify(metadata, null, 2);
    await this.adapter.write(filePath, content);
  }

  async loadMetadata(id: string): Promise<SessionMetadata | null> {
    const filePath = this.getMetadataPath(id);

    try {
      if (!(await this.adapter.exists(filePath))) {
        return null;
      }

      const content = await this.adapter.read(filePath);
      return normalizeSessionMetadata(JSON.parse(content) as SessionMetadata);
    } catch {
      return null;
    }
  }

  async deleteMetadata(id: string): Promise<void> {
    await this.adapter.delete(this.getMetadataPath(id));
  }

  async listMetadata(): Promise<SessionMetadata[]> {
    const metas: SessionMetadata[] = [];

    for (const filePath of await this.listMetadataFiles()) {
      try {
        const content = await this.adapter.read(filePath);
        metas.push(normalizeSessionMetadata(JSON.parse(content) as SessionMetadata));
      } catch {
        // Skip files that fail to load.
      }
    }

    return metas;
  }

  async listAllConversations(): Promise<ConversationMeta[]> {
    const nativeMetas = await this.listMetadata();

    const metas: ConversationMeta[] = nativeMetas.map((meta) => ({
      id: meta.id,
      title: meta.title,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      lastResponseAt: meta.lastResponseAt,
      messageCount: 0,
      preview: 'SDK session',
      titleGenerationStatus: meta.titleGenerationStatus,
    }));

    return metas.sort((a, b) =>
      (b.lastResponseAt ?? b.createdAt) - (a.lastResponseAt ?? a.createdAt)
    );
  }

  toSessionMetadata(conversation: Conversation): SessionMetadata {
    const agentState = AgentServices
      .getConversationHistoryService()
      .buildPersistedAgentState?.(conversation)
      ?? resolveAgentState(conversation);

    return {
      id: conversation.id,
      title: conversation.title,
      titleGenerationStatus: conversation.titleGenerationStatus,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastResponseAt: conversation.lastResponseAt,
      sessionId: conversation.sessionId,
      agentState,
      currentNote: conversation.currentNote,
      externalContextPaths: conversation.externalContextPaths,
      enabledMcpServers: conversation.enabledMcpServers,
      usage: conversation.usage,
      resumeAtMessageId: conversation.resumeAtMessageId,
    };
  }

  private async listMetadataFiles(): Promise<string[]> {
    try {
      const files = await this.adapter.listFiles(SESSIONS_PATH);
      return files.filter((filePath) => filePath.endsWith('.meta.json'));
    } catch {
      return [];
    }
  }
}
