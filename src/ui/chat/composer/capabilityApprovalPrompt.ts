import type {
  CapabilityApprovalRequest,
  CapabilityApprovalResult,
} from '@pivi/pivi-agent-core/ports';
import {
  bashAllowlistPersistScopesDiffer,
  resolveBashAllowlistPersistEntry,
} from '@pivi/pivi-agent-core/runtime/capabilitySessionGrants';

import { t } from '@/app/i18n';

import { type InlineAskQuestionConfig, InlineAskUserQuestion } from '../rendering/InlineAskUserQuestion';
import { appendToolIcon } from '../rendering/toolCallIcon';
import type { ComposerInlinePromptsDeps } from './ComposerInlinePrompts';

const SCOPE_BY_OPTION: Record<string, CapabilityApprovalResult['decision']> = {
  deny: 'deny',
  once: 'allow',
  session: 'allow-session',
  always: 'allow-always',
};

function buildApprovalHeader(parentEl: HTMLElement, request: CapabilityApprovalRequest): HTMLElement {
  const headerEl = parentEl.createDiv({ cls: 'pivi-ask-approval-info' });
  headerEl.remove();

  const toolEl = headerEl.createDiv({ cls: 'pivi-ask-approval-tool' });
  const iconEl = toolEl.createSpan({ cls: 'pivi-ask-approval-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  appendToolIcon(iconEl, request.toolName);
  toolEl.createSpan({ text: request.toolName, cls: 'pivi-ask-approval-tool-name' });

  headerEl.createDiv({ text: request.reason, cls: 'pivi-ask-approval-reason' });
  if (request.blockedPath) {
    headerEl.createDiv({ text: request.blockedPath, cls: 'pivi-ask-approval-blocked-path' });
  }
  headerEl.createDiv({ text: request.description, cls: 'pivi-ask-approval-desc' });

  return headerEl;
}

function readSelectedOption(result: Record<string, string | string[]> | null): string | null {
  if (!result) {
    return null;
  }
  const selected = Object.values(result)[0];
  const selectedValue = Array.isArray(selected) ? selected[0] : selected;
  return typeof selectedValue === 'string' ? selectedValue : null;
}

async function askApprovalStep(
  deps: ComposerInlinePromptsDeps,
  parentEl: HTMLElement,
  setPending: (inline: InlineAskUserQuestion | null) => void,
  input: Record<string, unknown>,
  config: InlineAskQuestionConfig,
): Promise<Record<string, string | string[]> | null> {
  deps.streamController.hideThinkingIndicator();

  return new Promise<Record<string, string | string[]> | null>((resolve, reject) => {
    try {
      const inline = new InlineAskUserQuestion(
        parentEl,
        input,
        (resolved) => {
          setPending(null);
          resolve(resolved);
        },
        undefined,
        config,
      );
      setPending(inline);
      inline.render();
      inline.rootEl.scrollIntoView({ block: 'nearest' });
    } catch (error) {
      setPending(null);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export async function showCapabilityApprovalPrompt(
  deps: ComposerInlinePromptsDeps,
  request: CapabilityApprovalRequest,
  setPending: (inline: InlineAskUserQuestion | null) => void,
  hideInputContainer: (el: HTMLElement) => void,
  restoreInputContainer: (el: HTMLElement) => void,
): Promise<CapabilityApprovalResult> {
  const inputContainerEl = deps.getInputContainerEl();
  const parentEl = inputContainerEl.parentElement;
  if (!parentEl) {
    throw new Error('Input container is detached from DOM');
  }

  const headerEl = buildApprovalHeader(parentEl, request);
  hideInputContainer(inputContainerEl);

  try {
    const scopeResult = await askApprovalStep(
      deps,
      parentEl,
      setPending,
      {
        questions: [{
          question: t('chat.capabilityApproval.scopeQuestion'),
          options: [
            { label: t('chat.capabilityApproval.deny'), description: '', value: 'deny' },
            { label: t('chat.capabilityApproval.allowOnce'), description: '', value: 'once' },
            { label: t('chat.capabilityApproval.allowSession'), description: '', value: 'session' },
            {
              label: t('chat.capabilityApproval.allowAlways'),
              description: t('chat.capabilityApproval.allowAlwaysDescription'),
              value: 'always',
            },
          ],
          isOther: false,
          isSecret: false,
        }],
      },
      {
        title: t('chat.capabilityApproval.title'),
        headerEl,
        showCustomInput: false,
        immediateSelect: true,
      },
    );

    const scopeOption = readSelectedOption(scopeResult);
    if (!scopeOption) {
      return { decision: 'cancel' };
    }
    const decision = SCOPE_BY_OPTION[scopeOption];
    if (!decision || decision === 'deny') {
      return { decision: decision ?? 'cancel' };
    }
    if (decision !== 'allow-always') {
      return { decision };
    }

    const command = request.command?.trim() ?? '';
    if (request.kind !== 'bash' || !command || !bashAllowlistPersistScopesDiffer(command)) {
      return { decision: 'allow-always', bashAllowlistScope: 'full' };
    }

    const prefix = resolveBashAllowlistPersistEntry(command, 'prefix');
    const persistResult = await askApprovalStep(
      deps,
      parentEl,
      setPending,
      {
        questions: [{
          question: t('chat.capabilityApproval.bashPersistQuestion'),
          options: [
            {
              label: t('chat.capabilityApproval.bashPersistFull'),
              description: t('chat.capabilityApproval.bashPersistFullDescription', { command }),
              value: 'full',
            },
            {
              label: t('chat.capabilityApproval.bashPersistPrefix'),
              description: t('chat.capabilityApproval.bashPersistPrefixDescription', { prefix }),
              value: 'prefix',
            },
            { label: t('chat.capabilityApproval.deny'), description: '', value: 'deny' },
          ],
          isOther: false,
          isSecret: false,
        }],
      },
      {
        title: t('chat.capabilityApproval.bashPersistTitle'),
        headerEl,
        showCustomInput: false,
        immediateSelect: true,
      },
    );

    const persistOption = readSelectedOption(persistResult);
    if (!persistOption || persistOption === 'deny') {
      return { decision: persistOption === 'deny' ? 'deny' : 'cancel' };
    }
    if (persistOption !== 'full' && persistOption !== 'prefix') {
      return { decision: 'cancel' };
    }
    return { decision: 'allow-always', bashAllowlistScope: persistOption };
  } finally {
    restoreInputContainer(inputContainerEl);
  }
}
