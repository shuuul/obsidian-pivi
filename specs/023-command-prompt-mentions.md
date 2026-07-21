---
id: "023"
title: "Mention support in command prompts"
status: Draft
created: 2026-07-21
updated: 2026-07-21
coordinator: "Droid"
---

# 023 — Mention support in command prompts

## Context

Pivi workspace commands (Settings > Commands, `packages/pivi-react/src/settings/CommandsTab.tsx`) store a plain-text prompt template. Today the Prompt editor is a plain textarea: users can type `@file` or `/skill` text, but there is no autocomplete, no inline badge rendering, and no guarantee the typed token resolves to a real vault file, folder, skill, or MCP server at send time.

The chat composer already solves this exact problem:

- Core token parsing: `packages/pivi-agent-core/src/context/mentions/` (`parseMessageMentions`, `MentionVaultLookup`, `MentionBadgeParseContext`, `MentionBadgePart` kinds: file, folder, mcp, skill, tool, agent, inline-context).
- Imperative composer: `src/ui/chat/ui/RichChatInput.ts` — contenteditable implementing `ComposerInput` (textarea-compatible API + `getTextOffsetClientRect`), converts recognized tokens into non-editable inline badges carrying canonical text in `data-mention-token`.
- Suggestion dropdowns: `src/ui/shared/mention/MentionDropdownController.ts` (`@` → vault files/folders, external context roots, Agents submenu) and the slash dropdown in `src/ui/shared/components/` (skills, MCP servers/tools, built-in tool tokens, command catalog with fuzzy matching).
- Vault/skill/MCP providers: `createMentionVaultLookup`, `VaultMentionDataProvider`, folder expansion via `expandFolderMentions`.
- Badge presentation: `src/ui/shared/context-badge/` + `@pivi/pivi-react/context-badges`.

Settings presentation is fully React-owned in `@pivi/pivi-react` and consumes only `SettingsPorts`; it must never import `obsidian`, `@/ui/**`, or host adapters. The mention dropdown and vault lookup are imperative adapters that depend on Obsidian (`App`, `TFile`, metadata cache), so they cannot move into the React package. This spec exists to bridge that boundary deliberately.

Related shipped work: spec 022 (editor selection toolbar) no longer authors freeform prompt text in settings — its toolbar shortcuts pick existing workspace commands (Settings > Commands, `integrationKey`) or Obsidian commands, and its inline edit box is a composer-styled floating surface with its own plain prompt input (`packages/pivi-react/src/selectionToolbar/InlineEditBox.tsx`). A shared mention-capable prompt editor therefore has exactly one settings consumer today (CommandsTab), with the 022 inline edit box as a possible follow-up adopter.

## Goal and success criteria

Command prompt editing gains the same mention experience as the chat composer: type `@` to mention vault files/folders and `/` to mention skills, MCP servers/tools, and built-in tools, with autocomplete dropdowns and inline badges; the persisted command prompt remains canonical plain text.

- [ ] The CommandsTab Prompt editor supports `@` and `/` triggers with autocomplete dropdowns (vault files/folders, skills, MCP, tools, agents where applicable), verified by component/adapter tests.
- [ ] Recognized tokens render as inline badges while editing; unknown tokens stay plain text; verified by round-trip tests (badge DOM → canonical text → identical persisted string).
- [ ] The persisted prompt string and the turn-time expansion path are unchanged in shape: mentions are stored as the same canonical tokens the composer produces, so existing `PreparedChatTurn` mention resolution works without modification; verified by integration test executing a command whose prompt contains file/folder/skill/MCP mentions.
- [ ] No new boundary violations: React settings consumes the mention editor through an injected presentation port; Obsidian-dependent mention adapters stay in `src/ui/shared` / app wiring; `npm run check:boundaries` green.
- [ ] Full i18n for any new UI copy (empty states, aria labels) in every locale in the same commit; `node scripts/check-i18n-dead-keys.mjs` green.

