# Obsius design TODO

This file tracks design follow-ups discovered during the June 2026 docs / `AGENTS.md` refresh. Treat these as maintenance candidates, not committed implementation plans; promote any medium+ item into `docs/specs/` before coding.

## Resolved: Normalize session terminology, phase 1

**Resolution**

- Persistent state is JSONL-session oriented: `sessionFile` + `leafId` under `.obsius/sessions/`.
- Feature-layer code is session-oriented; any in-memory UI projection is rebuildable from JSONL and must not become durable identity.
- Root `AGENTS.md` owns the repo terminology table.
- Docs clarify that strict pi CLI round-trip is not required and that persisted plugin tab state is `sessionFile` + `leafId`.

**Guardrail**

- Mixed terms make it harder to reason about source of truth.
- Future contributors should not reintroduce sidecar metadata or treat `OpenSessionState.id` as durable tab restore identity.

**Likely touchpoints**

- `src/core/types/chat.ts`
- `src/features/chat/controllers/SessionController.ts`
- `src/features/chat/tabs/*`
- `src/pi/session/*`
- `docs/specs/session-tree-spec.md`

## Resolved: Complete internal Conversation-to-Session refactor

**Resolution**

- User-facing text, docs, tests, and persisted identity are session-oriented.
- No `Conversation` / `conversationId` terminology should remain in `src/`, `tests/`, `docs/`, or `AGENTS.md`.
- Internal `ChatSessionView` / `sessionViewId` naming was replaced with `OpenSessionState`, `openSessionId`, `SessionController`, and session-oriented APIs.
- `OpenSessionState` is explicitly transient open-tab UI state rebuilt from a Pi JSONL session leaf; durable restore state remains `sessionFile` + `leafId`.

**Guardrail**

- Do not reintroduce `Conversation`, `conversationId`, `ChatSessionView`, or `sessionView` terms.
- Do not persist `openSessionId` as tab restore identity; persist `sessionFile` + `leafId`.
- Keep the root `AGENTS.md` terminology table synchronized with code names.

**Final naming**

| Current | Proposed | Meaning |
|---------|----------|---------|
| `ChatSessionView` | `OpenSessionState` | Rebuildable feature-layer state for an open tab. |
| `ChatSessionSummary` | `SessionSummary` | History dropdown metadata loaded from JSONL. |
| `ChatSessionViewController` | `SessionController` | Session lifecycle/history/title/navigation orchestration. |
| `sessionViewId` | `openSessionId` | Runtime lookup key, not persisted tab identity. |
| `syncSessionViewState` | `syncOpenSessionState` | Runtime hydration/sync of open session state. |
| `openChatSessionView` | `openSession` | Tab/action API for opening a session leaf. |

**Verification target**

- `rg -n "ChatSessionView|sessionView|SessionView|Conversation|conversationId|conversation" src tests docs AGENTS.md -g '*.ts' -g '*.md' -g '*.json'` should only find intentional historical notes in this TODO, if any.
- `npm run typecheck`, `npm run lint`, targeted chat/session tests, and `npm run build && obsidian reload` should pass.

**Likely touchpoints**

- `AGENTS.md`
- `src/core/types/chat.ts`
- `src/core/runtime/ChatRuntime.ts`
- `src/core/agent/types.ts`
- `src/features/chat/controllers/SessionController.ts`
- `src/features/chat/state/*`
- `src/features/chat/tabs/*`
- `src/features/chat/ObsiusView.ts`
- `src/pi/runtime/PiChatRuntime.ts`
- `src/pi/session/*`
- `tests/helpers/*`
- `tests/unit/features/chat/*`
- `docs/specs/session-tree-spec.md`

## 3. Rename the core `PiAgentServices` facade if runtime neutrality remains a goal

**Current state**

- `src/core/agent/PiAgentServices.ts` is the feature-facing facade.
- The project is intentionally Pi-only today, but the facade lives in `core/`, not `src/pi/`.

**Why it matters**

- The name leaks the current adaptor into feature code even though the boundary is otherwise hexagonal.
- If another runtime is ever explored, many feature imports would require a rename anyway.

**Potential direction**

- Rename to `AgentServices` or `ActiveAgentServices`.
- Keep `PiAgentServices` as a temporary re-export if the migration would be noisy.
- Update `src/AGENTS.md` and architecture docs after the rename.

**Likely touchpoints**

- `src/core/agent/PiAgentServices.ts`
- imports under `src/features/**`
- `src/pi/bootstrap.ts`
- tests under `tests/unit/agent/`

## 4. Reduce Pi-specific settings knowledge in `src/app/settings`

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

## 5. Consolidate locale metadata

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

## 6. Split oversized chat/runtime UI modules incrementally

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
