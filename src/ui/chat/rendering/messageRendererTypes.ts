export interface RenderContentOptions {
  deferMath?: boolean;
  /** Vault-relative source used to resolve relative links in rendered Markdown. */
  sourcePath?: string;
}

export type RenderContentFn = (
  el: HTMLElement,
  markdown: string,
  options?: RenderContentOptions,
) => Promise<void>;
