/** Immutable message snapshots and structural comparison for the projection store. */

import type { ChatMessage } from '@pivi/agent/runtime/chatTypes';
import type { ToolCallInfo } from '@pivi/agent/tools';
import {
  isToolPresentationGroupable,
  shouldPresentToolCall,
} from '@pivi/agent/tools/toolPresentation';

import {
  type ChatPerfProjectionEventType,
  type ChatPerfRecorder,
  NOOP_CHAT_PERF_RECORDER,
} from './chatPerfRecorder';
import { type ProjectionMessage } from './chatProjectionEvents';
import type { DeepReadonly } from './chatUiStore';

export interface SnapshotAllocationProxies {
  clonedEntities: number;
  visitedEntities: number;
}

export function cloneSerializableValue(
  value: unknown,
  allocationProxies?: SnapshotAllocationProxies,
): unknown {
  if (allocationProxies) allocationProxies.visitedEntities += 1;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    if (allocationProxies) allocationProxies.clonedEntities += 1;
    return value.map(child => cloneSerializableValue(child, allocationProxies));
  }
  if (typeof value !== 'object') {
    throw new TypeError(`Chat projection snapshots cannot contain ${typeof value} values`);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  const constructorName = (prototype as { constructor?: { name?: string } } | null)?.constructor?.name;
  if (prototype !== null && prototype !== Object.prototype && constructorName !== 'Object') {
    throw new TypeError(`Chat projection snapshots can contain only plain objects and arrays, received ${constructorName ?? 'unknown object'}`);
  }
  if (allocationProxies) allocationProxies.clonedEntities += 1;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      cloneSerializableValue(child, allocationProxies),
    ]),
  );
}

export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value as DeepReadonly<T>;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value as DeepReadonly<T>;
}

export function snapshotMessage(
  message: ChatMessage,
  recorder: ChatPerfRecorder = NOOP_CHAT_PERF_RECORDER,
  eventType: ChatPerfProjectionEventType = 'message.upsert',
  ownerWindow: Window | null = null,
): ProjectionMessage {
  if (!recorder.enabled) {
    return deepFreeze(cloneSerializableValue(message) as ChatMessage);
  }
  const startedAt = recorder.now(ownerWindow);
  const allocationProxies: SnapshotAllocationProxies = {
    clonedEntities: 0,
    visitedEntities: 0,
  };
  const snapshot = deepFreeze(
    cloneSerializableValue(message, allocationProxies) as ChatMessage,
  );
  recorder.onProjectionSnapshot(
    eventType,
    message.id,
    Math.max(0, recorder.now(ownerWindow) - startedAt),
    allocationProxies.visitedEntities,
    allocationProxies.clonedEntities,
    ownerWindow,
  );
  return snapshot;
}

export function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => structurallyEqual(value, right[index]));
  }
  const leftEntries = Object.entries(left);
  const rightRecord = right as Record<string, unknown>;
  if (leftEntries.length !== Object.keys(rightRecord).length) return false;
  return leftEntries.every(([key, value]) => (
    Object.hasOwn(rightRecord, key) && structurallyEqual(value, rightRecord[key])
  ));
}

export function toolEntitiesEqual(left: ToolCallInfo, right: ToolCallInfo): boolean {
  return structurallyEqual(left, right);
}

export function messageStructuresEqual(left: ProjectionMessage, right: ProjectionMessage): boolean {
  if (left.role !== right.role) return false;
  if (left.role === 'user' || right.role === 'user') return structurallyEqual(left, right);
  const structure = (message: ProjectionMessage) => ({
    content: message.contentBlocks?.length ? Boolean(message.content.trim()) : message.content,
    contentBlocks: (message.contentBlocks ?? []).map(block => {
      switch (block.type) {
        case 'text':
        case 'thinking':
          return { type: block.type, visible: Boolean(block.content.trim()) };
        case 'tool_use':
          return { type: block.type, toolId: block.toolId };
        case 'subagent':
          return { type: block.type, subagentId: block.subagentId, mode: block.mode };
        case 'context_compacted':
          return {
            type: block.type,
            checkpoint: block.checkpoint,
            summary: block.summary,
            tokensAfter: block.tokensAfter,
            tokensBefore: block.tokensBefore,
          };
      }
    }),
    durationFlavorWord: message.durationFlavorWord,
    durationSeconds: message.durationSeconds,
    tokensPerSecond: message.tokensPerSecond,
    id: message.id,
    isInterrupt: message.isInterrupt,
    isRebuiltContext: message.isRebuiltContext,
    toolCalls: (message.toolCalls ?? []).map(tool => ({
      groupable: isToolPresentationGroupable(tool.name, tool.input, Boolean(tool.subagent)),
      id: tool.id,
      subagentId: tool.subagent?.id,
      subagentAgentId: tool.subagent?.agentId,
      visible: shouldPresentToolCall(tool.name, tool.input),
    })),
  });
  return structurallyEqual(structure(left), structure(right));
}
