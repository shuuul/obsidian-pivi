# Obsius design TODO

This file tracks design follow-ups discovered during the June 2026 docs / `AGENTS.md` refresh. Treat these as maintenance candidates, not committed implementation plans; promote any medium+ item into `docs/specs/` before coding.

## P0 — Tool/security input hardening

### 1. Fix `no-base-to-string` warnings in tool/security paths

**Why:** Tool inputs and approval patterns are untrusted model-facing boundaries. Accidentally stringifying objects as `[object Object]` can produce unsafe approval patterns, confusing tool args, or misleading UI.

**Initial targets:**

- `src/core/security/ApprovalManager.ts`
- `src/pi/mcp/createPiMcpProxyTool.ts`
- `src/pi/tools/obsidian/properties.ts`
- `src/pi/tools/obsidian/tasks.ts`
- `src/pi/tools/obsidian/writeNote.ts`

**Plan:**

1. Audit each warning and identify expected input shape.
2. Add or reuse small local extraction helpers such as `readStringField(input, key)` only where they reduce repeated unsafe casts.
3. For approval matching, prefer explicit string validation over coercion.
4. For tool handlers, return user-readable validation errors instead of silently coercing unknown values.
5. Add focused unit tests for malformed object/array inputs at approval/tool boundaries.
6. Run targeted tests plus `npm run lint`.

**Acceptance:**

- `@typescript-eslint/no-base-to-string` warnings cleared for the targeted files.
- Malformed object inputs do not become `[object Object]` in approval patterns, file paths, task lines, property values, or MCP descriptions.

---

## P1 — Pi / pi-ai / pi-coding-agent boundary cleanup

### 2. Define and enforce provider credential ownership

**Why:** Credential handling is currently hybrid: `pi-ai Models` receives an Obsidian-backed `CredentialStore` / `AuthContext`, but `PiChatRuntime` and `PiAuxQueryRunner` still use `Agent.getApiKey` with `resolvePiApiKey` as a compatibility path.

**Current known paths:**

- `src/pi/piAiModels.ts` — `configurePiAiModels({ credentials, authContext })`
- `src/pi/auth/ObsidianCredentialStore.ts` — pi-ai `CredentialStore`
- `src/pi/app/PiWorkspaceServices.ts` — constructs credential/auth context
- `src/pi/runtime/piModelEnv.ts` — compatibility resolver
- `src/pi/runtime/PiChatRuntime.ts` / `PiAuxQueryRunner.ts` — `Agent.getApiKey`

**Plan:**

1. Write a short architecture note or section in `docs/architecture/agent-runtime.md` describing credential ownership:
   - Obsius UI owns user interaction.
   - Obsidian SecretStorage/keychain owns local secure storage.
   - `pi-ai` owns provider auth resolution where possible.
   - `pi-agent-core` should not learn Obsius settings format.
2. Trace runtime calls to confirm when pi-agent-core still requires `getApiKey`.
3. Change credential lookup order so `pi-ai Models.getAuth()` is the preferred path where supported.
4. Keep `resolvePiApiKey` only as a documented fallback for providers/runtime paths that still require synchronous API-key style auth.
5. Verify OpenAI Codex OAuth refresh writes go through `CredentialStore.modify()` when pi-ai performs refresh.
6. Add tests around credential priority:
   - SecretStorage credential wins over env snippets where intended.
   - disabled provider returns no credential.
   - Codex OAuth token path remains compatible.

**Acceptance:**

- Architecture docs describe the final boundary.
- Runtime code has a clear primary pi-ai auth path and a named compatibility fallback.
- Existing user credentials continue working without re-entry.

### 3. Enforce pi-coding-agent import boundaries

**Why:** Obsius is a plugin UI around `pi-agent-core`, not the Pi CLI/TUI. pi-coding-agent concepts should not leak into `src/core/**` or `src/features/**`.

**Plan:**

