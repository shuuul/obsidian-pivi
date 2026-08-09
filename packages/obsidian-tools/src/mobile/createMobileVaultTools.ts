import type { ObsidianToolsSettings } from '@pivi/pivi-agent-core/foundation';
import type { ReadAllowanceReservation } from '@pivi/pivi-agent-core/foundation/usage';
import type { ToolSpec } from '@pivi/pivi-agent-core/tools';

import { createAttachmentTool } from '../obsidian/attachment';
import { createDeletePathTool } from '../obsidian/deletePath';
import { createEditNoteTool } from '../obsidian/editNote';
import { createGraphTool } from '../obsidian/graph';
import { createLinksTool } from '../obsidian/links';
import { createListPathTool } from '../obsidian/listPath';
import { createMarkdownStructureTool } from '../obsidian/markdownStructure';
import { createMkdirTool } from '../obsidian/mkdir';
import { createMovePathTool } from '../obsidian/movePath';
import { createNoteInfoTool } from '../obsidian/noteInfo';
import { createPropertiesTool } from '../obsidian/properties';
import { createReadNoteTool } from '../obsidian/readNote';
import { createSearchTool } from '../obsidian/search';
import { createTagsTool } from '../obsidian/tags';
import type { VaultToolApi, VaultToolDeps } from '../obsidian/vaultDeps';
import { createWriteNoteTool } from '../obsidian/writeNote';

export type MobileVaultMutation = 'attachment' | 'delete' | 'edit' | 'mkdir' | 'move' | 'properties' | 'write';

export interface MobileVaultMutationApprovalPort {
  approve(request: {
    mutation: MobileVaultMutation;
    toolName: string;
    params: Readonly<Record<string, unknown>>;
    signal: AbortSignal;
  }): Promise<boolean>;
}

export interface CreateMobileVaultToolsOptions {
  vault: VaultToolApi;
  settings: ObsidianToolsSettings;
  approval: MobileVaultMutationApprovalPort;
  vaultName?: string;
  resolveReadMaxChars?: (requestedMaxChars?: number) => ReadAllowanceReservation;
}

const MUTATIONS: Readonly<Record<string, MobileVaultMutation>> = {
  obsidian_attachment: 'attachment',
  obsidian_delete: 'delete',
  obsidian_edit: 'edit',
  obsidian_mkdir: 'mkdir',
  obsidian_move: 'move',
  obsidian_properties: 'properties',
  obsidian_write: 'write',
};

function abortError(): DOMException {
  return new DOMException('Vault mutation approval was aborted.', 'AbortError');
}

function requireApproval(tool: ToolSpec, approval: MobileVaultMutationApprovalPort): ToolSpec {
  const configuredMutation = MUTATIONS[tool.name];
  if (!configuredMutation) return tool;
  return {
    ...tool,
    async execute(id: string, params: unknown, signal?: AbortSignal) {
      const input = params as Record<string, unknown>;
      if (tool.name === 'obsidian_properties' && input.action !== 'set' && input.action !== 'remove') {
        return tool.execute(id, params, signal);
      }
      const approvalSignal = signal ?? new AbortController().signal;
      if (approvalSignal.aborted) throw abortError();
      const allowed = await new Promise<boolean>((resolve, reject) => {
        let settled = false;
        const settle = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          approvalSignal.removeEventListener('abort', onAbort);
          fn();
        };
        const onAbort = (): void => settle(() => reject(abortError()));
        approvalSignal.addEventListener('abort', onAbort, { once: true });
        void approval.approve({
          mutation: configuredMutation,
          toolName: tool.name,
          params: input,
          signal: approvalSignal,
        }).then(
          value => settle(() => resolve(value)),
          error => settle(() => reject(error instanceof Error ? error : new Error(String(error)))),
        );
      });
      if (approvalSignal.aborted) throw abortError();
      if (!allowed) {
        throw new Error(`User denied ${tool.name} vault mutation.`);
      }
      if (approvalSignal.aborted) throw abortError();
      return tool.execute(id, params, signal);
    },
  };
}

/** Exact Mobile capability projection: public-vault API only, with no CLI fallback. */
export function createMobileVaultTools(options: CreateMobileVaultToolsOptions): ToolSpec[] {
  const deps: VaultToolDeps = {
    vault: options.vault,
    settings: options.settings,
    obsidianCliAvailable: false,
    vaultName: options.vaultName ?? 'vault',
    resolveReadMaxChars: options.resolveReadMaxChars,
    cli: { run: async () => { throw new Error('Obsidian CLI is unavailable on Mobile.'); } },
  };
  return [
    createReadNoteTool(deps), createMarkdownStructureTool(deps), createSearchTool(deps),
    createListPathTool(deps), createNoteInfoTool(deps), createLinksTool(deps),
    createPropertiesTool(deps), createTagsTool(deps), createGraphTool(deps),
    createWriteNoteTool(deps), createEditNoteTool(deps), createMovePathTool(deps),
    createDeletePathTool(deps), createMkdirTool(deps), createAttachmentTool(deps),
  ].map(tool => requireApproval(tool, options.approval));
}
