# i18n package map

Plugin-local UI internationalization. Runtime and catalogs live only under `src/i18n/` (`@/i18n`). Packages under `packages/*` must not import `@/i18n`; pass translated strings from `src/` when host code needs user-facing text.

## Entrypoints

| Export | Role |
|--------|------|
| `t(key, params?)` | Translate a `TranslationKey` with optional `{param}` interpolation |
| `setLocale` / `getLocale` | Module locale state (boot + settings language control) |
| `getAvailableLocales` / `getLocaleDisplayName` | Language dropdown |
| `SUPPORTED_LOCALES` / `Locale` | Supported codes + metadata |

## Commit policy (repo-wide)

**Any commit that touches user-visible UI text must include i18n in the same commit.** Do not land hard-coded UI copy first and “translate later.” Root rule: `AGENTS.md` → Coding Standards → “UI text requires i18n.”

Applies to: settings, chat chrome, Notices, commands/ribbon, modals, aria-labels, tool display labels, empty states, placeholders, and similar strings users can see or hear.

## Catalog rules

1. **`locales/en.json` is canonical.** Every user-visible UI string must be a key here first.
2. Mirror the same key tree in all other `locales/*.json` (parity tests fail otherwise).
3. `TranslationKey` is **inferred** from `en.json` (`types.ts`); do not hand-maintain a key union.
4. Prefer sentence case for settings/UI copy (ESLint `obsidianmd/ui/sentence-case`).
5. Keep technical ids (tool names, model ids, brand names) in English when they are identifiers, not labels.

## Adding a string

1. Add the nested key under the right namespace in `en.json`.
2. Add the same path to every other locale file (translated).
3. Call `t('namespace.key', { param: value })` from UI.

Namespaces: `common.*`, `commands.*`, `settings.*`, `chat.*`, `tools.*`, `inlineEdit.*`.

## Dead keys

Remove unused keys from **all** locale files when the UI is gone or never wired. Do not keep “for later” catalog entries without a call site.

## Agent reply language

UI `settings.locale` only changes plugin chrome. Agent response language is controlled by the system prompt (“same language as the user’s query”), not by i18n catalogs.
