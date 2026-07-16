export {};

declare global {
  interface Window {
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: DomElementInfo | string,
      callback?: (element: HTMLElementTagNameMap[K]) => void,
    ): HTMLElementTagNameMap[K];
    createDiv(
      options?: DomElementInfo | string,
      callback?: (element: HTMLDivElement) => void,
    ): HTMLDivElement;
    createSpan(
      options?: DomElementInfo | string,
      callback?: (element: HTMLSpanElement) => void,
    ): HTMLSpanElement;
    createSvg<K extends keyof SVGElementTagNameMap>(
      tag: K,
      options?: SvgElementInfo | string,
      callback?: (element: SVGElementTagNameMap[K]) => void,
    ): SVGElementTagNameMap[K];
    createFragment(callback?: (element: DocumentFragment) => void): DocumentFragment;
  }
}
