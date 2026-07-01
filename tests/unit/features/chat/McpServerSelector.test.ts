import { Notice } from 'obsidian';

import { McpServerManager } from '../../../../src/pi/mcp/McpServerManager';
import type { ManagedMcpServer } from '../../../../src/pi/types';
import { McpServerSelector } from '../../../../src/features/chat/ui/InputToolbar';

jest.mock('../../../../src/pi/ui/icons', () => ({
  appendCheckIcon: jest.fn(),
  appendMcpIcon: jest.fn(),
}));

class FakeElement {
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  text = '';
  ownerDocument = {};
  private classes = new Set<string>();
  private attributes = new Map<string, string>();
  private listeners = new Map<string, Array<(event: FakeEvent) => void>>();

  constructor(cls = '') {
    for (const name of cls.split(/\s+/).filter(Boolean)) {
      this.classes.add(name);
    }
  }

  createDiv(options?: { cls?: string; text?: string }): FakeElement {
    return this.appendChild(options);
  }

  createSpan(options?: { cls?: string; text?: string }): FakeElement {
    return this.appendChild(options);
  }

  createEl(_tag: string, options?: { cls?: string; text?: string; type?: string }): FakeElement {
    return this.appendChild(options);
  }

  empty(): void {
    this.children = [];
  }

  addEventListener(eventName: string, callback: (event: FakeEvent) => void): void {
    const listeners = this.listeners.get(eventName) ?? [];
    listeners.push(callback);
    this.listeners.set(eventName, listeners);
  }

  click(): void {
    this.dispatch('click');
  }

  dispatch(eventName: string): void {
    const event = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    };
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener(event);
    }
  }

  setText(text: string): void {
    this.text = text;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addClass(name: string): void {
    this.classes.add(name);
  }

  removeClass(name: string): void {
    this.classes.delete(name);
  }

  toggleClass(name: string, enabled: boolean): void {
    if (enabled) {
      this.addClass(name);
    } else {
      this.removeClass(name);
    }
  }

  querySelector(selector: string): FakeElement | null {
    if (!selector.startsWith('.')) {
      return null;
    }
    return this.findByClass(selector.slice(1)) ?? null;
  }

  findByText(text: string): FakeElement | undefined {
    if (this.text === text) return this;
    for (const child of this.children) {
      const result = child.findByText(text);
      if (result) return result;
    }
    return undefined;
  }

  findByClass(className: string): FakeElement | undefined {
    if (this.classes.has(className)) return this;
    for (const child of this.children) {
      const result = child.findByClass(className);
      if (result) return result;
    }
    return undefined;
  }

  private appendChild(options?: { cls?: string; text?: string }): FakeElement {
    const child = new FakeElement(options?.cls);
    child.ownerDocument = this.ownerDocument;
    child.text = options?.text ?? '';
    this.children.push(child);
    return child;
  }
}

type FakeEvent = {
  preventDefault: jest.Mock;
  stopPropagation: jest.Mock;
};

async function createManager(servers: ManagedMcpServer[]): Promise<McpServerManager> {
  const manager = new McpServerManager({ load: jest.fn(async () => servers) });
  await manager.loadServers();
  return manager;
}

describe('McpServerSelector recovery actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders auth/test/settings actions and runs them without toggling the server', async () => {
    const server: ManagedMcpServer = {
      name: 'remote',
      enabled: true,
      contextSaving: true,
      config: { type: 'http', url: 'https://mcp.example.com' },
      auth: 'oauth',
    };
    const manager = await createManager([server]);
    const parent = new FakeElement();
    const selector = new McpServerSelector(parent as unknown as HTMLElement);
    const authenticate = jest.fn().mockResolvedValue('authenticated');
    const testServer = jest.fn().mockResolvedValue({ toolCount: 2 });
    const openSettings = jest.fn();
    const onChange = jest.fn();

    selector.setOnChange(onChange);
    selector.setMcpManager(manager);
    selector.setRecoveryActions({
      mcpOAuth: { authenticate, getAuthStatus: jest.fn(), logout: jest.fn() },
      mcpProbeProvider: { testServer },
      openSettings,
    });

    parent.findByText('Auth')?.click();
    await Promise.resolve();
    parent.findByText('Test')?.click();
    await Promise.resolve();
    parent.findByText('Settings')?.click();

    expect(authenticate).toHaveBeenCalledWith(server);
    expect(testServer).toHaveBeenCalledWith('remote');
    expect(openSettings).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledWith('MCP server "remote" authenticated.');
    expect(Notice).toHaveBeenCalledWith('MCP server "remote" reachable (2 tools).');
  });
});
