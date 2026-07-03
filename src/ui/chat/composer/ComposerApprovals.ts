import type { ApprovalDecision, ExitPlanModeDecision } from '@pivi/pivi-agent-core/foundation';
import type {
  ApprovalCallbackOptions,
  ApprovalDecisionOption,
} from '@pivi/pivi-agent-core/runtime';
import { Notice } from 'obsidian';

import type { StreamController } from '../controllers/StreamController';
import { type InlineAskQuestionConfig, InlineAskUserQuestion } from '../rendering/InlineAskUserQuestion';
import { InlineExitPlanMode } from '../rendering/InlineExitPlanMode';
import { InlinePlanApproval, type PlanApprovalDecision } from '../rendering/InlinePlanApproval';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import { setToolIcon } from '../rendering/ToolCallRenderer';
import type { ChatState } from '../state/ChatState';

const APPROVAL_OPTION_MAP: Record<string, ApprovalDecision> = {
  'Deny': 'deny',
  'Allow once': 'allow',
  'Always allow': 'allow-always',
};

const DEFAULT_APPROVAL_DECISION_OPTIONS: ApprovalDecisionOption[] =
  Object.entries(APPROVAL_OPTION_MAP).map(([label, decision]) => ({
    label,
    value: label,
    decision,
  }));

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export interface ComposerApprovalsDeps {
  state: ChatState;
  renderer: MessageRenderer;
  streamController: StreamController;
  getInputContainerEl: () => HTMLElement;
}

export class ComposerApprovals {
  private pendingApprovalInline: InlineAskUserQuestion | null = null;
  private pendingAskInline: InlineAskUserQuestion | null = null;
  private pendingExitPlanModeInline: InlineExitPlanMode | null = null;
  private pendingPlanApproval: InlinePlanApproval | null = null;
  private pendingPlanApprovalInvalidated = false;
  private inputContainerHideDepth = 0;

  constructor(private readonly deps: ComposerApprovalsDeps) {}

