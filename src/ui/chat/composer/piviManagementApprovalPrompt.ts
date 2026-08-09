import type {
  PiviManagementApprovalDecision,
  PiviManagementApprovalRequest,
} from '@pivi/agent/tools/piviManagement';

import { t } from '@/app/i18n';

import type { InlineAskQuestionConfig } from '../rendering/InlineAskUserQuestion';

export function buildPiviManagementApprovalPrompt(
  request: PiviManagementApprovalRequest,
): { input: Record<string, unknown>; config: InlineAskQuestionConfig } {
  const normalized = [
    ...(request.changeLines ?? []),
    ...(request.fields ?? []).map(({ label, value }) =>
      `${label}: ${Array.isArray(value) ? value.join(', ') : String(value)}`),
  ];
  return {
    input: {
      questions: [{
        question: [request.title, ...normalized].join('\n'),
        options: [
          { label: t('chat.piviManagementApproval.confirm'), description: '', value: 'confirm' },
          { label: t('chat.piviManagementApproval.deny'), description: '', value: 'deny' },
        ],
        isOther: false,
        isSecret: false,
      }],
    },
    config: {
      title: t('chat.piviManagementApproval.title'),
      showCustomInput: false,
      immediateSelect: true,
    },
  };
}

export function parsePiviManagementDecision(
  result: Record<string, string | string[]> | null,
): PiviManagementApprovalDecision {
  const value = result ? Object.values(result)[0] : null;
  const selected = Array.isArray(value) ? value[0] : value;
  return selected === 'confirm' || selected === 'deny' ? selected : 'cancel';
}
