import type { InlineEditRequest, InlineEditResult,InlineEditService } from '../../../core/providers/types';

export class PiInlineEditService implements InlineEditService {
  plugin?: any;

  constructor(plugin?: any) {
    this.plugin = plugin;
  }
  resetConversation(): void {}
  async editText(request: InlineEditRequest): Promise<InlineEditResult> {
    return { success: true, editedText: request.mode === 'selection' ? request.selectedText : '' };
  }
  async continueConversation(message: string, contextFiles?: string[]): Promise<InlineEditResult> {
    return { success: true, editedText: message };
  }
  cancel(): void {}
}
