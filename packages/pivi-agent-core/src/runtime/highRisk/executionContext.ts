/**
 * Async-local high-risk approval context so nested subagent tool calls
 * inherit parent grants without opening a confirmation UI.
 */

import { AsyncLocalStorage } from 'async_hooks';

import type { HighRiskApprovalController } from './approvalController';
import type { HighRiskControllerMode } from './types';

export interface HighRiskExecutionContext {
  mode: HighRiskControllerMode;
  controller: HighRiskApprovalController;
}

const storage = new AsyncLocalStorage<HighRiskExecutionContext>();

export function runWithHighRiskContext<T>(
  context: HighRiskExecutionContext,
  fn: () => T,
): T {
  return storage.run(context, fn);
}

export function getHighRiskExecutionContext(): HighRiskExecutionContext | undefined {
  return storage.getStore();
}
