const REDACTION = '[credential redacted]';

/** Pure, literal sanitizer for text that is about to cross the Mobile UI boundary. */
export function sanitizeMobileDiagnostic(value: string, credential?: string): string {
  if (!credential) return value;
  return value.split(credential).join(REDACTION);
}
