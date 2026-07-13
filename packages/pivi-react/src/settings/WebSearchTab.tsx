import {
  WEB_FETCH_PROVIDER_IDS,
  WEB_SEARCH_PROVIDER_IDS,
  type WebFetchProviderChoice,
  type WebSearchProviderChoice,
  type WebSearchProviderId,
} from '@pivi/pivi-agent-core/foundation/settings';
import { useState } from 'react';

import { useT } from '../i18n';
import { useHostTerminology } from '../platform';
import type { SettingsPorts } from '../ports';
import { Select, SettingHeading, SettingRow } from './controls';

const PROVIDER_LABELS: Record<WebSearchProviderId, string> = {
  brave: 'Brave Search',
  tavily: 'Tavily',
  exa: 'Exa',
};
const MASKED_KEY = '••••••••';

export function WebSearchTab({ ports }: { readonly ports: SettingsPorts }) {
  const t = useT();
  const { secureStorageName } = useHostTerminology();
  const settings = ports.complex.webSearch.getSettings();
  const [keys, setKeys] = useState<Record<WebSearchProviderId, string>>(() => Object.fromEntries(WEB_SEARCH_PROVIDER_IDS.map((provider) => [provider, ports.complex.webSearch.hasCredential(provider) ? MASKED_KEY : ''])) as Record<WebSearchProviderId, string>);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveSettings = async (patch: { searchProvider?: WebSearchProviderChoice; fetchProvider?: WebFetchProviderChoice }) => {
    setPending(true);
    setError(null);
    try {
      await ports.complex.webSearch.saveSettings(patch);
      await ports.complex.runtime.refreshPrompt();
    } catch {
      setError(t('common.error'));
    } finally { setPending(false); }
  };
  const saveKey = async (provider: WebSearchProviderId) => {
    const key = keys[provider].trim();
    if (!key || key === MASKED_KEY) return;
    setPending(true);
    setError(null);
    try {
      ports.complex.webSearch.writeCredential(provider, key);
      setKeys((previous) => ({ ...previous, [provider]: MASKED_KEY }));
      await ports.complex.runtime.refreshPrompt();
    } catch {
      setError(t('common.error'));
    } finally { setPending(false); }
  };
  const clearKey = async (provider: WebSearchProviderId) => {
    setPending(true);
    setError(null);
    try {
      ports.complex.webSearch.clearCredential(provider);
      setKeys((previous) => ({ ...previous, [provider]: '' }));
      await ports.complex.runtime.refreshPrompt();
    } catch {
      setError(t('common.error'));
    } finally { setPending(false); }
  };

  return <><div className="pivi-sp-settings-desc"><p className="pivi-setting-description">{t('settings.webSearch.intro')}</p></div>{error ? <div className="pivi-setting-description" role="alert">{error}</div> : null}<SettingRow name={t('settings.webSearch.preferredSearch.name')} description={t('settings.webSearch.preferredSearch.desc')}><Select value={settings.searchProvider} onChange={(searchProvider) => { void saveSettings({ searchProvider: searchProvider as WebSearchProviderChoice }); }}><option value="auto">{t('settings.webSearch.autoSearchOption')}</option>{WEB_SEARCH_PROVIDER_IDS.map((provider) => <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>)}</Select></SettingRow><SettingRow name={t('settings.webSearch.preferredFetch.name')} description={t('settings.webSearch.preferredFetch.desc')}><Select value={settings.fetchProvider} onChange={(fetchProvider) => { void saveSettings({ fetchProvider: fetchProvider as WebFetchProviderChoice }); }}><option value="auto">{t('settings.webSearch.autoFetchOption')}</option>{WEB_FETCH_PROVIDER_IDS.map((provider) => <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>)}</Select></SettingRow><SettingHeading>{t('settings.webSearch.apiKeysHeading')}</SettingHeading>{WEB_SEARCH_PROVIDER_IDS.map((provider) => <SettingRow key={provider} name={t('settings.webSearch.apiKeyName', { provider: PROVIDER_LABELS[provider] })} description={t('settings.webSearch.apiKeyDesc', { provider, secureStorageName })}><input type="password" value={keys[provider]} placeholder={keys[provider] === MASKED_KEY ? t('settings.webSearch.apiKeySavedPlaceholder', { secureStorageName }) : t('settings.webSearch.apiKeyPlaceholder')} disabled={pending} onFocus={() => { if (keys[provider] === MASKED_KEY) setKeys((previous) => ({ ...previous, [provider]: '' })); }} onChange={(event) => setKeys((previous) => ({ ...previous, [provider]: event.target.value }))} onBlur={() => { void saveKey(provider); }} /><button type="button" disabled={pending || !ports.complex.webSearch.hasCredential(provider)} onClick={() => { void clearKey(provider); }}>{t('settings.webSearch.removeKey')}</button></SettingRow>)}</>;
}
