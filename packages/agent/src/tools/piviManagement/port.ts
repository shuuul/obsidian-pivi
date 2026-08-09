import type {
  PiviCommandsInput,
  PiviMcpInput,
  PiviSkillsInput,
} from './types';

/**
 * Host-neutral management port implemented by app-owned coordinators.
 * ToolSpecs validate Agent input, then forward the typed action and AbortSignal.
 * Persistence, confirmation, and refresh live outside this package.
 */
export interface PiviManagementPort {
  executeMcp(input: PiviMcpInput, signal?: AbortSignal): Promise<unknown>;
  executeSkills(input: PiviSkillsInput, signal?: AbortSignal): Promise<unknown>;
  executeCommands(input: PiviCommandsInput, signal?: AbortSignal): Promise<unknown>;
}
