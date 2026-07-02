import type { AuxQueryRunner } from './AuxQueryRunner';
import type {
  InlineEditRequest,
  InlineEditResult,
  InlineEditService,
} from './auxTypes';
import { appendContextFiles } from './context/context';
import {
  buildInlineEditPrompt,
  getInlineEditSystemPrompt,
  parseInlineEditResponse,
} from './prompt/inlineEdit';

export class QueryBackedInlineEditService implements InlineEditService {
  private abortController: AbortController | null = null;
  private hasOpenSession = false;
  private modelOverride: string | undefined;

  constructor(private readonly runner: AuxQueryRunner) {}

  setModelOverride(model?: string): void {
    const trimmed = model?.trim();
    this.modelOverride = trimmed ? trimmed : undefined;
  }

  resetSession(): void {
    this.runner.reset();
    this.hasOpenSession = false;
  }

  async editText(request: InlineEditRequest): Promise<InlineEditResult> {
    this.resetSession();
    return this.sendMessage(buildInlineEditPrompt(request));
  }

  async continueSession(message: string, contextFiles?: string[]): Promise<InlineEditResult> {
    if (!this.hasOpenSession) {
      return { success: false, error: 'No active session to continue' };
    }

    let prompt = message;
    if (contextFiles && contextFiles.length > 0) {
      prompt = appendContextFiles(message, contextFiles);
    }
    return this.sendMessage(prompt);
  }

  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  private async sendMessage(prompt: string): Promise<InlineEditResult> {
    this.abortController = new AbortController();

    try {
      const text = await this.runner.query({
        abortController: this.abortController,
        model: this.modelOverride,
        systemPrompt: getInlineEditSystemPrompt(),
      }, prompt);
      this.hasOpenSession = true;
      return parseInlineEditResponse(text);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      this.abortController = null;
    }
  }
}
