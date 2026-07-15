import { createHash } from 'crypto';

import { extractUserQuery } from '../../../session/userQuery';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function extractAgentTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter((part): part is { type: 'text'; text: string } => (
      isRecord(part) && part.type === 'text' && typeof part.text === 'string'
    ))
    .map((part) => part.text)
    .join('');
}

export function normalizeVisibleUserText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function hashVisibleUserText(text: string): string {
  return createHash('sha256').update(normalizeVisibleUserText(text)).digest('hex');
}

export function hashDurableUserContent(content: unknown): string {
  return hashVisibleUserText(extractUserQuery(extractAgentTextContent(content)));
}
