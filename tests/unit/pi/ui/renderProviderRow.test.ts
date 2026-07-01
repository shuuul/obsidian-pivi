import { renderProviderRow } from '../../../../src/pi/ui/models-settings/renderProviderRow';
import { renderProviderModelChecklist } from '../../../../src/pi/ui/models-settings/modelChecklist';
import { renderCodexOAuthSection } from '../../../../src/pi/ui/models-settings/oauthSection';

jest.mock('../../../../src/pi/ui/providerLogoDom', () => ({
  appendProviderLogo: jest.fn(),
}));

jest.mock('../../../../src/pi/auth/providerEnvVars', () => ({
  getProviderEnvVarNames: () => ({}),
}));

jest.mock('../../../../src/pi/auth/ProviderSecretStorage', () => ({
  isProviderDisabled: () => false,
}));

jest.mock('../../../../src/pi/ui/PiChatUIConfig', () => ({
  getPiAiModelsForProvider: () => [{ value: 'openai-codex/gpt-5.5', label: 'GPT-5.5', description: 'OpenAI Codex' }],
}));

jest.mock('../../../../src/pi/ui/providerLogos', () => ({
  getProviderLogoSlug: () => null,
}));

jest.mock('../../../../src/pi/ui/models-settings/credentialsSection', () => ({
  renderProviderCredentialsSection: jest.fn(),
}));

jest.mock('../../../../src/pi/ui/models-settings/modelChecklist', () => ({
  renderProviderModelChecklist: jest.fn(),
}));

jest.mock('../../../../src/pi/ui/models-settings/oauthSection', () => ({
  renderCodexOAuthSection: jest.fn(),
}));

jest.mock('../../../../src/pi/ui/models-settings/providerStatus', () => ({
  deriveProviderReadinessStatus: () => ({
    description: 'Connected',
    kind: 'ready',
    label: 'Connected',
  }),
}));

jest.mock('../../../../src/pi/ui/models-settings/testProviderReadiness', () => ({
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
