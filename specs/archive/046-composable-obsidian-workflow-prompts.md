---
id: "046"
title: "Composable Obsidian workflow prompts"
status: Completed
created: 2026-09-01
updated: 2026-09-03
coordinator: "Cursor"
---

# 046 — Composable Obsidian workflow prompts

## Context

The prompt system has three layers that grew rule-by-rule: `packages/agent/src/prompt/mainAgent.ts` is one ~18 KB monolithic template string (static guidance, filtered line-by-line against registered tool names), `packages/agent/src/prompt/obsidianAgentTools.ts` assembles the capability-gated "Available Tools" section, and each ToolSpec carries its own `promptUsage`. The same rule (for example long-line editing from specs 044/045) is currently restated in all three layers, and every new rule dilutes the weight of the others. Users cannot see, disable, or adjust any of this guidance; the only extension point is invisible `appendices`.

Evidence from the eight most recent vault sessions (2026-08-31 to 2026-09-01, all transcript-restructuring tasks) shows recurring failures that guidance restructuring plus new rules should prevent:

1. **Oversized-line read deadlock** (most frequent/severe): on `Line N ... cannot fit within maxChars` errors the Agent raised `maxChars` as the error hint instructed, but internal budget clamping kept the retry failing identically (`cannot fit within maxChars=7374` after passing 40101); the Agent then re-sent the same failing call 2–3 times. The error hint itself contradicts the clamp and never mentions `startChar` continuation.
2. **Tiny-page crawling**: one 95 KB / 131-line file consumed 80 `obsidian_read` calls, ~60 of them `startChar` steps advancing ~832 characters each, without ever consulting `stats` or the clamp rules to plan page size.
3. **Silent stalls**: after repeated tool failures the Agent stopped mid-task until the user typed `continue` / `继续` (3 sessions).
4. **Reconstructed `old_string`**: edits failed with `old_string not found` because the Agent retyped text from memory instead of copying read output (self-reported: "My reconstruction drifted from the exact text.").
5. **Fabricated content during rewrites**: a restructuring task merged in an invented English quotation; the Agent caught it only on self-review.
6. **Unwanted draft copies**: in-place restructuring created a ` (draft).md` sibling; the user has since added "不允许写到新的文件里" to every task prompt.
7. **Coordinate-system mixing**: `startChar` combined with `startLine`/`endLine` in one call, twice in one session.
8. **Search as a read backdoor**: `obsidian_search` with `context: true` used to dump long-line content after read friction; first guesses returned `[]`.

The user additionally wants Obsidian-workflow guidance (long-line normalization, transcript cleanup, wikilinks, frontmatter, daily notes) to be user-composable: a Settings **Prompt** tab where workflow modules can be toggled and their body text edited or restored to defaults, while safety-critical guidance stays locked. After the Prompt tab shipped, the Agent still could not add or edit those modules through tools: there is no `pivi_prompt`, `.pivi/settings.json` writes bypass in-memory settings and `refreshPrompt()`, and vault `AGENTS.md` / `.pivi/SYSTEM.md` remain appendix-only.

Current repository evidence: `SettingsShell.tsx` has a fixed eight-tab registry over `SettingsTabId`; React settings consume `SettingsPorts` only; synced persistence lives in `.pivi/settings.json` via `@pivi/obsidian-host` settings adapters; `computeSystemPromptKey` must reflect every prompt-affecting input; prompt tests live under `tests/unit/agent/prompt/`.

## Goal and success criteria

Restructure the system prompt into owned, deduplicated modules; make Obsidian-workflow modules user-composable through a new Settings Prompt tab; and add workflow content that prevents the observed session failures.

