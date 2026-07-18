export type TitleGenerationResult =
  | { success: true; title: string }
  | { success: false; error: string };

export type TitleGenerationCallback = (
  openSessionId: string,
  result: TitleGenerationResult,
) => Promise<void>;

export interface TitleGenerationService {
  generateTitle(
    openSessionId: string,
    userMessage: string,
    callback: TitleGenerationCallback,
  ): Promise<void>;
  cancel(): void;
}