1. Inventory imports of:
   - `@earendil-works/pi-coding-agent`
   - `@earendil-works/pi-agent-core`
   - `@earendil-works/pi-ai`
2. Decide allowed zones:
   - `src/pi/**` may import Pi packages.
   - `src/core/**` and `src/features/**` must not import Pi packages.
   - Narrower allowed pi-coding-agent zones may be `src/pi/session/**`, `src/pi/context/**`, `src/pi/skills/**`.
3. Add ESLint `no-restricted-imports` rules to encode the boundary.
4. Add a short note to `docs/architecture/framework-adapters.md` or `src/pi/AGENTS.md` describing the rule.
5. Run `npm run lint`.

**Acceptance:**

- Lint blocks future Pi package imports outside approved adaptor modules.
- No existing legitimate adaptor import is blocked.

### 4. Decide long-term session dependency strategy

**Why:** `src/pi/session/**` currently wraps pi-coding-agent session utilities. This is acceptable if stable, but the dependency should remain explicit and isolated.

**Plan:**

1. List exactly which pi-coding-agent session APIs are used.
2. Evaluate churn risk across recent pi package versions.
3. Choose one:
   - continue wrapping upstream APIs, or
   - vendor/minimally implement only the JSONL tree writer/reader Obsius needs.
4. Record decision in `docs/specs/session-tree-spec.md`.
5. If keeping upstream, add fixture tests that catch upstream behavior drift.

**Acceptance:**

- Session dependency decision is documented.
- Upgrade risk is covered by fixtures or reduced by local implementation.

### 5. Clean up session API naming and `agentState` compatibility

**Why:** Durable identity is `(sessionFile, leafId)`, but some contracts still expose older UI-projection names such as `syncOpenSessionState(...)`, `buildSessionUpdates(...)`, and `agentState.piSessionFile` compatibility.

**Plan:**

1. Inventory all `agentState`, `piSessionFile`, `syncOpenSessionState`, and `buildSessionUpdates` references.
2. Classify each reference:
   - active compatibility fallback,
   - durable state that should move to `sessionFile` / `leafId`, or
   - removable legacy code.
3. Rename runtime-facing APIs where safe, e.g. `syncSession(sessionFile, leafId)`.
4. Keep migration fallback readers for older saved plugin data, but avoid writing new durable identity into opaque `agentState`.
5. Update tests for restore, fork, rewind, and old-state migration.

**Acceptance:**

- New persisted state stores `sessionFile` and `leafId` directly.
- Any remaining `agentState` usage is documented compatibility only.
- Existing sessions/tabs restore after migration.

---

## P1 — UI / UX improvements

### 6. Improve model/provider onboarding and status visibility

**Why:** Provider settings are powerful but still feel configuration-heavy. Users should understand what model is ready, why a model is unavailable, and how to fix it.

**Plan:**

1. Audit current provider settings UI in `src/pi/ui/models-settings/**`.
2. Add a status model that can represent:
   - ready,
   - missing API key,
   - OAuth expired,
   - provider disabled,
   - model unavailable,
   - env snippet configured but untested.
3. Surface status in provider rows and model picker entries.
4. Add a “Test model” action that performs a tiny safe request or aux query.
5. Convert low-level provider/auth errors into actionable UI text.
6. Add unit tests for status derivation helpers; manually test settings flows.

**Acceptance:**

- A user can tell why a selected model will or will not work before sending a chat turn.
- Provider status and model picker status agree.

### 7. Improve MCP availability UX

**Why:** Users configure servers, but the chat UI should explain what MCP tools are active for the current turn.

**Plan:**

1. Extend MCP toolbar/dropdown data to include:
   - server connection/test status,
   - auth status,
   - tool count,
   - disabled tool count.
2. Show current-turn active MCP servers in the toolbar or status panel:
   - servers mentioned in the composer,
   - servers enabled from the toolbar.