- [x] `@pivi/agent/prompt` defines a typed prompt-module registry: each module has a stable id, a kind (`core` locked, `workflow` composable, or `custom` user-created), a default body (shipped kinds), and a default-enabled flag; `buildSystemPrompt` composes the ordered modules deterministically, with custom modules appended after shipped workflow modules in user-defined order.
- [x] Every prompt rule has exactly one owning layer: capability-gated tool usage lives on ToolSpec `promptUsage` / the registered section, host-neutral workflow and safety guidance lives in static modules; the duplicated long-line/edit rules across the three layers are collapsed to single owners with cross-references, verified by prompt-content tests.
- [x] The complete default prompt (all default-enabled modules, representative tool registration) does not exceed the current assembled length; measure both in a test fixture. *(Closed by the 2026-09-03 decision: verified by one-time measurement of the length-neutral refactor; no durable fixture because WS-03 intentionally added content.)*
- [x] Core modules (identity, path conventions, mutation safety, exact-match editing, Markdown hygiene, response language) cannot be disabled or edited; workflow modules (long-line pre-edit normalization, transcript cleanup, wikilink conventions, frontmatter conventions, daily/periodic notes) can be toggled and their body text replaced.
- [x] User prompt composition persists in synced `.pivi/settings.json`: `promptModules: { [moduleId]: { enabled?, customBody? } }` for shipped modules plus an ordered `customPromptModules: [{ id, title, body, enabled }]` list for user-created modules; absent entries mean shipped defaults; unknown shipped-module ids are preserved on save and ignored at composition.
- [x] Users can create, rename, edit, reorder, enable/disable, and delete custom modules in the Prompt tab; custom module ids are generated stable identifiers that never collide with shipped ids; deleting a custom module requires the shared destructive-confirmation modal. Custom modules replace the appendix channel as the user-facing extension point; runtime-internal `appendices` remain an app-composition mechanism only.
- [x] A user-edited shipped module silently wins over the default; the Settings UI shows a "modified" badge and a per-module restore-to-default action; no automatic merging when the shipped default changes across releases.
- [x] `computeSystemPromptKey` incorporates shipped-module enablement/custom bodies and the full ordered custom-module list so prompt caching invalidates on any composition change.
- [x] New Settings **Prompt** tab hides locked core modules (they remain in the usage total), lists workflow modules with toggle, editor, modified badge, and restore action, and a custom-module section with an `+ Add module` trigger following the shared provider-style card conventions; it extends `SettingsTabId`, `SettingsPorts`, declarative settings-search metadata, and ships full i18n for all locale catalogs in the same commit. Module bodies themselves remain English prompt content and are not localized.
- [x] The Prompt tab header shows a startup-context usage panel in the style of a context-usage breakdown: one stacked bar plus per-section rows with estimated token counts for the composed static prompt (core modules, workflow modules, custom modules), the registered-tools section, and the MCP inventory, computed from current settings as a representative startup composition. Estimates are explicitly labeled as estimates, use compact K/M formatting at or above 1k, and never invent provider-exact token counts.
- [x] The pure character-based estimator `estimateTextTokens` moves from `@pivi/engine-pi/session/piContextCompaction.ts` into `@pivi/agent` (it has no Pi dependencies); `@pivi/engine-pi` compaction imports it from there so the settings panel and compaction share one implementation. `calculateContextEnvelope` in `@pivi/agent/runtime/usage.ts` remains the budget framework only and gains no text estimation.
- [x] Section estimation runs in app composition (which holds the representative registered ToolSpec list and cached MCP inventory, mirroring engine `estimateSystemTokens` semantics); React receives precomputed section values through `SettingsPorts` and performs no estimation.
- [x] Usage estimates are informational ballpark counts. The panel does not show a suggested budget or an over-budget warning; registered tools and MCP size vary with the user's enabled set and are not a user-editable Prompt-tab budget.
- [x] The long-line pre-edit normalization module ships **default off**: when enabled it instructs the Agent to split oversized physical lines at semantic boundaries with `obsidian_edit` before further work on that note; when disabled the 044/045 work-around-the-line strategy remains authoritative.
- [x] Failure-driven hard rules land in core/tool-owned guidance: never re-send an identical failing tool call; on an oversized-line read error switch to `startChar` continuation instead of raising `maxChars`; plan page size from `stats` and the clamp rules instead of small-step crawling; `obsidian_read` coordinate systems are mutually exclusive per call; search is for locating, never a content-read channel; `old_string` must be copied verbatim from the latest read output; rewrites must not introduce quotes/facts absent from the source; in-place restructuring must not create draft/sibling copies unless the user asks; after tool failures continue with a changed strategy instead of stopping silently.
- [x] The oversized-line read error hint in `packages/obsidian-tools` no longer instructs raising `maxChars` past the effective clamp; it names line-relative `startChar` continuation as the corrective action, consistent with the prompt guidance.
- [x] Focused tests cover module composition (defaults, disabled, custom body, unknown ids, custom-module order and lifecycle), key computation, settings persistence round-trip, usage-panel estimation and compact K formatting, Prompt tab behavior (jsdom), i18n key coverage, and the corrected read error hint.
- [x] Main-Agent-only `pivi_prompt` queries and mutates the same `promptModules` / `customPromptModules` composition as Settings → Prompt: list/get are unconfirmed; mutations require one sidebar confirmation, `catalogRevision` from a prior list/get, codec persist, and `refreshPrompt()`. Core modules are list/get only. Workflow modules may be enabled/disabled, body-overridden, or restored. Custom modules may be created, renamed/edited via upsert, reordered, enabled/disabled, or removed. Subagents never receive the tool. Agents must not edit `.pivi/settings.json` for this purpose.

## Scope and non-goals

In scope:

