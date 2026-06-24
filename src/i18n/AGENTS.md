# `src/i18n/` — Internationalization runtime

Static locale bundle, locale metadata, typed translation keys, and `t()` lookup/interpolation helper.

## Rules

- Add or remove locales in `constants.ts`, `types.ts`, and every JSON locale file together.
- `en.json` is the source of truth for translation key shape.
- Keep `TranslationKey` in sync with nested locale JSON paths.
