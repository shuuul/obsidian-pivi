import { createContext, type ReactNode, useContext } from 'react';

import type { ChatPorts } from '../ports';

const ChatPortsContext = createContext<ChatPorts | null>(null);

export function ChatPortsProvider({
  ports,
  children,
}: {
  ports: ChatPorts;
  children: ReactNode;
}) {
  return <ChatPortsContext.Provider value={ports}>{children}</ChatPortsContext.Provider>;
}

export function useChatPorts(): ChatPorts {
  const ports = useContext(ChatPortsContext);
  if (!ports) {
    throw new Error('useChatPorts requires ChatPortsProvider.');
  }
  return ports;
}
