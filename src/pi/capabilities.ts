import type { RuntimeCapabilities } from '../core/agent/types';

export const PI_RUNTIME_CAPABILITIES: Readonly<RuntimeCapabilities> = Object.freeze({
  supportsPersistentRuntime: false,
  supportsNativeHistory: true,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: false,
  supportsRuntimeCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: true,
  supportsTurnSteer: false,
  reasoningControl: 'effort',
});
