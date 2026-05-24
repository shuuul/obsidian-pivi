import type { RuntimeCapabilities } from '../core/agent/types';

export const PI_RUNTIME_CAPABILITIES: Readonly<RuntimeCapabilities> = Object.freeze({
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: true,
  supportsRuntimeCommands: false,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: true,
  supportsTurnSteer: false,
  reasoningControl: 'effort',
});
