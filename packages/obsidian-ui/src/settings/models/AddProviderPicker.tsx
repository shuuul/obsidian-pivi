import { useEffect, useRef, useState } from 'react';

import { useT } from '../../i18n';
import { ProviderLogo } from '../../icons';
import type { ModelsAddableKind, ModelsAddableProvider, SettingsModelsPort } from '../../ports';

export interface AddProviderPickerProps {
  readonly models: SettingsModelsPort;
  readonly onProviderAdded: (providerId: string) => void;
  readonly onError: (message: string) => void;
}

/** Dropdown that adds built-in cloud providers or custom/local provider kinds. */
export function AddProviderPicker({ models, onProviderAdded, onError }: AddProviderPickerProps) {
  const t = useT();
  const localKinds = models.listAddableLocalKinds();
  const customKinds = models.listCustomKinds();
  const builtins = models.listAddableBuiltinProviders();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const doc = containerRef.current?.ownerDocument ?? document;
    const close = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    doc.addEventListener('click', close);
    return () => doc.removeEventListener('click', close);
  }, [open]);

  if (localKinds.length === 0 && customKinds.length === 0 && builtins.length === 0) {
    return null;
  }

  const addBuiltin = (providerId: string): void => {
    setOpen(false);
    void models.addBuiltinProvider(providerId)
      .then(() => { onProviderAdded(providerId); })
      .catch((cause: unknown) => { onError(cause instanceof Error ? cause.message : t('common.error')); });
  };

  const addKind = (kind: string): void => {
    setOpen(false);
    void models.addCustomKind(kind)
      .then(providerId => { onProviderAdded(providerId); })
      .catch((cause: unknown) => { onError(cause instanceof Error ? cause.message : t('common.error')); });
  };

  const renderKindOption = (option: ModelsAddableKind) => (
    <div
      className="pivi-provider-add-option"
      key={option.kind}
      onClick={() => addKind(option.kind)}
    >
      {option.logoSlug ? <ProviderLogo slug={option.logoSlug} size={16} className="pivi-provider-add-option-logo" /> : null}
      <span>{option.name}</span>
    </div>
  );

  const renderProviderOption = (option: ModelsAddableProvider) => (
    <div
      className="pivi-provider-add-option"
      key={option.id}
      onClick={() => addBuiltin(option.id)}
    >
      {option.logoSlug ? <ProviderLogo slug={option.logoSlug} size={16} className="pivi-provider-add-option-logo" /> : null}
      <span>{option.name}</span>
    </div>
  );

  return (
    <div className="pivi-provider-add-controls">
      <div className="pivi-provider-add-container" ref={containerRef}>
        <button
          className="pivi-provider-add-trigger"
          type="button"
          onClick={event => { event.stopPropagation(); setOpen(value => !value); }}
        >
          {t('settings.modelsTab.addProvider')}
        </button>
        <div className={`pivi-provider-add-dropdown${open ? ' is-visible' : ''}`}>
          {localKinds.length > 0 ? (
            <>
              <div className="pivi-provider-add-section">{t('settings.modelsTab.addSectionLocal')}</div>
              {localKinds.map(renderKindOption)}
            </>
          ) : null}
          <div className="pivi-provider-add-section">{t('settings.modelsTab.addSectionCustom')}</div>
          {customKinds.map(renderKindOption)}
          {builtins.length > 0 ? (
            <>
              <div className="pivi-provider-add-section">{t('settings.modelsTab.addSectionCloud')}</div>
              {builtins.map(renderProviderOption)}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
