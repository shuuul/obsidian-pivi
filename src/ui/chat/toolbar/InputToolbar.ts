import { ContextUsageMeter } from './ContextUsageMeter';
import { ExternalContextSelector } from './ExternalContextControl';
import { McpServerSelector } from './McpControl';
import { ModeSelector } from './ModeControl';
import { ModelSelector } from './ModelControl';
import { PermissionToggle } from './PermissionControl';
import { ThinkingBudgetSelector } from './ThinkingControl';
import type { ToolbarCallbacks } from './ToolbarTypes';

export interface InputToolbarComponents {
  modelSelector: ModelSelector;
  modeSelector: ModeSelector;
  thinkingBudgetSelector: ThinkingBudgetSelector;
  contextUsageMeter: ContextUsageMeter | null;
  externalContextSelector: ExternalContextSelector;
  mcpServerSelector: McpServerSelector;
  permissionToggle: PermissionToggle;
}

export { ContextUsageMeter } from './ContextUsageMeter';
export type { AddExternalContextResult } from './ExternalContextControl';
export { ExternalContextSelector } from './ExternalContextControl';
export { McpServerSelector } from './McpControl';
export { ModeSelector } from './ModeControl';
export { ModelSelector } from './ModelControl';
export { PermissionToggle } from './PermissionControl';
export { ThinkingBudgetSelector } from './ThinkingControl';
export type { ToolbarCallbacks, ToolbarSettings } from './ToolbarTypes';

export function createInputToolbar(
  parentEl: HTMLElement,
  callbacks: ToolbarCallbacks
): InputToolbarComponents {
  const modelSelector = new ModelSelector(parentEl, callbacks);
  const thinkingBudgetSelector = new ThinkingBudgetSelector(parentEl, callbacks);
  const contextUsageMeter = new ContextUsageMeter(parentEl);
  const externalContextSelector = new ExternalContextSelector(parentEl, callbacks);
  const mcpServerSelector = new McpServerSelector(parentEl);
  const permissionToggle = new PermissionToggle(parentEl, callbacks);
  const modeSelector = new ModeSelector(parentEl, callbacks);

  return {
    modelSelector,
    modeSelector,
    thinkingBudgetSelector,
    contextUsageMeter,
    externalContextSelector,
    mcpServerSelector,
    permissionToggle,
  };
}