3. Add action buttons for common failure recovery:
   - authenticate,
   - test server,
   - open settings,
   - disable for this turn.
4. Ensure `McpServerManager` remains the source of mention/active-server semantics.
5. Add tests for active-server merge behavior if helpers are changed.

**Acceptance:**

- Before send, users can see which MCP servers are active.
- On MCP auth/connection failure, UI offers the next action.

### 8. Make inline context tokens more understandable

**Why:** Token-based inline context is simpler than visual chips, but it needs enough affordance to be discoverable and removable.

**Plan:**

1. Add or improve token tooltip/label content:
   - note path,
   - line range,
   - short selected-text preview.
2. Verify keyboard navigation and remove behavior in `RichChatInput` / mention badge DOM.
3. Consider a small composer-side summary such as “1 selected passage attached”.
4. Add manual checks for IME, backspace/delete, and focus ring.
5. Update `inline-context-input-panel-spec.md` if UI behavior changes.

**Acceptance:**

- Users can identify what an inline-context token represents.
- Keyboard-only users can focus and remove the token.

### 9. Improve session history and branch/leaf UX

**Why:** JSONL session tree support is powerful, but users need a clearer mental model for fork, rewind, and branch selection.

**Plan:**

1. Audit current history UI in `SessionController` / tab/session components.
2. Enhance session summaries with:
   - title,
   - last response time,
   - last model if available,
   - branch/leaf count,
   - active leaf marker.
3. Prototype a minimal branch map for sessions with multiple leaves.
4. Clarify actions:
   - open in current tab,
   - open in new tab,
   - fork from checkpoint,
   - rewind current tab.
5. Add tests around leaf list formatting if logic is extracted.

**Acceptance:**

- A user can distinguish “new session file” from “different leaf in same session”.
- Fork and rewind affordances are visibly different.

---

## P2 — Engineering quality cleanup

### 10. Review `require-await` warnings by contract

**Why:** Many async functions are async only because interfaces are async. Some are legitimate; others obscure control flow.

**Plan:**

1. Group warnings by owner:
   - `PiSessionStore`,
   - `PiChatRuntime`,
   - tab cleanup,
   - skill tools,
   - settings helpers.
2. For each group, decide:
   - keep async because a port requires `Promise`,
   - remove async and update callers,
   - add an actual awaited async boundary if missing.
3. Prefer not to change public ports unless the cleanup removes real ambiguity.
4. Add comments only where async is intentionally required by an interface.
5. Run `npm run lint` and targeted tests.

**Acceptance:**

- Warnings are reduced where cleanup is safe.
- Remaining async-without-await cases are intentional and documented by type/interface context.

### 11. Continue incremental controller decomposition

**Why:** `InputController`, `StreamController`, and some renderers exceed size/complexity thresholds. Large rewrites are risky; behavior-based extraction is safer.

**Plan:**

1. Pick one hotspot per PR.
2. Extract by behavior, not by arbitrary line count:
   - queued turn submission,
   - provider boundary validation,
   - stream tool-result routing,
   - subagent lifecycle handling,
   - render queue scheduling.
3. Add focused unit tests around extracted helpers.
4. Keep controller public interfaces stable.
5. Avoid mixing UI changes with refactor commits.

**Acceptance:**

- Complexity/line warnings decline gradually.
- Behavior stays covered by focused tests.

### 12. Refresh docs governance after implemented notes

**Why:** Notes can become misleading when implemented but left as future plans.

**Plan:**

1. Add a lightweight quarterly or release-prep docs audit checklist.
2. For every note/spec changed by implementation, require one of:
   - update status to implemented/partial/obsolete,
   - promote stable decisions to architecture docs,
   - delete or archive superseded detail.
3. Keep `docs/glossary.md` as canonical terminology and avoid duplicating terminology tables in root `AGENTS.md`.

**Acceptance:**

- Future docs audits find fewer stale “future” notes.
- New contributors and agents can identify authoritative docs quickly.
