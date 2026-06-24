# Obsius design TODO

This file tracks design follow-ups discovered during the June 2026 docs / `AGENTS.md` refresh. Treat these as maintenance candidates, not committed implementation plans; promote any medium+ item into `docs/specs/` before coding.

## 1. Reduce Pi-specific settings knowledge in `src/app/settings`

**Current state**

- `main.ts` and `app/settings/` are documented Pi integration seams.
- `src/app/settings/ObsiusSettingsStorage.ts` directly uses Pi settings/model helpers for persisted settings normalization.

**Why it matters**

- `app/` is otherwise shared plugin infrastructure.
- Pi-specific normalization here makes the app layer less reusable and expands the list of architecture exceptions.

**Potential direction**

- Introduce a core settings reconciler/normalizer port or registration hook.
- Let `src/pi/` provide Pi-specific defaults, model validation, and migration behavior through that hook.
- Keep storage format unchanged unless a spec says otherwise.

**Likely touchpoints**

- `src/app/settings/ObsiusSettingsStorage.ts`
- `src/app/settings/defaultSettings.ts`
- `src/core/agent/types.ts`
- `src/pi/settings.ts`
- `src/pi/bootstrap.ts`

## 2. Consolidate locale metadata

**Current state**

- Runtime locale JSON lives in `src/i18n/locales/`.
- Locale metadata/display names are represented in more than one place (`src/i18n/i18n.ts`, `src/i18n/constants.ts`).
- Adding a locale/key requires updating JSON plus `src/i18n/types.ts`.

**Why it matters**

- Duplicate metadata can drift.
- Locale additions require multiple manual edits and are easy to partially complete.

**Potential direction**

- Make `SUPPORTED_LOCALES` the single source of display metadata.
- Derive `getLocaleDisplayName()` from that constant.
- Consider generating `TranslationKey` from `en.json` if manual key maintenance becomes a recurring problem.

**Likely touchpoints**

- `src/i18n/i18n.ts`
- `src/i18n/constants.ts`
- `src/i18n/types.ts`
- `src/i18n/locales/*.json`

## 3. Split oversized chat/runtime UI modules incrementally

**Current state**

- Lint currently reports no errors, but many existing warnings identify large or complex files.
- Notable examples include `InputController`, `StreamController`, `ToolCallRenderer`, `SessionController`, `SubagentManager`, `InputToolbar`, and `InlineEditModal`.

**Why it matters**

- Large controllers/renderers are harder to test, review, and safely modify.
- Complexity warnings often point to hidden feature coupling.

**Potential direction**

- Do not perform a broad rewrite.
- Split along existing seams when touching a file for functional work:
  - command handling vs turn submission in `InputController`
  - chunk dispatch vs per-chunk handlers in `StreamController`
  - label/icon/input parsing vs DOM rendering in `ToolCallRenderer`
  - session list/title/history concerns in `SessionController`
  - CodeMirror widget/diff/service orchestration in `InlineEditModal`
- Add focused tests around extracted units.

**Likely touchpoints**

- `src/features/chat/controllers/InputController.ts`
- `src/features/chat/controllers/StreamController.ts`
- `src/features/chat/controllers/SessionController.ts`
- `src/features/chat/rendering/ToolCallRenderer.ts`
- `src/features/chat/services/SubagentManager.ts`
- `src/features/chat/ui/InputToolbar.ts`
- `src/features/inline-edit/ui/InlineEditModal.ts`