## Scope and non-goals

In scope:

- A mention-capable prompt editor for workspace command create/edit in Settings > Commands.
- `@` mentions: vault files, vault folders, external context roots, agents (same item set as the composer, minus inline-context which is editor-selection-specific).
- `/` mentions: skills, enabled MCP servers/tools, built-in tool tokens (same catalog as the composer slash dropdown).
- Inline badge rendering with canonical `data-mention-token` round trip; persisted value stays plain text.
- SettingsPorts addition to mount/provide the mention editor from app wiring.

Not in scope:

- Mention support in spec 022's inline edit box (it ships with a plain textarea styled like the composer; reusing this editor there is a follow-up decision to record at WS-01 time). Spec 022 toolbar shortcuts no longer carry freeform prompt fields — they reference existing workspace commands, so command prompts edited here flow into the toolbar automatically.
- Changing turn-time mention semantics, folder expansion, or MCP token transforms (core already owns these).
- Mentioning notes inside the read-only Internal commands section.
- Slash-command argument scaffolding (`{{args}}` hint UI beyond the existing argument-hint field).

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-21 | The mention editor is an app-wired imperative adapter exposed to React settings through a narrow `SettingsPorts` mount API (React provides an empty container; the adapter owns contenteditable, badges, and dropdowns). | Mirrors the approved composer seam ("uncontrolled rich input remains an imperative island" per `packages/pivi-react/AGENTS.md`); Obsidian-dependent mention providers cannot enter `@pivi/pivi-react`. | WS-01, WS-02 |
| 2026-07-21 | Persisted command prompts remain canonical plain text identical to composer-extracted text; badges are editing-time presentation only, via `data-mention-token` round trip. | Zero migration, zero change to runtime mention resolution; command prompts and composer input share one token grammar. | WS-02, WS-03 |
| 2026-07-21 | Reuse `MentionDropdownController`, the slash catalog dropdown, and core `parseMessageMentions` as-is; the editor reuses `RichChatInput`'s badge machinery (either by extracting a shared mention-input base or by composing the existing class). | The composer implementation already handles IME, token-boundary sync, alias insertion, wikilinks, longest-match paths with spaces, and external roots; duplicating it would fork behavior. | WS-01 |
| 2026-07-21 | Settings-side presentation follows the same polish baseline shipped with 022's surfaces: existing `--pivi-*` / `--pivi-host-*` tokens, `.pivi-settings-control` editor chrome, press/hover feedback, and reduced-motion-aware entry motion only where it aids comprehension. The mention editor adopts composer token/badge styling verbatim rather than inventing a second visual language. | 022's post-review UI/UX pass established the token set and motion rules (pill floating chrome, `pivi-press-scale`, `@starting-style` entries, hover gating); keeping settings editors consistent avoids a third button/editor style family. | WS-01, WS-03 |
| 2026-07-21 | CommandsTab integration targets the existing provider-style disclosure card editor (full-width Prompt editor inside the card body); badges render inline in that editor exactly like composer badges. | Matches the shipped Commands settings IA and 022's card-based settings polish; no new settings surface is introduced. | WS-03 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Shared mention-input extraction: refactor `RichChatInput` mention/badge machinery into a reusable imperative mention input (or a documented composition path) consumable outside the chat composer, preserving IME/cursor/token behavior; unit tests for token round trip. | Unassigned | Pending | None | `npm run test -- tests/unit` (mention input tests); existing composer tests stay green |
| WS-02 | SettingsPorts + app wiring: new narrow port (e.g. `mountMentionPromptEditor(container, initialValue, callbacks)`) implemented in `src/app/ui` using WS-01 + `MentionDropdownController` + slash catalog + vault/MCP/skill providers; boundary-safe types only across the port. | Unassigned | Pending | WS-01 | `npm run check:boundaries`; port implementation tests with mocked providers |
| WS-03 | CommandsTab integration: Prompt field uses the mounted mention editor for create and edit; save path extracts canonical text; draft/reset/disabled states preserved; i18n for new copy in all locales. | Unassigned | Pending | WS-02 | `tests/pivi-react` component tests; i18n dead-key check; round-trip save/reload test |
| WS-04 | End-to-end verification + docs: command with file/folder/skill/MCP mentions executes through the normal turn pipeline; docs + nearest `AGENTS.md` sync; spec closeout. | Unassigned | Pending | WS-03 | Integration test through `PreparedChatTurn`; manual: create command with mentions, run it, confirm context files/skill/MCP land in the turn |

