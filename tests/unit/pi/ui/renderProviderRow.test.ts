import { renderProviderRow } from '@/ui/settings/models-settings/renderProviderRow';
import { renderProviderModelChecklist } from '@/ui/settings/models-settings/modelChecklist';
import { renderCodexOAuthSection } from '@/ui/settings/models-settings/oauthSection';

jest.mock('@/ui/settings/providerLogoDom', () => ({
  appendProviderLogo: jest.fn(),
}));

jest.mock('@pivi/pivi-agent-core/auth/providerEnvVars', () => ({
  getProviderEnvVarNames: () => ({}),
}));

jest.mock('@pivi/pivi-agent-core/auth/ProviderSecretStorage', () => ({
  isProviderDisabled: () => false,
}));

jest.mock('@pivi/pivi-agent-core/engine/pi/PiModelRegistry', () => ({
  getPiAiModelsForProvider: () => [{ value: 'openai-codex/gpt-5.5', label: 'GPT-5.5', description: 'OpenAI Codex' }],
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

jest.mock('@/ui/settings/models-settings/testProviderReadiness', () => ({
  testProviderReadiness: jest.fn(),
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
        getAllViews: jest.fn(() => []),
        getPiWorkspace: jest.fn(() => ({
          credentialStore: null,
          providerOAuth: { hasCodexAuth: () => true },
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
