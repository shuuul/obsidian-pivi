import { resolveSubagentActivityStatus, type SubagentInfo } from '@pivi/pivi-agent-core/foundation';

export interface ActivityElapsedController {
  update(info: SubagentInfo): void;
}

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
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
    element.setText(formatElapsed(end - startedAt));
  };
  render();
  return {
    update(nextInfo) {
      info = nextInfo;
      render();
    },
  };
}
