import type { TranslationKey } from '../i18n';
import { useT } from '../i18n';
import type { ProviderSetupLink } from './providerSetupLinks';

const LABEL_KEYS: Record<ProviderSetupLink['kind'], TranslationKey> = {
  'api-key': 'settings.setup.getApiKey',
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
  return (
    <a
      className="pivi-settings-external-link"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {t(LABEL_KEYS[kind])}
    </a>
  );
}
