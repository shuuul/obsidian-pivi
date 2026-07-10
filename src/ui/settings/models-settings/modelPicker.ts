import {
  ALL_CUSTOM_PROVIDER_KINDS,
  createDefaultCustomProviderConfig,
  type CustomProviderKind,
  FIXED_LOCAL_PROVIDER_IDS,
  getCustomProviderKindDisplayName,
  isLocalCustomProviderKind,
} from '@pivi/pivi-agent-core/foundation/customProviders';
import {
  getLogoSlugForCustomProviderKind,
  getProviderLogoSlug,
} from '@pivi/pivi-agent-core/foundation/providerLogos';
import { Notice } from 'obsidian';

import { t } from '@/i18n';
import { appendProviderLogo } from '@/ui/shared/utils/providerLogoDom';

import { setProviderCardExpanded } from './expandedProviderCards';
import type { PiModelsSettingsContext, PiModelsSettingsState } from './types';

export function renderAddProviderPicker(
  container: HTMLElement,
  context: PiModelsSettingsContext,
  state: PiModelsSettingsState,
  providersNotAdded: string[],
  getDisplayName: (id: string) => string,
): void {
  const customProviders = state.piSettings.customProviders ?? [];
  const localKinds = ALL_CUSTOM_PROVIDER_KINDS.filter((kind) => isLocalCustomProviderKind(kind));
  const customKinds = ALL_CUSTOM_PROVIDER_KINDS.filter((kind) => !isLocalCustomProviderKind(kind));
  const availableLocalKinds = localKinds.filter((kind) => {
    const fixedId = FIXED_LOCAL_PROVIDER_IDS[kind as keyof typeof FIXED_LOCAL_PROVIDER_IDS];
    return !state.piSettings.addedProviders.includes(fixedId);
  });

  const hasAnyOption =
    availableLocalKinds.length > 0
    || customKinds.length > 0
    || providersNotAdded.length > 0;
  if (!hasAnyOption) {
    return;
  }

  const addControls = container.createDiv({ cls: 'pivi-provider-add-controls' });
  const pickerContainer = addControls.createDiv({ cls: 'pivi-provider-add-container' });

  const pickerTrigger = pickerContainer.createEl('button', {
    cls: 'pivi-provider-add-trigger',
    type: 'button',
    text: t('settings.modelsTab.addProvider'),
  });

  const pickerDropdown = pickerContainer.createDiv({ cls: 'pivi-provider-add-dropdown' });

  if (availableLocalKinds.length > 0) {
    appendSectionLabel(pickerDropdown, t('settings.modelsTab.addSectionLocal'));
    for (const kind of availableLocalKinds) {
      appendKindOption(pickerDropdown, kind, () => {
        void addCustomKind(kind);
      });
    }
  }

  appendSectionLabel(pickerDropdown, t('settings.modelsTab.addSectionCustom'));
  for (const kind of customKinds) {
    appendKindOption(pickerDropdown, kind, () => {
      void addCustomKind(kind);
    });
  }

  if (providersNotAdded.length > 0) {
    appendSectionLabel(pickerDropdown, t('settings.modelsTab.addSectionCloud'));
    for (const prov of providersNotAdded) {
      const option = pickerDropdown.createDiv({ cls: 'pivi-provider-add-option' });
      const slug = getProviderLogoSlug(prov);
      if (slug) {
        appendProviderLogo(option, slug, { size: 16, className: 'pivi-provider-add-option-logo' });
      }
      option.createSpan({ text: getDisplayName(prov) });
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        pickerDropdown.removeClass('is-visible');
        void addBuiltinProvider(prov);
      });
    }
  }

  pickerTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    pickerDropdown.toggleClass('is-visible', !pickerDropdown.hasClass('is-visible'));
  });

  (container.ownerDocument ?? window.document).addEventListener('click', () => {
    pickerDropdown.removeClass('is-visible');
  });

  async function addBuiltinProvider(providerId: string): Promise<void> {
    if (!providerId || state.piSettings.addedProviders.includes(providerId)) {
      new Notice(t('settings.modelsTab.selectProvider'));
      return;
    }
    const added = [...state.piSettings.addedProviders, providerId];
    state.updatePiSettings({ addedProviders: added });
    setProviderCardExpanded(providerId, true);
    await context.plugin.saveSettings();
    context.redisplay();
    new Notice(t('settings.modelsTab.addedProvider', {
      name: getDisplayName(providerId),
    }));
  }

  async function addCustomKind(kind: CustomProviderKind): Promise<void> {
    const existingIds = [
      ...state.piSettings.addedProviders,
      ...customProviders.map((provider) => provider.id),
    ];
    const config = createDefaultCustomProviderConfig(kind, existingIds);
    if (state.piSettings.addedProviders.includes(config.id)) {
      new Notice(t('settings.modelsTab.selectProvider'));
      return;
    }

    const nextCustomProviders = [...customProviders, config];
    const addedProviders = [...state.piSettings.addedProviders, config.id];
    state.updatePiSettings({ customProviders: nextCustomProviders, addedProviders });
    setProviderCardExpanded(config.id, true);
    context.plugin.getUiFacades().syncCustomProviders(context.plugin.settings);
    await context.plugin.saveSettings();
    context.redisplay();
    new Notice(t('settings.modelsTab.addedProvider', {
      name: config.name,
    }));
  }
}

function appendSectionLabel(parent: HTMLElement, text: string): void {
  parent.createDiv({ cls: 'pivi-provider-add-section', text });
}

function appendKindOption(
  parent: HTMLElement,
  kind: CustomProviderKind,
  onClick: () => void,
): void {
  const option = parent.createDiv({ cls: 'pivi-provider-add-option' });
  const slug = getLogoSlugForCustomProviderKind(kind);
  if (slug) {
    appendProviderLogo(option, slug, { size: 16, className: 'pivi-provider-add-option-logo' });
  }
  option.createSpan({ text: getCustomProviderKindDisplayName(kind) });
  option.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    parent.removeClass('is-visible');
    onClick();
  });
}