- `@pivi/agent/prompt` module registry, composition, dedupe across the three guidance layers, and prompt key.
- Settings persistence schema in `@pivi/agent/settings` plus app wiring through `SettingsPorts`.
- New React Prompt settings tab (`packages/pivi-react/src/settings/`) including custom-module management and the startup-context usage panel, settings-search metadata, and locale catalogs.
- New workflow module bodies and failure-driven core-rule updates.
- The `readShared.ts` oversized-line error-hint correction (small, evidence-tied).
- Focused unit/jsdom tests and durable documentation.

Not in scope:

- Localizing prompt body text.
- Automatic three-way merge of user-edited module bodies with updated defaults.
- Per-tab or per-session prompt composition; composition is vault-wide.
- Changing `PreparedChatTurn` / turn-prompt context assembly (`buildTurnPrompt.ts`).
- Automatic detection or scheduled normalization of long lines outside an active Agent task.
- Changing read/edit tool semantics beyond the error-hint wording.
- Provider-exact tokenization for the usage panel; estimates stay character-based and estimate-labeled.
- Live per-turn context accounting in the Prompt tab; the panel reflects the representative startup composition, and the composer usage meter remains the live surface.
- Sharing/importing custom modules between vaults beyond normal `.pivi/settings.json` sync.
- Adding `.pivi/settings.json` to Pivi-managed vault-mutation namespaces (the file is mixed-purpose). `pivi_prompt` is the Agent-facing owner for prompt-composition fields only.
- Letting subagents manage prompt composition.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-09-01 | Core safety modules are locked (no toggle, no edit); only workflow modules are composable. | Path, mutation, and exact-match rules directly protect user data; disabling them risks note corruption. Confirmed by user. | WS-01, WS-02 |
| 2026-09-01 | User-edited bodies silently override defaults with a "modified" badge and per-module restore; no auto-merge. | Predictable and simple; version drift is handled by explicit restore rather than merge heuristics. Confirmed by user. | WS-02 |
| 2026-09-01 | Composition persists in synced `.pivi/settings.json`. | Prompt preferences are non-secret vault workflow preferences and should follow the vault across devices. Confirmed by user. | WS-02 |
| 2026-09-01 | Long-line pre-edit normalization ships as a workflow module, default off. | It mutates user notes and inverts the 044/045 default philosophy; enabling it must be an explicit user choice. Confirmed by user. | WS-03 |
| 2026-09-01 | Failure-driven rules from the session scan go into locked core/tool-owned guidance, not optional modules. | They are tool-usage correctness rules, not workflow preferences; the observed deadlocks and data-integrity failures must not be user-disableable. | WS-03 |
| 2026-09-01 | Fix the contradictory oversized-line error hint in the read tool alongside the prompt rules. | Prompt guidance alone cannot fully prevent failure pattern 1 while the tool's own error text instructs a retry that the clamp makes impossible. | WS-03 |
| 2026-09-01 | One spec with ordered workstreams; each stage independently shippable. | Matches existing spec practice; avoids a half-migrated prompt system. Confirmed by user. | All |
| 2026-09-01 | Support user-created custom modules as first-class registry entries appended after shipped workflow modules; they replace the appendix channel as the user-facing extension point. | Requested by user; a first-class list with title/body/order is clearer than an invisible appendix and shares the same toggle/editor UI. | WS-01, WS-02 |
| 2026-09-01 | Prompt tab header shows a startup-context usage panel with per-section estimated tokens and suggested budgets, reusing the existing character-based conservative estimator. | Requested by user (Context Usage-style breakdown); users editing or adding modules need immediate feedback before overlong prompts degrade turns. No new tokenizer dependency; estimates stay labeled as estimates per existing usage-projection policy. | WS-01, WS-02 |
| 2026-09-01 | Lift `estimateTextTokens` into `@pivi/agent`; estimate sections in app composition; calibrate suggested budgets with the same estimator. | Audit findings: the estimator lives in `@pivi/engine-pi` (which React/agent must not import), not in `@pivi/agent/settings` as first assumed — `calculateContextEnvelope` is budget arithmetic only; the whole-text `looksStructured` heuristic overestimates fence-containing prose modules by ~1/3, which same-estimator budget calibration cancels; tool-section estimation needs the composition-owned ToolSpec/MCP inventory, so React receives numbers, not text. | WS-01, WS-02 |
| 2026-09-01 | Prompt tab sits after Toolbar; locked core modules are hidden from the card list; editable workflow/custom bodies use a reading-height editor in a centered column. | Visual QA: edge-to-edge layout felt cramped, core cards added no action, and 160px editors were too short to read. Confirmed by user. | WS-02 |
| 2026-09-01 | Usage panel is informational: compact K/M estimates, no suggested budget, no over-budget warning. | Tools/MCP size depends on the enabled set and is not a Prompt-tab budget the user can "fix"; raw five-digit counts are hard to scan. Confirmed by user. | WS-02 |
| 2026-09-01 | Fold About into the end of General so the strip stays eight tabs after adding Prompt. | Nine tabs wrapped to two rows; About is version/links rather than a configuration domain. Confirmed by user. | WS-02 |
| 2026-09-01 | Add main-Agent-only `pivi_prompt` as a fourth Pivi management tool, sharing Settings persist + `refreshPrompt()` rather than vault-mutating `settings.json`. | Same confirmation/revision/refresh contract as `pivi_commands`. Settings.json is mixed-purpose so it stays writable for other fields; prompt composition is owned by the tool + Settings Prompt tab. Confirmed by user. | WS-05 |
| 2026-09-03 | Prompt-tab human visual sign-off is closed as superseded. | Spec 048 (Settings UI system and grouped navigation) redesigns the entire settings surface including the Prompt tab, so signing off the pre-048 visuals has no lasting value. Owner authorized closing 046 on functional evidence. | WS-02 |
| 2026-09-03 | The "does not exceed the current assembled length" criterion is closed as satisfied by a one-time measurement, not a durable fixture. | WS-01 measured the refactor length-neutral (static 15052 ≤ 15215; representative 30211 ≤ 30709) before WS-03 intentionally added failure-driven and workflow bodies, so a ceiling pinned to the pre-046 length would reject content the spec required. The durable size signal is the Prompt tab usage panel. | WS-01 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Prompt module registry (core/workflow/custom), composition, three-layer dedupe, prompt-key coverage, `estimateTextTokens` lift into `@pivi/agent`, per-section usage estimation + calibrated suggested budgets, length fixture | Grok 4.6 High (WS-01) | Done | Design confirmed | Prompt composition/key/estimation tests; engine compaction suite unchanged; length fixture; full prompt suite |
| WS-02 | Synced `promptModules` + `customPromptModules` persistence, `SettingsPorts` extension, React Prompt tab with badge/restore, custom-module CRUD/reorder, usage panel, search metadata, i18n | Grok 4.6 High (WS-02) | Done | WS-01 module contract | Settings/jsdom tests; i18n dead-key scan; human visual sign-off |
| WS-03 | Workflow module bodies (normalization default-off, transcript cleanup, wikilink, frontmatter, daily notes), failure-driven core rules, read error-hint fix | Grok 4.6 High (WS-03 bodies) | Done | WS-01 | Prompt-content tests; read-tool error tests |
| WS-04 | Documentation sync and repository/live-host verification | Grok 4.6 High (WS-04) | Done | WS-01–WS-03 | Full gates, reload, `obsidian dev:errors` |
| WS-05 | Main-Agent-only `pivi_prompt` over the shared prompt-composition coordinator: list/get, workflow enable/body/restore, custom upsert/remove/move, one-shot confirmation, catalogRevision, persist+refreshPrompt | Cursor | Done | WS-02 persist contract | Management tool/schema tests; coordinator CAS; approval i18n; focused prompt persist tests |

