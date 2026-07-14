*This file extends the package [AGENTS.md](../../AGENTS.md). Follow package and root guidance first.*

# i18n package map

UI internationalization runtime and catalogs live here. `createI18n()` creates isolated translator state; app composition owns the shared product instance, imperative adapters access it through `@/app/i18n`, and React surfaces receive it through `I18nProvider` / `useT()`.

## Entrypoints

| Export | Role |
|--------|------|
| `createI18n(initialLocale?)` | Create isolated translator state with fallback and subscriptions |
| `I18nProvider` / `useI18n()` / `useT()` | Share an explicit translator with React consumers |
| `I18n` / `TFunction` / `TranslationKey` / `TranslationParams` | Narrow imperative, React, and port contracts |
| `DEFAULT_LOCALE` / `SUPPORTED_LOCALES` / `Locale` / `LocaleInfo` | Default and supported locale metadata |
| Locale helpers | Normalize locale codes, list metadata, and derive display names |

## Commit policy (repo-wide)

**Any commit that touches user-visible UI text must include i18n in the same commit.** Do not land hard-coded UI copy first and “translate later.” Root rule: `AGENTS.md` → Coding Standards → “UI text requires i18n.”

Applies to: settings, chat chrome, Notices, commands/ribbon, modals, aria-labels, tool display labels, empty states, placeholders, and similar strings users can see or hear.

## Catalog rules

1. **`locales/en.json` is canonical.** Every user-visible UI string must be a key here first.
2. Mirror the same key tree in all other `locales/*.json` (parity tests fail otherwise). Interpolation placeholder names must also match `en.json` exactly; translating a placeholder breaks runtime substitution.
3. `TranslationKey` is **inferred** from `en.json` (`types.ts`); do not hand-maintain a key union.
4. Prefer sentence case for settings/UI copy (ESLint `obsidianmd/ui/sentence-case`).
5. Keep technical ids (tool names, model ids, brand names) in English when they are identifiers, not labels.
6. React-used copy must remain host-neutral. Interpolate `hostName`, `workspaceName`, and `secureStorageName` from `PresentationPlatform`; do not hard-code Obsidian, vault, keychain, or `SecretStorage` in keys or values consumed by React.

## Adding a string

1. Add the nested key under the right namespace in `en.json`.
2. Add the same path to every other locale file (translated).
3. Call app `t('namespace.key', { param: value })` from imperative adapters or `useT()` from React package UI.

Namespaces: `common.*`, `commands.*`, `settings.*`, `chat.*`, `tools.*`, `inlineEdit.*`, `host.*`.

Context-badge tooltip and accessibility templates live under `chat.contextBadges.*`. Keep technical identifiers as interpolation values rather than translating or embedding them in catalog strings.

## Verification

Run `npm run test -- tests/pivi-react/i18n.test.tsx`, `npm run typecheck`, and `npm run lint` after catalog or translator changes. Placeholder parity should be covered alongside key-tree parity.

## Dead keys

Remove unused keys from **all** locale files when the UI is gone or never wired. Do not keep “for later” catalog entries without a call site.

## Agent reply language

UI `settings.locale` only changes plugin chrome. Agent response language is controlled by the system prompt (“same language as the user’s query”), not by i18n catalogs.
