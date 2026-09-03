import type { SettingsFeedbackMessage } from '../../ports';

export function SettingsFeedback({ feedback }: { readonly feedback?: SettingsFeedbackMessage | null }) {
  if (!feedback) return null;
  return (
    <span
      className={`pivi-settings-feedback is-${feedback.kind}`}
      role={feedback.kind === 'error' ? 'alert' : 'status'}
    >
      {feedback.message}
    </span>
  );
}
