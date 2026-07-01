import type PiviPlugin from '../../main';
import type { AgentHostContext } from '../../pi/bootstrap/hostContext';

export function resolvePiPlugin(host: AgentHostContext): PiviPlugin {
  return host.rawHost as PiviPlugin;
}
