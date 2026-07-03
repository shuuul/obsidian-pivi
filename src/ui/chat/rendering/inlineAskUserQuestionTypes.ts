import type { AskUserQuestionItem, AskUserQuestionOption } from '@pivi/pivi-agent-core/foundation/tools';

export interface InlineAskQuestionConfig {
  title?: string;
  headerEl?: HTMLElement;
  showCustomInput?: boolean;
  immediateSelect?: boolean;
}

export type InlineAskQuestionResolvedConfig = Required<Omit<InlineAskQuestionConfig, 'headerEl'>> & {
  headerEl?: HTMLElement;
};

/** Shared state surface used by render and keyboard helpers. */
export interface InlineAskUserQuestionHost {
  config: InlineAskQuestionResolvedConfig;
  questions: AskUserQuestionItem[];
  answers: Map<number, Set<string>>;
  customInputs: Map<number, string>;
  activeTabIndex: number;
  focusedItemIndex: number;
  isInputFocused: boolean;
  tabBar: HTMLElement;
  contentArea: HTMLElement;
  tabElements: HTMLElement[];
  currentItems: HTMLElement[];
  rootEl: HTMLElement;
  isQuestionAnswered(idx: number): boolean;
  switchTab(index: number): void;
  selectOption(qIdx: number, option: AskUserQuestionOption): void;
  getOptionValue(option: AskUserQuestionOption): string;
  getSelectedLabels(idx: number): string[];
  canShowCustomInputForQuestion(question: AskUserQuestionItem): boolean;
  handleSubmit(): void;
  handleResolve(result: Record<string, string | string[]> | null): void;
}