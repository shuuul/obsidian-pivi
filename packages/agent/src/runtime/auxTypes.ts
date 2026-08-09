export type TitleGenerationResult =
  | { success: true; title: string }
  | { success: false; error: string };

export interface TitleGenerationService {
  generateTitle(
    openSessionId: string,
    userMessage: string,
  ): Promise<TitleGenerationResult>;
  cancel(): void;
}
