import type { InstructionRefineService, RefineProgressCallback } from '../../../core/providers/types';
import type { InstructionRefineResult } from '../../../core/types';

export class PiInstructionRefineService implements InstructionRefineService {
  plugin?: any;

  constructor(plugin?: any) {
    this.plugin = plugin;
  }
  resetConversation(): void {}
  async refineInstruction(
    rawInstruction: string,
    existingInstructions: string,
    onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    return { success: true, refinedInstruction: rawInstruction };
  }
  async continueConversation(
    message: string,
    onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    return { success: true, refinedInstruction: message };
  }
  cancel(): void {}
}
