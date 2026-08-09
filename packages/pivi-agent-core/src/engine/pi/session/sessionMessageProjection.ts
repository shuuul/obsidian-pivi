import { createHash } from 'crypto';

import { extractUserQuery } from '../../../session/userQuery';
import { extractAgentTextContent, normalizeVisibleUserText } from './sessionMessageText';

export { extractAgentTextContent, normalizeVisibleUserText };

export function hashVisibleUserText(text: string): string {
  return createHash('sha256').update(normalizeVisibleUserText(text)).digest('hex');
}

export function hashDurableUserContent(content: unknown): string {
  return hashVisibleUserText(extractUserQuery(extractAgentTextContent(content)));
}
