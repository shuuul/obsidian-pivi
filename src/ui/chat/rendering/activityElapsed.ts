import { resolveSubagentActivityStatus, type SubagentInfo } from '@pivi/pivi-agent-core/foundation';
import { formatActivityElapsed } from '@pivi/pivi-react/store';

export interface ActivityElapsedController {
  update(info: SubagentInfo): void;
}

export function createActivityElapsedController(
  element: HTMLElement,
  initialInfo: SubagentInfo,
): ActivityElapsedController {
  let info = initialInfo;
  const render = (): void => {
    const startedAt = info.startedAt;
    const status = resolveSubagentActivityStatus(info);
    const end = status === 'running' ? Date.now() : info.completedAt;
    if (!startedAt || !end) {
      element.empty();
      element.addClass('pivi-hidden');
      return;
    }
    element.removeClass('pivi-hidden');
    element.setText(formatActivityElapsed(end - startedAt));
  };
  render();
  return {
    update(nextInfo) {
      info = nextInfo;
      render();
    },
  };
}
