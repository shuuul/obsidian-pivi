import type {
  ExternalFileEntry,
  ExternalFileReadResult,
  ExternalFileStat,
  ObsidianCliTransport,
  ObsidianVaultApi,
} from '@pivi/obsidian-host';
import type { ObsidianToolsSettings } from '@pivi/pivi-agent-core/foundation';
import type { ProcessRunner } from '@pivi/pivi-agent-core/ports';
import type { App } from 'obsidian';


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

export interface ExternalFileApiLike {
  readFile(absolutePath: string): Promise<ExternalFileReadResult>;
  listPath(absolutePath: string): ExternalFileEntry[];
  stat(absolutePath: string): ExternalFileStat;
}

export interface ObsidianToolDeps {
  app: App;
  vault: ObsidianVaultApi;
  cli: ObsidianCliTransport;
  externalFiles: ExternalFileApiLike;
  settings: ObsidianToolsSettings;
  vaultName: string;
  vaultPath: string | null;
  obsidianCliAvailable?: boolean;
  processRunner: ProcessRunner;
  imageGenerator?: ObsidianImageGenerator;
  resolveReadMaxChars?: (requestedMaxChars?: number) => number;
}