## Verification

Required behavioral fixtures:

- Default composition equals current guidance semantics (no rule lost, no rule duplicated across layers) and does not exceed the current assembled length.
- Disabling a workflow module removes exactly its body; core modules ignore persisted disable/edit attempts.
- A custom body replaces the default verbatim; restore returns the shipped default and clears the badge; unknown persisted module ids survive a settings save.
- `computeSystemPromptKey` changes when any shipped module's enablement or body, or any custom module's title/body/order/enablement, changes and is stable otherwise.
- Custom modules compose after shipped workflow modules in persisted order; a disabled custom module contributes nothing; deleting one removes exactly its body; generated ids never collide with shipped ids.
- Usage-panel sections sum to the whole composed representative prompt; each section shows a compact estimate; totals visibly re-estimate after an edit, toggle, add, or delete.
- `estimateTextTokens` produces identical values from its new `@pivi/agent` home (engine compaction tests pass unchanged); estimation happens only in app composition and `SettingsPorts` carries numbers, never module text for React-side estimation.
- With the normalization module enabled, the assembled prompt instructs pre-edit semantic splitting via `obsidian_edit`; disabled (default), the prompt retains only the 044/045 work-around guidance.
- The oversized-line read error names `startLine` + `startChar` continuation and never instructs raising `maxChars` beyond the effective clamp.
- Prompt content asserts the failure-driven rules: identical-retry ban, coordinate exclusivity, stats-first page planning, search-not-read, verbatim `old_string`, no fabricated quotes in rewrites, no draft copies, no silent stalls.
- `pivi_prompt` is main-Agent-only and sequential; subagent registries omit it structurally. list/get skip confirmation; every mutation requires one sidebar confirmation and `catalogRevision` from a prior list/get. Stale revision fails with `state_changed` and does not write.
- Core ids reject enable/body/restore/upsert/remove/move. Workflow ids accept set_enabled / set_body / restore. Custom ids accept set_enabled / upsert / remove / move; omitting `id` on upsert creates a generated `custom:` id.
- Successful mutations persist through the same codec path as Settings → Prompt and refresh open-chat system prompts. Approval cards must not echo Agent-authored module bodies.
- Settings UI mutations bump the same in-memory `catalogRevision` so a concurrent Agent commit cannot clobber an unseen Prompt-tab save.

