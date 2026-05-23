import type { TitleGenerationCallback,TitleGenerationService } from '../../../core/providers/types';

export class PiTitleGenerationService implements TitleGenerationService {
  plugin?: any;

  constructor(plugin?: any) {
    this.plugin = plugin;
  }
  async generateTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback,
  ): Promise<void> {
    const title = userMessage.trim().substring(0, 30) || 'New Chat';
    await callback(conversationId, { success: true, title });
  }

  cancel(): void {}
}
