import type { ObsidianCliTransport, ObsidianVaultApi } from '@pivi/obsidian-host';
import type { ObsidianToolsSettings } from '@pivi/pivi-agent-core/foundation';

import type { ObsidianApprovalFn } from './approval';

export interface ObsidianImageGenerator {
  generateImage(request: {
    prompt: string;
    model?: string;
    outputFormat?: 'png' | 'jpeg' | 'webp';
    sessionId?: string;
    signal?: AbortSignal;
  }): Promise<{
    data: string;
    mimeType: string;
    outputFormat: 'png' | 'jpeg' | 'webp';
    model: string;
    backendImageModel: string;
    responseId?: string;
    imageGenerationId?: string;
    revisedPrompt?: string;
    usage?: unknown;
  }>;
}

export interface ObsidianToolDeps {
  vault: ObsidianVaultApi;
  cli: ObsidianCliTransport;
  settings: ObsidianToolsSettings;
  vaultName: string;
  approve: ObsidianApprovalFn | null;
  imageGenerator?: ObsidianImageGenerator;
}