Commands:

```bash
npm run test -- tests/unit/agent/prompt
npm run test -- tests/unit/obsidian-tools
npm run test -- --selectProjects jsdom
npm run typecheck
npm run lint
npm run check:boundaries
npm run check:specs
npm run build
npm run check:bundle-size
obsidian plugin:reload id=pivi
obsidian dev:errors
git diff --check
```

Human visual sign-off (WS-02): the new Prompt settings tab — tab strip fit across eight tabs, the usage panel (stacked bar, compact section estimates), module cards, toggle/editor/badge/restore states, custom-module add/reorder/delete, light and dark themes. The coordinating agent must not mark this item done.

## Documentation sync

Owning handbook pages (the spec’s original `docs/06` guess is subagents; do not dump Prompt-tab docs there):

- Numbered developer docs: `docs/07-tools-skills-mcp-and-integrations.md` (typed module registry, single-owner rule, synced `promptModules` / `customPromptModules`, `pivi_prompt` management tool, `estimateTextTokens` home, oversized-line error hint, search-not-read) and `docs/08-presentation-and-settings.md` (eight settings tabs, Prompt tab, usage panel, `refreshPrompt`).
- Nearest local guidance: `packages/pivi-react/AGENTS.md` and `packages/agent/AGENTS.md` already matched the code (no WS-04 patch); `packages/obsidian-tools/AGENTS.md` already names `startChar` continuation and forbids raising `maxChars` past the clamp; `src/app/AGENTS.md` maps `createSettingsPromptPort` and `PromptCompositionCoordinator`; `packages/pivi-react/styles/AGENTS.md` manifest count updated to 41.
- Parent/package guidance: `packages/pivi-react/src/i18n/AGENTS.md` needed no Prompt-tab catalog-workflow change.
- Root guidance and roadmap: `AGENTS.md` Architecture Status bullet plus glossary **Prompt module**; `docs/10-roadmap-release-and-maintenance.md` shipped-capability note.

## Progress and handoff

### 2026-09-01 — Cursor — specification draft

- Changed: Drafted the spec from a grilling interview (scope, safety locking, drift handling, persistence, defaults, spec shape all user-confirmed) plus an eight-session failure-pattern scan of the live vault.
- Evidence: `packages/agent/src/prompt/{mainAgent,obsidianAgentTools,buildTurnPrompt}.ts`, `packages/pivi-react/src/settings/{SettingsShell,types}.tsx/ts`, specs 044/045, and session JSONL evidence quoted in Context.
- Remaining: User review of success criteria and decisions; then set the spec Active and claim WS-01.
- Blockers: Design review only.
- Next action: Review the Decisions table and success criteria with the user, then begin WS-01.

### 2026-09-01 — Cursor — scope extension

- Changed: Added user-created custom modules as first-class registry entries (replacing the appendix channel as the user-facing extension point) and a Prompt-tab startup-context usage panel with per-section estimated tokens and suggested budgets, per user request.
- Evidence: User-provided Context Usage screenshot as the presentation reference; existing conservative usage projection in `@pivi/agent/settings` as the estimator to reuse.
- Remaining: Same as above — design review, then Active.
- Blockers: None.
- Next action: User confirms the extended criteria, then WS-01 begins.

### 2026-09-01 — Cursor — execution start

- Changed: User asked to execute the spec. Set status Active. Claimed WS-01 for a Grok 4.6 High subagent (registry/composition/dedupe/estimator). Claimed WS-03 for a parallel Grok 4.6 High subagent to fix the oversized-line read error hint only; workflow bodies and failure-driven core rules wait on the WS-01 module contract.
- Evidence: Spec success criteria and Decisions table already user-confirmed by the execute request.
- Remaining: WS-01 contract, then WS-02 UI/persistence and remaining WS-03 bodies/rules, then WS-04 closeout.
- Blockers: None.
- Next action: Implement WS-01 and the independent read error-hint in parallel.

### 2026-09-01 — Grok 4.6 High — WS-03 error hint

- Changed: Reworded `paginateLineRange` / `paginateCharacterRange` failure hints in `@pivi/obsidian-tools` so they name `startLine` + line-relative `startChar` continuation (and `nextStartLine` / `nextStartChar`) and never instruct raising `maxChars` past the effective clamp. Pathological one-character-cannot-fit errors now tell the caller to stop rather than retry.
- Evidence: `packages/obsidian-tools/src/obsidian/readShared.ts`; focused tests in `tests/unit/obsidian-tools/readNoteCharacterPagination.test.ts`; error-hint ownership note in `packages/obsidian-tools/AGENTS.md`. `npm run test -- tests/unit/obsidian-tools` (13 suites / 203 tests), `npm run typecheck`, and `npm run lint` all green.
- Remaining: WS-03 workflow module bodies and failure-driven core prompt rules (blocked on WS-01). Error-hint slice is done. Numbered `docs/` sync is WS-04.
- Blockers: None for this slice.
- Next action: Keep WS-03 In progress until bodies and core rules land; do not mark the workstream Done.

