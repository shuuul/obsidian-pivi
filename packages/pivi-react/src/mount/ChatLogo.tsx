import type { ChatIconSvg } from '@pivi/agent/runtime/chatUi';

import { PiviBrandIcon } from './PiviBrandIcon';

export function ChatLogo({ icon }: { icon: ChatIconSvg | null }) {
  if (!icon) return null;
  return <PiviBrandIcon className="pivi-brand-icon" />;
}