  async handleApprovalRequest(
    toolName: string,
    _input: Record<string, unknown>,
    description: string,
    approvalOptions?: ApprovalCallbackOptions,
  ): Promise<ApprovalDecision> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      throw new Error('Input container is detached from DOM');
    }

    // Build header element, then detach — InlineAskUserQuestion will re-attach it
    const headerEl = parentEl.createDiv({ cls: 'pivi-ask-approval-info' });
    headerEl.remove();

    const toolEl = headerEl.createDiv({ cls: 'pivi-ask-approval-tool' });
    const iconEl = toolEl.createSpan({ cls: 'pivi-ask-approval-icon' });
    iconEl.setAttribute('aria-hidden', 'true');
    setToolIcon(iconEl, toolName);
    toolEl.createSpan({ text: toolName, cls: 'pivi-ask-approval-tool-name' });

    if (approvalOptions?.decisionReason) {
      headerEl.createDiv({ text: approvalOptions.decisionReason, cls: 'pivi-ask-approval-reason' });
    }
    if (approvalOptions?.blockedPath) {
      headerEl.createDiv({ text: approvalOptions.blockedPath, cls: 'pivi-ask-approval-blocked-path' });
    }
    if (approvalOptions?.agentID) {
      headerEl.createDiv({ text: `Agent: ${approvalOptions.agentID}`, cls: 'pivi-ask-approval-agent' });
    }

    headerEl.createDiv({ text: description, cls: 'pivi-ask-approval-desc' });

    const decisionOptions = approvalOptions?.decisionOptions ?? DEFAULT_APPROVAL_DECISION_OPTIONS;
    const optionDecisionMap = new Map<string, ApprovalDecision>();
    const questionOptions = decisionOptions.map((option, index) => {
      const value = option.value || `approval-option-${index}`;
      if (option.decision) {
        optionDecisionMap.set(value, option.decision);
      }
      return {
        label: option.label,
        description: option.description ?? '',
        value,
      };
    });
    const input = {
      questions: [{
        question: 'Allow this action?',
        options: questionOptions,
        isOther: false,
        isSecret: false,
      }],
    };

    const result = await this.showInlineQuestion(
      parentEl,
      inputContainerEl,
      input,
      (inline) => { this.pendingApprovalInline = inline; },
      undefined,
      { title: 'Permission required', headerEl, showCustomInput: false, immediateSelect: true },
    );

    if (!result) return 'cancel';
    const selected = Object.values(result)[0];
    const selectedValue = Array.isArray(selected) ? selected[0] : selected;
    if (typeof selectedValue !== 'string') {
      new Notice(`Unexpected approval selection: "${String(selectedValue)}"`);
      return 'cancel';
    }

    const decision = optionDecisionMap.get(selectedValue);
    if (decision) {
      return decision;
    }

    return {
      type: 'select-option',
      value: selectedValue,
    };
  }

  async handleAskUserQuestion(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, string | string[]> | null> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      throw new Error('Input container is detached from DOM');
    }

    return this.showInlineQuestion(
      parentEl,
      inputContainerEl,
      input,
      (inline) => { this.pendingAskInline = inline; },
      signal,
    );
  }

  async handleExitPlanMode(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ExitPlanModeDecision | null> {
    const { state, streamController } = this.deps;
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      throw new Error('Input container is detached from DOM');
    }

    streamController.hideThinkingIndicator();
    this.hideInputContainer(inputContainerEl);

    const enrichedInput = state.planFilePath
      ? { ...input, planFilePath: state.planFilePath }
      : input;

    const renderContent = (el: HTMLElement, markdown: string) =>
      this.deps.renderer.renderContent(el, markdown);

    return new Promise<ExitPlanModeDecision | null>((resolve, reject) => {
      const inline = new InlineExitPlanMode(
        parentEl,
        enrichedInput,
        (decision: ExitPlanModeDecision | null) => {
          this.pendingExitPlanModeInline = null;
          this.restoreInputContainer(inputContainerEl);
          resolve(decision);
        },
        signal,
        renderContent,
      );
      this.pendingExitPlanModeInline = inline;
      try {
        inline.render();
      } catch (err) {
        this.pendingExitPlanModeInline = null;
        this.restoreInputContainer(inputContainerEl);
        reject(toError(err));
      }
    });
  }

  dismissPendingApprovalPrompt(): void {
    if (this.pendingApprovalInline) {
      this.pendingApprovalInline.destroy();
      this.pendingApprovalInline = null;
    }
  }

  dismissPendingApproval(): void {
    this.dismissPendingApprovalPrompt();
    if (this.pendingAskInline) {
      this.pendingAskInline.destroy();
      this.pendingAskInline = null;
    }
    if (this.pendingExitPlanModeInline) {
      this.pendingExitPlanModeInline.destroy();
      this.pendingExitPlanModeInline = null;
    }
    this.dismissPendingPlanApproval(true);
    this.resetInputContainerVisibility();
  }

  showPlanApproval(): Promise<{ decision: PlanApprovalDecision | null; invalidated: boolean }> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      return Promise.resolve({ decision: null, invalidated: false });
    }

    this.hideInputContainer(inputContainerEl);
    this.pendingPlanApprovalInvalidated = false;

    return new Promise<{ decision: PlanApprovalDecision | null; invalidated: boolean }>((resolve, reject) => {
      const inline = new InlinePlanApproval(
        parentEl,
        (decision: PlanApprovalDecision | null) => {
          const invalidated = this.pendingPlanApprovalInvalidated;
          this.pendingPlanApprovalInvalidated = false;
          this.pendingPlanApproval = null;
          this.restoreInputContainer(inputContainerEl);
          resolve({ decision, invalidated });
        },
      );
      this.pendingPlanApproval = inline;
      try {
        inline.render();
      } catch (err) {
        this.pendingPlanApproval = null;
        this.pendingPlanApprovalInvalidated = false;
        this.restoreInputContainer(inputContainerEl);
        reject(toError(err));
      }
    });
  }

  private showInlineQuestion(
    parentEl: HTMLElement,
    inputContainerEl: HTMLElement,
    input: Record<string, unknown>,
    setPending: (inline: InlineAskUserQuestion | null) => void,
    signal?: AbortSignal,
    config?: InlineAskQuestionConfig,
  ): Promise<Record<string, string | string[]> | null> {
    this.deps.streamController.hideThinkingIndicator();
    this.hideInputContainer(inputContainerEl);

    return new Promise<Record<string, string | string[]> | null>((resolve, reject) => {
      const inline = new InlineAskUserQuestion(
        parentEl,
        input,
        (result: Record<string, string | string[]> | null) => {
          setPending(null);
          this.restoreInputContainer(inputContainerEl);
          resolve(result);
        },
        signal,
        config,
      );
      setPending(inline);
      try {
        inline.render();
      } catch (err) {
        setPending(null);
        this.restoreInputContainer(inputContainerEl);
        reject(toError(err));
      }
    });
  }

  private dismissPendingPlanApproval(invalidated: boolean): void {
    if (!this.pendingPlanApproval) {
      return;
    }

    if (invalidated) {
      this.pendingPlanApprovalInvalidated = true;
    }
    this.pendingPlanApproval.destroy();
    this.pendingPlanApproval = null;
  }

  private hideInputContainer(inputContainerEl: HTMLElement): void {
    this.inputContainerHideDepth++;
    inputContainerEl.addClass('pivi-hidden');
  }

  private restoreInputContainer(inputContainerEl: HTMLElement): void {
    if (this.inputContainerHideDepth <= 0) return;
    this.inputContainerHideDepth--;
    if (this.inputContainerHideDepth === 0) {
      inputContainerEl.removeClass('pivi-hidden');
    }
  }

  private resetInputContainerVisibility(): void {
    if (this.inputContainerHideDepth > 0) {
      this.inputContainerHideDepth = 0;
      this.deps.getInputContainerEl().removeClass('pivi-hidden');
    }
  }
}
