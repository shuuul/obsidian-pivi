import type { SubagentInfo } from '@pivi/pivi-agent-core/foundation';
import type { MessageContentAdapter } from '@pivi/pivi-react';

import type { RenderContentOptions } from '@/ui/chat/rendering/messageRendererTypes';
import {
  mountStoredSubagent,
  type SubagentState,
  updateStoredSubagent,
} from '@/ui/chat/rendering/SubagentRenderer';

export function createSubagentContentAdapter(
  renderContent: (target: HTMLElement, markdown: string, options?: RenderContentOptions) => Promise<void>,
): MessageContentAdapter<SubagentInfo> {
  const mounted = new WeakMap<HTMLElement, SubagentState>();
  return {
    mount(container, subagent) {
      const state = mountStoredSubagent(container, subagent, renderContent);
      mounted.set(container, state);
      return () => {
        mounted.delete(container);
        container.empty();
      };
    },
    update(container, subagent) {
      const state = mounted.get(container);
      if (state) updateStoredSubagent(state, subagent);
    },
  };
}