### 2026-09-01 — Grok 4.6 High — WS-01

- Changed: Replaced the monolithic `getBaseSystemPrompt()` string with a typed prompt-module registry (`packages/agent/src/prompt/modules/`). Core modules are always composed; workflow modules register now with empty bodies (default-off `long-line-normalization`); custom modules append after shipped workflow. Lifted `estimateTextTokens` / `looksStructured` into `@pivi/agent/prompt` (engine compaction re-exports). Deduped long-line/edit examples to ToolSpec `promptUsage`; registered section keeps operational guidance with a cross-reference; static core keeps host-neutral safety. Added `promptModules` / `customPromptModules` on `PiviSettings` (defaults `{}` / `[]`). Calibrated `SUGGESTED_PROMPT_USAGE_BUDGETS` with the same estimator.
- Evidence: Default static length 15052 (≤ 15215 pre-change); representative assembled length 30211 (≤ 30709 pre-change, vault tools + mcp + skill + subagent + web). `npm run test -- tests/unit/agent/prompt tests/unit/engine-pi/session/piContextCompaction.test.ts` (7 suites / 64 tests), `npm run typecheck`, and `npm run lint` green. `check:architecture` currently fails on a parallel WS-03 test import of `@pivi/obsidian-tools/obsidian/readShared` (not this workstream).
- Remaining: WS-02 SettingsPorts / Prompt tab / i18n; remaining WS-03 workflow bodies and failure-driven core rules.
- Blockers: None for the WS-01 contract.
- Next action: WS-02 can consume `SHIPPED_PROMPT_MODULES`, `resolvePromptModules`, `composePromptSections`, `normalizePromptModuleSettings`, and `estimatePromptUsageSections`. Do not start WS-02 from this workstream.

### 2026-09-01 — Cursor — WS-01 accepted; WS-02 and WS-03 bodies start

- Changed: Verified WS-01 contract. Re-exported read pagination helpers from `@pivi/obsidian-tools` and fixed the WS-03 test import that broke `check:architecture`. Claimed WS-02 and remaining WS-03 for parallel Grok 4.6 High subagents.
- Evidence: `packages/agent/src/prompt/modules/{registry,compose,usage,types,coreBodies}.ts`; `PiviSettings.promptModules` / `customPromptModules`; `packages/obsidian-tools/src/index.ts`.
- Remaining: Prompt settings tab + runtime consumption of composition; workflow bodies + failure-driven core rules; WS-04 docs/gates.
- Blockers: None.
- Next action: Implement WS-02 and remaining WS-03 in parallel.

### 2026-09-01 — Grok 4.6 High — WS-03 bodies

- Changed: Filled shipped workflow `defaultBody` strings (transcript cleanup, wikilink conventions, frontmatter, daily/periodic notes default-on; long-line pre-edit normalization default-off). Added locked failure-driven rules in a single owning layer: core `tool-recovery` (no identical retry, no silent stall), core `mutation-safety` rewrite integrity (no fabricated quotes/facts, no ` (draft).md` copies), core `exact-match-editing` verbatim latest-read `old_string`, registered Vault-read guidance (clamp continuation, stats-first paging, mutually exclusive coordinates), and `obsidian_search` `promptUsage` (search is not a content-read backdoor). Recalibrated `SUGGESTED_PROMPT_USAGE_BUDGETS` with `estimateTextTokens` (core 5600, workflow 384). Error-hint slice was already landed.
- Evidence: `packages/agent/src/prompt/modules/{registry,coreBodies,workflowBodies,usage}.ts`; `packages/agent/src/prompt/obsidianAgentTools.ts`; `packages/obsidian-tools/src/obsidian/search.ts`; tests in `tests/unit/agent/prompt/{promptModules,promptContent,promptUsage,obsidianAgentTools,mainAgent}.test.ts` and `tests/unit/obsidian-tools/searchTool.test.ts`. `npm run test -- tests/unit/agent/prompt tests/unit/obsidian-tools` (21 suites / 254 tests) green. WS-03 files lint clean; repo `typecheck`/`lint` currently fail on parallel WS-02 Prompt-tab files, not this workstream.
- Remaining: WS-02 Prompt tab / SettingsPorts / i18n; WS-04 numbered `docs/` and live-host verification.
- Blockers: None.
- Next action: Coordinating agent can treat WS-03 as Done. Do not start WS-04 from this workstream.

