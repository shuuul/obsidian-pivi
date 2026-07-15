import type { Component } from 'obsidian';

export interface RenderContentOptions {
  /** Scope that owns Markdown postprocessors and async renderer cleanup. */
  component?: Component;
  deferMath?: boolean;
  /** Vault-relative source used to resolve relative links in rendered Markdown. */
  sourcePath?: string;
}

export type RenderContentFn = (
  el: HTMLElement,
  markdown: string,
  options?: RenderContentOptions,
) => Promise<void>;
