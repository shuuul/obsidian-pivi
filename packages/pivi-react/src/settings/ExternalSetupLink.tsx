import type { TranslationKey } from '../i18n';
import { useT } from '../i18n';
import type { ProviderSetupLink } from './providerSetupLinks';

const LABEL_KEYS: Record<ProviderSetupLink['kind'], TranslationKey> = {
  'api-key': 'settings.setup.getApiKeyAt',
  download: 'settings.setup.download',
  docs: 'settings.setup.openDocs',
};

export function ExternalSetupLink({
  href,
  kind,
}: {
  readonly href: string;
  readonly kind: ProviderSetupLink['kind'];
}) {
  const t = useT();
  const label = kind === 'api-key'
    ? t(LABEL_KEYS[kind], { host: new URL(href).hostname })
    : t(LABEL_KEYS[kind]);
  return (
    <a
      className={`pivi-settings-external-link${kind === 'api-key' ? ' pivi-provider-setup-link' : ''}`}
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {label}
    </a>
  );
}