## Verification

- `npm run test` — mention input round trip, port wiring, CommandsTab behavior.
- `npm run check:boundaries` — no `obsidian`/UI imports added to `@pivi/pivi-react`; mention adapters stay in `src/ui/shared` + `src/app/ui`.
- `npm run typecheck && npm run lint && npm run test:coverage && npm run build` — global gates unchanged.
- `node scripts/check-i18n-dead-keys.mjs` and full-locale mirror for new keys.
- Manual: Settings > Commands, create a command, `@` a note and folder, `/` a skill and an MCP server; save; reopen to confirm badges re-render from persisted text; run the command and confirm the turn receives context files, skill, and MCP availability; `obsidian dev:errors` returns `No errors captured.`
- `npm run check:specs` before closeout.

## Documentation sync

- Numbered developer docs: relevant `docs/` page for commands/skills (assignment at closeout).
- Nearest local guidance: `src/ui/shared/AGENTS.md` (mention-input extraction), `packages/pivi-react/AGENTS.md` (settings mount seam), `packages/pivi-react/src/i18n/AGENTS.md` policy applies.
- Parent/package guidance: `packages/pivi-agent-core/AGENTS.md` only if mention parsing changes (none planned).
- Root guidance and roadmap: root `AGENTS.md` architecture-status bullet if the settings mount seam becomes a reusable pattern.

## Progress and handoff

Append entries rather than rewriting another agent's record.

### 2026-07-21 — Droid — spec drafting

- Changed: Created spec from user request: commands should mention file/folder/skill/MCP like the input panel.
- Evidence: Composer mention stack inventory — core `context/mentions` parser and types; `RichChatInput` contenteditable + `getTextOffsetClientRect`; `MentionDropdownController` (542 LOC) with `@` triggers and Agents submenu; slash catalog dropdown; `CommandsTab.tsx` Prompt editor is a plain textarea today; `packages/pivi-react/AGENTS.md` forbids Obsidian imports and mandates the imperative-island composer seam.
- Remaining: All workstreams pending; open question whether the inline edit box in spec 022 reuses the same mention input (decide at WS-01).
- Blockers: None.
- Next action: User review; then claim WS-01 (shared mention-input extraction).

### 2026-07-21 — Droid — spec refresh after 022 UI/UX pass

- Changed: Updated Context/Scope/Decisions to match the shipped 022 state: toolbar shortcuts reference existing workspace commands instead of freeform `preset-prompt` fields; the inline edit box is a polished plain-text composer-styled input; recorded that CommandsTab is the only settings consumer and the 022 inline edit box is a follow-up adopter candidate. Added decisions requiring composer-token/badge visual parity and integration into the existing provider-style disclosure card editor, consistent with 022's settings polish (tokens, press feedback, reduced-motion rules).
- Evidence: 022 closeout changes — `editorSelectionToolbar` is now `{ enabled, shortcuts }` with `obsidian-command` | `pivi-command` kinds (`packages/pivi-agent-core/src/foundation/settings.ts`); `EditorToolbarSection.tsx` toggle + status hint + card list; `InlineEditBox.tsx` polished surface with keyboard hints; `.agents/skills` design guidance applied repo-wide to new chrome.
- Remaining: All workstreams still pending.
- Blockers: None.
- Next action: Claim WS-01 (shared mention-input extraction) after user sign-off.

## Completion summary

_Pending._
