import type {
  CapabilityApprovalRequest,
  CapabilityApprovalResult,
} from '@pivi/agent/ports';
import type { PersistentBashPermission } from '@pivi/agent/tools';

import { t } from '@/app/i18n';

import { type InlineAskQuestionConfig, InlineAskUserQuestion } from '../rendering/InlineAskUserQuestion';
import { appendToolIcon } from '../rendering/toolCallIcon';
import type { ComposerInlinePromptsDeps } from './ComposerInlinePrompts';

const SCOPE_BY_OPTION: Record<string, CapabilityApprovalResult['decision']> = {
  deny: 'deny',
  once: 'allow-once',
  always: 'allow-always',
};

function buildApprovalHeader(
  parentEl: HTMLElement,
  request: CapabilityApprovalRequest,
  selectedPermissions: PersistentBashPermission[],
  onSelect: (permissions: PersistentBashPermission[]) => void,
): HTMLElement {
  const headerEl = parentEl.createDiv({ cls: 'pivi-ask-approval-info' });
  headerEl.remove();

  const toolEl = headerEl.createDiv({ cls: 'pivi-ask-approval-tool' });
  const iconEl = toolEl.createSpan({ cls: 'pivi-ask-approval-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  appendToolIcon(iconEl, request.toolName);
  toolEl.createSpan({ text: request.toolName, cls: 'pivi-ask-approval-tool-name' });

  headerEl.createDiv({ text: request.reason, cls: 'pivi-ask-approval-reason' });
  if (request.kind === 'external-directory' && request.directoryRoot) {
    headerEl.createDiv({ text: request.directoryRoot, cls: 'pivi-ask-approval-blocked-path' });
  } else if (request.blockedPath) {
    headerEl.createDiv({ text: request.blockedPath, cls: 'pivi-ask-approval-blocked-path' });
  }
  headerEl.createDiv({ text: request.description, cls: 'pivi-ask-approval-desc' });

  const classification = request.bashClassification;
  if (request.kind === 'bash' && classification?.persistable) {
    const scopesEl = headerEl.createDiv({ cls: 'pivi-ask-approval-scopes' });
    scopesEl.createDiv({
      text: t('chat.capabilityApproval.persistentScopes'),
      cls: 'pivi-ask-approval-scopes-label',
    });
    const selected = [...selectedPermissions];
    classification.components.forEach((component, index) => {
      const row = scopesEl.createDiv({ cls: 'pivi-ask-approval-scope-row' });
      const candidates = component.broader
        ? [component.recommended, component.broader]
        : [component.recommended];
      if (candidates.length === 1) {
        row.createSpan({ text: component.displayLabel });
        return;
      }
      const selectEl = row.createEl('select', { cls: 'pivi-ask-approval-scope-select' });
      selectEl.setAttribute('aria-label', t('chat.capabilityApproval.scopeSelector'));
      for (const candidate of candidates) {
        const option = selectEl.createEl('option');
        option.value = candidate.kind;
        option.textContent = candidate.kind === 'subcommand'
          ? `${candidate.executable.value} ${candidate.subcommand}`
          : t('chat.capabilityApproval.executableScope', { executable: candidate.executable.value });
      }
      const warningEl = row.createDiv({
        text: t('chat.capabilityApproval.broaderWarning'),
        cls: 'pivi-ask-approval-warning pivi-hidden',
      });
      selectEl.addEventListener('change', () => {
        const next = candidates.find(candidate => candidate.kind === selectEl.value) ?? component.recommended;
        selected[index] = next;
        onSelect([...selected]);
        warningEl.toggleClass('pivi-hidden', next.kind !== 'executable' || !component.broader);
      });
    });
    if (classification.components.some(component => component.risk !== 'none')) {
      scopesEl.createDiv({
        text: t('chat.capabilityApproval.highRiskWarning'),
        cls: 'pivi-ask-approval-warning',
      });
    }
  } else if (request.kind === 'bash' && classification && !classification.persistable) {
    headerEl.createDiv({
      text: t('chat.capabilityApproval.alwaysUnavailable'),
      cls: 'pivi-ask-approval-warning',
    });
  }

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

  const persistable = request.kind !== 'bash'
    || request.bashClassification?.persistable === true;
  let selectedPermissions: PersistentBashPermission[] = request.bashClassification?.persistable
    ? request.bashClassification.components.map(component => component.recommended)
    : [];

  const headerEl = buildApprovalHeader(parentEl, request, selectedPermissions, (next) => {
    selectedPermissions = next;
  });
  hideInputContainer(inputContainerEl);

  try {
    const alwaysOption = persistable
      ? {
          label: t('chat.capabilityApproval.allowAlways'),
          description: t('chat.capabilityApproval.allowAlwaysDescription'),
          value: 'always',
        }
      : {
          label: t('chat.capabilityApproval.allowAlways'),
          description: t('chat.capabilityApproval.alwaysUnavailable'),
          value: 'always-disabled',
        };
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
            alwaysOption,
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
    if (!scopeOption || scopeOption === 'always-disabled') {
      return { decision: scopeOption === 'always-disabled' ? 'cancel' : 'cancel' };
    }
    const decision = SCOPE_BY_OPTION[scopeOption];
    if (!decision || decision === 'deny') {
      return { decision: decision ?? 'cancel' };
    }
    if (decision === 'allow-always') {
      return { decision, bashPermissions: selectedPermissions };
    }
    return { decision };
  } finally {
    restoreInputContainer(inputContainerEl);
  }
}
