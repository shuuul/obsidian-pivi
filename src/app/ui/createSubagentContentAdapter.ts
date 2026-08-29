import type { SubagentInfo } from '@pivi/agent/tools';
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
    mount(container, subagent, context) {
      const state = mountStoredSubagent(
        container,
        subagent,
        renderContent,
        context.beginDisclosureResize,
      );
      mounted.set(container, state);
      return () => {
        mounted.delete(container);
        container.empty();
      };
    },
    update(container, subagent) {
      const state = mounted.get(container);
      if (!state) throw new Error(`Stored subagent ${subagent.id} is not mounted`);
      updateStoredSubagent(state, subagent);
    },
  };
}
