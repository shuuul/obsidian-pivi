export interface RenderContentOptions {
  deferMath?: boolean;
}

export type RenderContentFn = (
  el: HTMLElement,
  markdown: string,
  options?: RenderContentOptions,
) => Promise<void>;