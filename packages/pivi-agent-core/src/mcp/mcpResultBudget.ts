/**
 * Enforce MCP tool-result budgets before materializing content into context/session.
 */

import {
  MCP_RESULT_MAX_BLOCKS,
  MCP_RESULT_MAX_ENCODED_BYTES,
  MCP_RESULT_MAX_JSON_DEPTH,
  MCP_RESULT_MAX_RESOURCES,
  MCP_RESULT_MAX_TEXT_CHARS,
} from '../runtime/highRisk/types';

export interface McpResultBudgets {
  maxBlocks: number;
  maxEncodedBytes: number;
  maxTextChars: number;
  maxJsonDepth: number;
  maxResources: number;
}

export const DEFAULT_MCP_RESULT_BUDGETS: Readonly<McpResultBudgets> = Object.freeze({
  maxBlocks: MCP_RESULT_MAX_BLOCKS,
  maxEncodedBytes: MCP_RESULT_MAX_ENCODED_BYTES,
  maxTextChars: MCP_RESULT_MAX_TEXT_CHARS,
  maxJsonDepth: MCP_RESULT_MAX_JSON_DEPTH,
  maxResources: MCP_RESULT_MAX_RESOURCES,
});

export type McpResultBudgetViolation =
  | 'max-blocks'
  | 'max-encoded-bytes'
  | 'max-text-chars'
  | 'max-json-depth'
  | 'max-resources';

export class McpResultBudgetError extends Error {
  readonly code = 'mcp-result-budget' as const;
  readonly violation: McpResultBudgetViolation;

  constructor(violation: McpResultBudgetViolation, message: string) {
    super(message);
    this.name = 'McpResultBudgetError';
    this.violation = violation;
  }
}

export interface MaterializedMcpResult {
  text: string;
  blockCount: number;
  resourceCount: number;
  encodedBytes: number;
  textChars: number;
}

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function jsonDepth(value: unknown, depth = 0): number {
  if (value === null || typeof value !== 'object') {
    return depth;
  }
  if (Array.isArray(value)) {
    let max = depth + 1;
    for (const item of value) {
      max = Math.max(max, jsonDepth(item, depth + 1));
    }
    return max;
  }
  let max = depth + 1;
  for (const item of Object.values(value as Record<string, unknown>)) {
    max = Math.max(max, jsonDepth(item, depth + 1));
  }
  return max;
}

/**
 * Materialize MCP callTool content under fixed budgets. Stops before unbounded
 * accumulation: each block is measured before appending.
 */
export function materializeMcpToolResult(
  content: unknown,
  budgets: McpResultBudgets = DEFAULT_MCP_RESULT_BUDGETS,
): MaterializedMcpResult {
  const blocks = Array.isArray(content) ? content : [];
  if (blocks.length > budgets.maxBlocks) {
    throw new McpResultBudgetError(
      'max-blocks',
      `MCP result exceeded max block count (${budgets.maxBlocks})`,
    );
  }

  const parts: string[] = [];
  let encodedBytes = 0;
  let textChars = 0;
  let resourceCount = 0;

  for (const block of blocks) {
    if (!block || typeof block !== 'object' || !('type' in block)) {
      const serialized = JSON.stringify(block);
      encodedBytes += utf8ByteLength(serialized);
      textChars += serialized.length;
      if (encodedBytes > budgets.maxEncodedBytes) {
        throw new McpResultBudgetError(
          'max-encoded-bytes',
          `MCP result exceeded max encoded bytes (${budgets.maxEncodedBytes})`,
        );
      }
      if (textChars > budgets.maxTextChars) {
        throw new McpResultBudgetError(
          'max-text-chars',
          `MCP result exceeded max text characters (${budgets.maxTextChars})`,
        );
      }
      if (jsonDepth(block) > budgets.maxJsonDepth) {
        throw new McpResultBudgetError(
          'max-json-depth',
          `MCP result exceeded max JSON depth (${budgets.maxJsonDepth})`,
        );
      }
      parts.push(serialized);
      continue;
    }

    const typed = block as { type: string; text?: string; resource?: unknown };
    if (typed.type === 'text' && typeof typed.text === 'string') {
      const chunk = typed.text;
      encodedBytes += utf8ByteLength(chunk);
      textChars += chunk.length;
      if (encodedBytes > budgets.maxEncodedBytes) {
        throw new McpResultBudgetError(
          'max-encoded-bytes',
          `MCP result exceeded max encoded bytes (${budgets.maxEncodedBytes})`,
        );
      }
      if (textChars > budgets.maxTextChars) {
        throw new McpResultBudgetError(
          'max-text-chars',
          `MCP result exceeded max text characters (${budgets.maxTextChars})`,
        );
      }
      parts.push(chunk);
      continue;
    }

    if (typed.type === 'resource') {
      resourceCount += 1;
      if (resourceCount > budgets.maxResources) {
        throw new McpResultBudgetError(
          'max-resources',
          `MCP result exceeded max resource count (${budgets.maxResources})`,
        );
      }
      if (jsonDepth(typed.resource) > budgets.maxJsonDepth) {
        throw new McpResultBudgetError(
          'max-json-depth',
          `MCP result exceeded max JSON depth (${budgets.maxJsonDepth})`,
        );
      }
      const serialized = JSON.stringify(typed.resource);
      encodedBytes += utf8ByteLength(serialized);
      textChars += serialized.length;
      if (encodedBytes > budgets.maxEncodedBytes) {
        throw new McpResultBudgetError(
          'max-encoded-bytes',
          `MCP result exceeded max encoded bytes (${budgets.maxEncodedBytes})`,
        );
      }
      if (textChars > budgets.maxTextChars) {
        throw new McpResultBudgetError(
          'max-text-chars',
          `MCP result exceeded max text characters (${budgets.maxTextChars})`,
        );
      }
      parts.push(serialized);
      continue;
    }

    if (jsonDepth(block) > budgets.maxJsonDepth) {
      throw new McpResultBudgetError(
        'max-json-depth',
        `MCP result exceeded max JSON depth (${budgets.maxJsonDepth})`,
      );
    }
    const serialized = JSON.stringify(block);
    encodedBytes += utf8ByteLength(serialized);
    textChars += serialized.length;
    if (encodedBytes > budgets.maxEncodedBytes) {
      throw new McpResultBudgetError(
        'max-encoded-bytes',
        `MCP result exceeded max encoded bytes (${budgets.maxEncodedBytes})`,
      );
    }
    if (textChars > budgets.maxTextChars) {
      throw new McpResultBudgetError(
        'max-text-chars',
        `MCP result exceeded max text characters (${budgets.maxTextChars})`,
      );
    }
    parts.push(serialized);
  }

  return {
    text: parts.join('\n') || '(empty result)',
    blockCount: blocks.length,
    resourceCount,
    encodedBytes,
    textChars,
  };
}
