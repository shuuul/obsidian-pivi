import {
  isProviderCardExpanded,
  setProviderCardExpanded,
} from '@/ui/settings/models-settings/expandedProviderCards';
import { renderProviderRow } from '@/ui/settings/models-settings/renderProviderRow';
import { renderProviderModelChecklist } from '@/ui/settings/models-settings/modelChecklist';
import { renderCodexOAuthSection } from '@/ui/settings/models-settings/oauthSection';
import { createMockPiUiFacades } from '../../../helpers/mockPiviPlugin';

jest.mock('@/ui/shared/utils/providerLogoDom', () => ({
  appendProviderLogo: jest.fn(),
}));

jest.mock('@pivi/pivi-agent-core/auth/providerEnvVars', () => ({
  getProviderEnvVarNames: () => ({}),
}));

jest.mock('@pivi/pivi-agent-core/auth/providerSecretStorage', () => ({
  isProviderDisabled: () => false,
}));

jest.mock('@pivi/pivi-agent-core/foundation/providerLogos', () => ({
  getProviderLogoSlug: () => null,
  getLogoSlugForCustomProviderKind: () => null,
}));

jest.mock('@/ui/settings/models-settings/credentialsSection', () => ({
  renderProviderCredentialsSection: jest.fn(),
}));

jest.mock('@/ui/settings/models-settings/modelChecklist', () => ({
  renderProviderModelChecklist: jest.fn(),
}));

jest.mock('@/ui/settings/models-settings/oauthSection', () => ({
  renderCodexOAuthSection: jest.fn(),
}));

jest.mock('@/ui/settings/models-settings/customProviderPanel', () => ({
  renderCustomProviderPanel: jest.fn(),
}));

jest.mock('@pivi/pivi-agent-core/auth/providerReadiness', () => ({
  deriveProviderReadinessStatus: () => ({
    description: 'Connected',
    kind: 'ready',
    label: 'Connected',
  }),
}));

class FakeElement {
  children: FakeElement[] = [];
  className = '';
  text = '';
  open = false;
  private listeners = new Map<string, Array<() => void>>();

  constructor(cls = '') {
    this.className = cls;
  }

  createEl(_tag: string, options?: { cls?: string; text?: string }): FakeElement {
    return this.appendChild(options);
  }

  createDiv(options?: { cls?: string; text?: string }): FakeElement {
    return this.appendChild(options);
  }

  createSpan(options?: { cls?: string; text?: string }): FakeElement {
    return this.appendChild(options);
  }

  addClass(name: string): void {
    this.className = `${this.className} ${name}`.trim();
  }

  addEventListener(type: string, handler: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  setAttr(): void {}

  setText(text: string): void {
    this.text = text;
  }

  private appendChild(options?: { cls?: string; text?: string }): FakeElement {
    const child = new FakeElement(options?.cls);
    child.text = options?.text ?? '';
    this.children.push(child);
    return child;
  }
}

describe('renderProviderRow', () => {
  it('renders the Codex OAuth section and model checklist', () => {
    const container = new FakeElement();
    const context = {
      plugin: {
        settings: {
          agentSettings: {
            addedProviders: ['openai-codex'],
            disabledProviders: [],
            visibleModels: [],
          },
        },
        getAllViews: jest.fn(() => []),
        getUiFacades: jest.fn(() => createMockPiUiFacades({
          listModelsForProvider: () => [
            { value: 'openai-codex/gpt-5.5', label: 'GPT-5.5', description: 'OpenAI Codex' },
          ],
        })),
        getPiWorkspace: jest.fn(() => ({
          credentialStore: null,
          providerOAuth: { hasCodexAuth: () => true },
          modelReadinessProvider: {
            testProvider: jest.fn(),
          },
        })),
        saveSettings: jest.fn(),
      },
      redisplay: jest.fn(),
    };
    const state = {
      piSettings: {
        addedProviders: ['openai-codex'],
        disabledProviders: [],
        visibleModels: [],
        customProviders: [],
      },
      updatePiSettings: jest.fn(),
    };

    renderProviderRow(
      container as unknown as HTMLElement,
      context as any,
      state as any,
      'openai-codex',
      () => 'OpenAI Codex',
    );

    expect(renderCodexOAuthSection).toHaveBeenCalled();
    expect(renderProviderModelChecklist).toHaveBeenCalledWith(
      expect.any(FakeElement),
      context,
      state,
      'openai-codex',
    );
  });

  it('restores expanded provider cards after redisplay', () => {
    setProviderCardExpanded('lmstudio', true);
    expect(isProviderCardExpanded('lmstudio')).toBe(true);

    const container = new FakeElement();
    const context = {
      plugin: {
        settings: {
          agentSettings: {
            addedProviders: ['lmstudio'],
            disabledProviders: [],
            visibleModels: [],
          },
        },
        getAllViews: jest.fn(() => []),
        getUiFacades: jest.fn(() => createMockPiUiFacades({
          listModelsForProvider: () => [],
        })),
        getPiWorkspace: jest.fn(() => ({
          credentialStore: null,
          providerOAuth: { hasCodexAuth: () => false },
          modelReadinessProvider: {
            testProvider: jest.fn(),
          },
        })),
        saveSettings: jest.fn(),
      },
      redisplay: jest.fn(),
    };
    const state = {
      piSettings: {
        addedProviders: ['lmstudio'],
        disabledProviders: [],
        visibleModels: [],
        customProviders: [{
          id: 'lmstudio',
          kind: 'lmstudio',
          name: 'LM Studio',
          baseUrl: 'http://localhost:1234/v1',
          api: 'openai-completions',
          apiKeyRequired: false,
          models: [],
        }],
      },
      updatePiSettings: jest.fn(),
    };

    renderProviderRow(
      container as unknown as HTMLElement,
      context as any,
      state as any,
      'lmstudio',
      () => 'LM Studio',
    );

    const [card] = container.children;
    expect(card).toBeDefined();
    if (!card) throw new Error('Expected a provider card');
    expect(card.className).toContain('pivi-provider-card');
    expect(card.open).toBe(true);

    setProviderCardExpanded('lmstudio', false);
  });
});
