/** Text composer surface for @mentions and slash commands (rich input or textarea). */
export interface ComposerInput {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  focus(): void;
  contains(node: Node | null): boolean;
  getBoundingClientRect(): DOMRect;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  dispatchEvent(event: Event): boolean;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
  getTextOffsetClientRect?(offset: number): DOMRect | null;
  insertReplacement?(beforeAt: string, replacement: string, afterCursor: string): void;
}
