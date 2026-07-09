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

  addEventListener(): void {}

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
});
