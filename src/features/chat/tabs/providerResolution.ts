import { DEFAULT_CHAT_PROVIDER_ID, type ProviderId } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import type ObsiusPlugin from '../../../main';
import type { TabProviderContext } from './types';

export function getTabProviderId(
  tab: TabProviderContext,
  plugin: ObsiusPlugin,
  conversation?: Conversation | null,
): ProviderId {
  return conversation?.providerId
    ?? tab.service?.providerId
    ?? tab.providerId
    ?? DEFAULT_CHAT_PROVIDER_ID;
}
