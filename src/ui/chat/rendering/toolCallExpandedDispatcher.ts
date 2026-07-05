import {
  isAgentLifecycleTool,
  TOOL_APPLY_PATCH,
  TOOL_BASH,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_LS,
  TOOL_READ,
  TOOL_SKILL,
  TOOL_TOOL_SEARCH,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE_STDIN,
} from '@pivi/pivi-agent-core/tools/toolNames';

import { isObsidianAgentTool } from './piviToolDisplay';
import { renderApplyPatchExpanded } from './toolCallApplyPatchExpanded';
import {
  renderAgentLifecycleExpanded,
  renderBashContent,
  renderToolSearchExpanded,
} from './toolCallBashAndMiscExpanded';
import { renderLinesExpanded } from './toolCallExpandedShared';
import {
  canRenderWithoutResult,
  renderObsidianExpandedContent,
} from './toolCallObsidianExpanded';
import { renderSkillExpanded } from './toolCallSkillExpanded';
import {
  renderFileSearchExpanded,
  renderWebFetchExpanded,
  renderWebSearchExpanded,
} from './toolCallWebSearchExpanded';

type ExpandedRenderer = (
  container: HTMLElement,
  input: Record<string, unknown>,
  result: string,
  details?: Record<string, unknown>,
) => void;

const TOOL_EXPANDED_RENDERERS: Partial<Record<string, ExpandedRenderer>> = {
  [TOOL_BASH]: (container, input, result) => {
    renderBashContent(container, input, result);
  },
  [TOOL_WRITE_STDIN]: (container, _input, result) => {
    renderLinesExpanded(container, result, 20);
  },
  [TOOL_READ]: (container, _input, result) => {
    renderLinesExpanded(container, result, 15);
  },
  [TOOL_GLOB]: (container, _input, result) => {
    renderFileSearchExpanded(container, result);
  },
  [TOOL_GREP]: (container, _input, result) => {
    renderFileSearchExpanded(container, result);
  },
  [TOOL_LS]: (container, _input, result) => {
    renderFileSearchExpanded(container, result);
  },
  [TOOL_WEB_SEARCH]: (container, input, result, _details) => {
    renderWebSearchExpanded(container, input, result || undefined);
  },
  [TOOL_WEB_FETCH]: (container, _input, result) => {
    renderWebFetchExpanded(container, result);
  },
  [TOOL_SKILL]: (container, input, result, details) => {
    renderSkillExpanded(container, input, result, details);
  },
  [TOOL_TOOL_SEARCH]: (container, _input, result) => {
    renderToolSearchExpanded(container, result);
  },
  [TOOL_APPLY_PATCH]: (container, input, result) => {
    renderApplyPatchExpanded(container, input, result || undefined);
  },
};

export function renderExpandedContent(
  container: HTMLElement,
  toolName: string,
  result: string | undefined,
  input: Record<string, unknown> = {},
  details?: Record<string, unknown>,
): void {
  if (!result && toolName !== TOOL_SKILL && !canRenderWithoutResult(toolName)) {
    container.createDiv({ cls: 'pivi-tool-empty', text: 'No result' });
    return;
  }

  const resolvedResult = result ?? '';

  if (isAgentLifecycleTool(toolName)) {
    renderAgentLifecycleExpanded(container, resolvedResult);
    return;
  }

  if (isObsidianAgentTool(toolName)) {
    renderObsidianExpandedContent(container, toolName, resolvedResult, input, details);
    return;
  }

  const renderer = TOOL_EXPANDED_RENDERERS[toolName];
  if (renderer) {
    renderer(container, input, resolvedResult, details);
    return;
  }

  renderLinesExpanded(container, resolvedResult, 12);
}