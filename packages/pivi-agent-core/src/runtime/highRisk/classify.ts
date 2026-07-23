/**
 * Classify tool invocations into the fixed high-risk operation table.
 */

import {
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_DELETE,
  TOOL_OBSIDIAN_EVAL,
  TOOL_OBSIDIAN_MOVE,
  TOOL_OBSIDIAN_WRITE,
} from '../../tools/obsidianToolNames';
import {
  HIGH_RISK_BULK_CHILD_THRESHOLD,
  type HighRiskOperationKind,
  type HighRiskResourceSummary,
} from './types';

export interface HighRiskClassificationContext {
  /** True when the target write path already exists as a file. */
  pathExists?: (vaultRelativePath: string) => boolean | Promise<boolean>;
  /** Direct child count for a folder; undefined when not a folder / unknown. */
  folderChildCount?: (vaultRelativePath: string) => number | Promise<number | undefined> | undefined;
}

export interface HighRiskClassification {
  kind: HighRiskOperationKind;
  resources: HighRiskResourceSummary;
}

function asRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === 'object' && !Array.isArray(params)
    ? params as Record<string, unknown>
    : {};
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function resolveWritePath(input: Record<string, unknown>): string | undefined {
  return stringField(input, 'path') ?? stringField(input, 'file');
}

export async function classifyHighRiskToolCall(
  toolName: string,
  params: unknown,
  context: HighRiskClassificationContext = {},
): Promise<HighRiskClassification | null> {
  const input = asRecord(params);

  if (toolName === TOOL_OBSIDIAN_BASH) {
    const command = stringField(input, 'command') ?? '';
    const tokens = command.split(/\s+/).filter(Boolean);
    return {
      kind: 'bash',
      resources: {
        executable: tokens[0],
        args: tokens.slice(1),
        ...(stringField(input, 'cwd') ? { cwd: stringField(input, 'cwd') } : {}),
      },
    };
  }

  if (toolName === TOOL_OBSIDIAN_EVAL) {
    return {
      kind: 'eval',
      resources: {
        // Never include eval source code in the grant fingerprint preview body.
        executable: 'obsidian-cli-eval',
      },
    };
  }

  if (toolName === TOOL_OBSIDIAN_DELETE) {
    const path = stringField(input, 'path') ?? stringField(input, 'file');
    if (!path) {
      return null;
    }
    const childCount = context.folderChildCount
      ? await context.folderChildCount(path)
      : undefined;
    if (typeof childCount === 'number' && childCount > HIGH_RISK_BULK_CHILD_THRESHOLD) {
      return {
        kind: 'bulk-mutation',
        resources: { paths: [path], bulkCount: childCount },
      };
    }
    return {
      kind: 'delete',
      resources: { paths: [path] },
    };
  }

  if (toolName === TOOL_OBSIDIAN_MOVE) {
    const path = stringField(input, 'path');
    const newPath = stringField(input, 'newPath');
    if (!path || !newPath) {
      return null;
    }
    const childCount = context.folderChildCount
      ? await context.folderChildCount(path)
      : undefined;
    if (typeof childCount === 'number' && childCount > HIGH_RISK_BULK_CHILD_THRESHOLD) {
      return {
        kind: 'bulk-mutation',
        resources: { paths: [path, newPath], bulkCount: childCount },
      };
    }
    return null;
  }

  if (toolName === TOOL_OBSIDIAN_WRITE) {
    const mode = stringField(input, 'mode');
    const path = resolveWritePath(input);
    if (!path) {
      return null;
    }
    const exists = context.pathExists ? await context.pathExists(path) : false;
    const overwriteFlag = input.overwrite === true;
    if (mode === 'overwrite' && exists) {
      return { kind: 'overwrite', resources: { paths: [path] } };
    }
    if (mode === 'create' && overwriteFlag && exists) {
      return { kind: 'overwrite', resources: { paths: [path] } };
    }
    return null;
  }

  if (toolName === 'mcp') {
    // Stdio launch is classified at the connection-pool boundary, not here.
    return null;
  }

  return null;
}

export function classifyStdioMcpLaunch(resources: {
  mcpServer: string;
  executable: string;
  args?: readonly string[];
  cwd?: string;
  envVarNames?: readonly string[];
}): HighRiskClassification {
  return {
    kind: 'stdio-mcp-launch',
    resources: {
      mcpServer: resources.mcpServer,
      executable: resources.executable,
      ...(resources.args ? { args: resources.args } : {}),
      ...(resources.cwd ? { cwd: resources.cwd } : {}),
      ...(resources.envVarNames ? { envVarNames: resources.envVarNames } : {}),
    },
  };
}

export function classifyMcpArtifactWrite(vaultRelativePath: string): HighRiskClassification {
  return {
    kind: 'mcp-artifact-write',
    resources: { paths: [vaultRelativePath] },
  };
}
