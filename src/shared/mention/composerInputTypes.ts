/** Text composer surface for @mentions and slash commands (rich input or textarea). */
export interface ComposerInput {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  focus(): void;
  getBoundingClientRect(): DOMRect;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
  insertReplacement?(beforeAt: string, replacement: string, afterCursor: string): void;
}