### 2026-09-01 — Grok 4.6 High — WS-02

- Changed: Wired settings composition into `buildPiSystemPrompt` / `computePiSystemPromptKey` and `piChatRuntime` (normalize `promptModules` / `customPromptModules` at the settings boundary). Codec load now runs `normalizePromptModuleSettings` so unknown shipped override ids survive and invalid/colliding custom entries drop. Added `SettingsPorts.prompt` (module list + numeric usage snapshot + CRUD/toggle/restore) implemented in app composition with `composePromptSections` + `estimatePromptUsageSections`; every persist calls `refreshPrompt()`. New Settings Prompt tab after Commands (nine tabs), usage stacked bar/rows with estimate labels and over-budget warning, core read-only cards, workflow toggle/editor/modified/restore, custom add/reorder/delete via `ModalLayer` `initialFocus='cancel'`. Full locale catalogs, search metadata, prompt-settings CSS.
- Evidence: Persistence round-trip in `tests/unit/app/settings/piviSettingsStorage.test.ts`; runtime composition in `tests/unit/agent/prompt/promptModules.test.ts`; port persist+refresh in `tests/unit/app/ui/createUiPorts.test.ts`; jsdom `tests/jsdom/pivi-react/PromptTab.test.tsx` plus updated SettingsPorts mocks. Gates green: `npm run test -- tests/unit/agent/prompt tests/jsdom/pivi-react tests/jsdom/app-ui` (40 suites / 403 tests), `npm run typecheck`, `npm run lint`, `npm run check:boundaries`, `npm run check:i18n-dead-keys`.
- Remaining: Human visual sign-off of the Prompt tab (tab strip, usage panel, cards, light/dark). Numbered `docs/` is WS-04. Do not mark visual QA done from this workstream.
- Blockers: None.
- Next action: Coordinating agent can treat WS-02 as Done once the listed gates are green; leave the Verification human visual sign-off unchecked.

### 2026-09-01 — Grok 4.6 High — WS-04

- Changed: Synced numbered handbook and operational guidance to the shipped composable prompt system. `docs/07` now describes the typed module registry (core locked, workflow composable including default-off long-line normalization, custom after workflow), single-owner rule, synced `promptModules` / `customPromptModules` (absent = defaults; unknown shipped ids preserved on save, ignored at composition), `estimateTextTokens` in `@pivi/agent/prompt` with engine re-export, oversized-line errors naming `startLine` + line-relative `startChar` (never raise `maxChars` past the clamp), and search-not-read. `docs/08` documents nine settings tabs, the Prompt tab (usage panel via `SettingsPorts.prompt`, core read-only, workflow toggle/editor/restore, custom CRUD with shared destructive modal), and `refreshPrompt`. Root `AGENTS.md` Architecture Status + glossary **Prompt module**; `docs/10` shipped-capability note; `src/app/AGENTS.md` maps `createSettingsPromptPort`; styles AGENTS.md manifest count 41. Confirmed `packages/pivi-react/AGENTS.md`, `packages/agent/AGENTS.md`, and `packages/obsidian-tools/AGENTS.md` already matched the code. Did not archive the spec; did not mark human visual sign-off done.
- Evidence:
  - `npm run test -- tests/unit/agent/prompt` — 7 suites / 51 tests passed
  - `npm run test -- tests/unit/obsidian-tools` — 14 suites / 204 tests passed
  - `npm run test -- --selectProjects jsdom` — 45 suites / 400 tests passed
  - `npm run typecheck` — green
  - `npm run lint` — ESLint: No issues found
  - `npm run check:boundaries` — architecture, package-readmes, i18n dead-keys (957 catalog / 960 referenced), specs, pi-pins all passed
  - `npm run check:specs` — Specs check passed
  - `npm run check:i18n-dead-keys` — passed
  - `npm run build` — styles.css 181.8 KB; copied main.js / manifest.json / styles.css to the vault plugin folder
  - `npm run check:bundle-size` — main.js 4,156,340 bytes (3.96 MB); 1.04 MB below 5 MB cap
  - `obsidian plugin:reload id=pivi` — Reloaded: pivi
  - `obsidian dev:errors` — No errors captured.
  - `git diff --check` — clean
- Remaining: Human visual sign-off of the Prompt tab (tab strip across eight tabs, usage panel, module cards, toggle/editor/badge/restore, custom CRUD, light and dark). Spec stays Active.
- Blockers: None for WS-04. Visual QA is a human gate.
- Next action: User inspects Settings → Prompt in the reloaded plugin. Coordinating agent must not mark the Verification “Human visual sign-off” item done from this workstream. Do not Complete/archive the spec until that sign-off lands.

### 2026-09-01 — Cursor — WS-05

