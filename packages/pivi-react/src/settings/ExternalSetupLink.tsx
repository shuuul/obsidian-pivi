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
  const host = kind === 'api-key' ? new URL(href).hostname : '';
  const label = kind === 'api-key'
    ? t(LABEL_KEYS[kind], { host })
    : t(LABEL_KEYS[kind]);
  const hostIndex = host ? label.indexOf(host) : -1;
  return (
    <a
      className={`pivi-settings-external-link${kind === 'api-key' ? ' pivi-provider-setup-link' : ''}`}
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {hostIndex >= 0 ? (
        <>
          {label.slice(0, hostIndex)}
          <span className="pivi-provider-setup-domain">{host}</span>
          {label.slice(hostIndex + host.length)}
        </>
      ) : label}
    </a>
  );
}