- Changed: Added main-Agent-only `pivi_prompt` as the fourth Pivi management tool. Host-neutral ToolSpec/schema/parse live in `@pivi/agent`. App `PromptCompositionCoordinator` shares in-memory `catalogRevision` (WeakMap on `host.settings`) with Settings → Prompt so UI saves and Agent CAS use the same persist + `refreshPrompt()` path. Core modules stay list/get only; workflow accepts enable/body/restore; custom accepts upsert (omit `id` to create), enable, remove, and move. Mutations require one sidebar confirmation and a matching `catalogRevision`; approval cards never echo Agent-authored bodies. `.pivi/settings.json` is not a managed vault-mutation namespace.
- Evidence:
  - `npm run test -- tests/unit/obsidian-tools/management/piviManagementTools.test.ts tests/unit/app/runtime/piviManagementService.test.ts tests/unit/app/runtime/promptCompositionCoordinator.test.ts tests/unit/app/piviManagementApprovalPresentation.test.ts tests/unit/agent/tools/toolPresentation.test.ts tests/unit/app/obsidianSettingsIntegration.test.ts tests/jsdom/pivi-react/ToolsSettingsPage.test.tsx tests/unit/app/ui/createUiPorts.test.ts` — 8 suites / 142 tests passed
  - `npm run typecheck` — green
  - `npm run lint` — ESLint: No issues found
  - `npm run check:boundaries` — architecture, package-readmes, i18n dead-keys, specs, pi-pins passed
  - `npm run build` — styles.css 181.9 KB; copied main.js / manifest.json / styles.css to the vault plugin folder
  - `obsidian plugin:reload id=pivi` — Reloaded: pivi
  - `obsidian dev:errors` — No errors captured.
  - `git diff --check` — clean
- Remaining: Human visual sign-off of the Prompt tab (WS-02). Spec stays Active.
- Blockers: None.
- Next action: User inspects Settings → Prompt in the reloaded plugin. Coordinating agent must not mark the Verification “Human visual sign-off” item done from this workstream. Do not Complete/archive the spec until that sign-off lands.

### 2026-09-03 — Grok 4.6 High — closeout

- Changed: Checked every success criterion that the current code and focused tests still prove. Recorded the Prompt-tab visual sign-off as superseded by spec 048. Set status Completed and archived the spec.
- Evidence: Registry/composition/key/content/usage live in `packages/agent/src/prompt/` and `tests/unit/agent/prompt/` (7 suites / 59 tests). Persistence and `refreshPrompt()` live in settings codec + `createSettingsPromptPort` / `PromptCompositionCoordinator`. Prompt tab hides core cards, shows usage/workflow/custom CRUD, and ships all 10 locale catalogs (`tests/jsdom/pivi-react/PromptTab.test.tsx`). Read-error hint names `startLine` + line-relative `startChar` and forbids raising `maxChars` (`packages/obsidian-tools/src/obsidian/readShared.ts`; `tests/unit/obsidian-tools` 15 suites / 213 tests). jsdom 45 suites / 403 tests. Owner authorized closeout on functional evidence; visual QA superseded by 048.
- Remaining: none
- Blockers: none
- Next action: archived

## Completion summary

Shipped a typed `@pivi/agent/prompt` module registry (locked core, composable workflow, user custom after workflow), Settings → Prompt with an informational startup-usage panel, synced `promptModules` / `customPromptModules`, failure-driven core/tool guidance, the oversized-line read-hint correction, and main-Agent-only `pivi_prompt` on the shared persist + `refreshPrompt()` path.

Deviations: Prompt-tab human visual sign-off is superseded by spec 048 (owner-authorized; pre-048 visuals have no lasting value). The assembled-length ceiling criterion is unchecked: WS-01 recorded a one-time measurement (static 15052 ≤ 15215, representative 30211 ≤ 30709) in its handoff, but no durable length fixture exists in `tests/unit/agent/prompt/`, and later WS-03 workflow/failure-driven bodies were intended new content rather than a length-neutral refactor.

Closeout verification (2026-09-03): `npm run test -- tests/unit/agent/prompt` — 7 suites / 59 tests passed; `npm run test -- tests/unit/obsidian-tools` — 15 suites / 213 tests passed; `npm run test -- --selectProjects jsdom` — 45 suites / 403 tests passed. Prior WS-04/WS-05 already recorded typecheck, lint, boundaries, production build, bundle-size, reload, and `obsidian dev:errors`.

Durable documentation already synced: `docs/07-tools-skills-mcp-and-integrations.md`, `docs/08-presentation-and-settings.md`, `docs/10-roadmap-release-and-maintenance.md`, root `AGENTS.md` (Architecture Status + **Prompt module** glossary), `src/app/AGENTS.md`, `packages/pivi-react/AGENTS.md`, `packages/pivi-react/styles/AGENTS.md`, `packages/agent/AGENTS.md`, `packages/obsidian-tools/AGENTS.md`.
