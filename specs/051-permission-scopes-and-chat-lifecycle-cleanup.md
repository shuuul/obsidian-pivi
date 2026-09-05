---
id: "051"
title: "Permission scopes and chat lifecycle cleanup"
status: Active
created: 2026-09-05
updated: 2026-09-05
coordinator: "Amp"
---

# 051 — Permission scopes and chat lifecycle cleanup

## Context

This spec combines two user-reported trust and lifecycle problems that were investigated against the current source and the live `/Users/shuuul/obsidian/Base` vault on 2026-09-05. The product decisions were then settled through a multi-round grill. No implementation is accepted merely because this plan exists.

### Permission approvals

The current Bash authorization model persists either the complete shell string (`exact-shell`) or an arbitrary argv prefix. The sidebar first asks Deny / once / session / always and, after Always, may ask a second question choosing the complete command or only its executable. Consequently:

- exact grants include changing filenames, URLs, patterns, and script bodies, so logically identical CLI operations can prompt repeatedly;
- executable-prefix grants can be broader than the user understands because Settings displays encoded/raw allowlist values rather than a semantic scope;
- session grants introduce a fourth duration that is difficult to distinguish from once and always;
- Skills receive the same registered Bash tool and approval port as ordinary turns. They do not bypass policy, but Skills commonly issue several commands whose arguments differ and therefore amplify exact-command re-prompts;
- Bash grants and persistent external-directory grants are edited as unrelated raw settings instead of one inspectable permission registry.

Live-vault evidence at inspection time:

| Evidence | Observed result |
| --- | --- |
| Session history inspected | 218 JSONL sessions; 18 Bash tool calls found |
| `.pivi/settings.json` Bash entries | 15 total: 12 legacy executable-wide values, one `prefix:["ls"]`, and two `exact:` values containing filenames or compound commands |
| Effective duplication | Both exact entries were already covered by broader `ls` / `grep` grants |
| Skill boundary | Skill execution receives the ordinary tool registry and capability approval path; there is no Skill-specific authorization bypass |

The intended replacement is not a shell sandbox and does not claim that executable-wide authorization is intrinsically safe. It makes the persistent scope stable, explicit, reviewable, and independent of invocation data that naturally changes.

### Empty archived chats and ineffective cleanup

The live vault's `.pivi/tab-manager-state.json` had 221 tab records, including 21 archived bindings. Every archived binding had a session file; the initial theory that the rows were titleless, unbound draft tabs was disproved. Bound titles come from JSONL metadata rather than `draftTitle` in tab state.

Of those 21 archived sessions, 18 had no persisted `user` or `assistant` message. Seventeen ordinary files contained only a session header, timestamp title metadata, and `pivi/ui-context`; another was an empty recovered session. In the rendered tab switcher the ordinary rows displayed timestamp labels such as `Sep 5, 03:08 PM`, not a literally blank title. The user-visible defect is therefore a set of contentless chats with placeholder-like titles.

Two creation clusters were observed around 15:08 and 15:10 local time. Later mount/reconciliation passes created their archived tab bindings in batches. The durable shape proves that a JSONL/open-session create-and-update sequence completed without a user message, after which `reconcileDurableSessionTabs()` treated each file as a normal durable session and added an archived tab. There is no durable event log that identifies the exact initiating UI gesture for those two historical clusters; this spec does not invent one.

The cleanup behavior has a separate verified cause:

- Archive changes tab visibility/state and deliberately retains the durable session.
- Delete marks the session file in the device's `deletedSessionFiles` recovery queue.
- **Permanently delete removed sessions** iterates only that queue.
- The live queue was empty, so the cleanup action correctly returned zero even though 21 archived rows remained.

Session JSONL has no independent snapshot backup. The session journal protects interrupted persistence, and indexes are rebuildable; neither restores a permanently purged chat. Obsidian File Recovery snapshots protect supported `.md` / `.canvas` vault mutations, not Pivi session JSONL. Recoverability after Delete now depends on the JSONL remaining under `.pivi/trash/sessions/` until expiration or explicit purge.

## Goal and success criteria

Users approve stable semantic capabilities once, inspect every permanent grant in Settings, and can distinguish archived, recently deleted, and permanently removed chats. Contentless session artifacts never enter history and are safely reclaimed without risking a valid first message or an in-progress cloud download.

- [ ] Every Bash and external-directory miss presents exactly **Deny / Allow once / Always** in one approval surface; there is no session-duration choice or second confirmation screen.
- [ ] Every Always decision previews and persists a structured final scope. Bash scopes contain only executable identity plus, when reliably classified, one semantic command token; no filename, URL, search pattern, or script body can enter persistent storage.
- [ ] Safe `&&` and pipeline commands are represented as independently matchable component scopes approved in one prompt. Shell expressions involving redirects, substitutions, dynamic expansion, or unsupported control syntax can run only with Allow once.
- [ ] Bare executable names, absolute/realpath executables, and relative executable paths obey the identity rules in Decisions and cannot accidentally inherit one another's grants.
- [ ] Settings > Built-in tools lists all persistent Bash and external-directory permissions, supports safe scope changes, enable/disable where required, individual revoke, clear-all, and classified text entry with normalized preview.
- [ ] Existing Bash/external-directory settings migrate once into vault-scoped device-local structured storage, deduplicate by semantic identity, strip legacy synced fields, and do not broaden a high-risk exact grant without leaving the migrated record disabled for user review.
- [ ] Disabling Bash or external read does not erase its permission records; re-enabling restores the same records.
- [ ] A durable session with at least one valid persisted user message remains history even if it has no assistant reply. A parse-corrupt session is reported and never auto-deleted.
- [ ] A session with no persisted user message is compensated when the owning lifecycle creates and abandons it; startup also permanently removes eligible stale empty files and every stale archived binding without putting them in Recently deleted.
- [ ] Startup cleanup requires a valid complete parse, at least one hour of stable filesystem mtime, and absence from active session-journal ownership. It runs after journal/cloud recovery and before session summaries are reconciled into tabs.
- [ ] Settings > Session files displays unique Archived and Deleted counts. **Delete all archived chats** globally deduplicates by `sessionFile`, moves eligible archived sessions into Deleted, and skips/reports any file still bound by a non-archived tab.
- [ ] Deleted sessions remain recoverable only through `pivi_sessions` until retention expiry or explicit permanent purge. Settings gives a natural-language recovery instruction plus the tool name, but no per-session recovery list.
- [ ] Targeted, full type/lint/boundary, production build, and live Obsidian scenarios pass; all changed rendered states are captured and inspected, with separate human visual sign-off before closeout.

## Scope and non-goals

In scope:

- Host-neutral structured permission types, Bash parsing/classification/matching, external-directory grant identity, and one-time migration.
- A vault-scoped device-local permission store composed through the existing Obsidian local-storage and settings-codec boundaries.
- Capability approval contracts, the sidebar prompt, immediate runtime grant visibility, Settings ports/presentation, and complete locale updates.
- Empty-session lifecycle compensation, startup orphan cleanup, durable-tab reconciliation ordering, and cleanup of associated session indexes/journal/overlay state through owning APIs.
- Vault-wide archived/deleted inventory, bulk archived deletion, Settings counts/copy/actions, and existing retention/purge behavior.
- Focused regression tests, live-vault verification with disposable fixtures, durable docs/guidance synchronization, and migration evidence.

Not in scope:

- Sandboxing commands, command risk scoring, per-file Bash grants, arbitrary shell-AST authorization, or claiming an approved executable is safe.
- Skill-specific grants, chat/Skill provenance, timestamps, usage telemetry, audit history, or cloud-synced/device-portable permissions.
- Reintroducing session grants, adding another Always confirmation dialog, or silently approving an unsafe compound shell expression.
- Treating Archive as Delete, removing Archive, adding a Recently deleted chat browser, or restoring deleted chats from Settings.
- A session snapshot/backup system, recovery after physical purge, changes to Obsidian File Recovery, or deletion of malformed/incompletely parsed JSONL.
- Release/version/tag/publication work or destructive cleanup of the user's current vault during implementation.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
| --- | --- | --- | --- |
| 2026-09-05 | Bash and external-directory prompts use only Deny / Allow once / Always. The selected permanent scope is visible and editable inline in the same surface. | Removes ambiguous session duration and the current two-step Always flow without hiding what becomes permanent. | WS-02 |
| 2026-09-05 | Permanent Bash scope is either one executable or executable + one reliable semantic command token. Invocation data—paths, filenames, URLs, patterns, expressions, and bodies—is never persisted. | Stable scopes stop argument churn from causing repeated prompts and are understandable in Settings. | WS-01, WS-02, WS-03 |
| 2026-09-05 | Single-purpose and unknown CLIs default to executable scope. Recognized multi-command CLIs use a semantic second token (`git status`, `obsidian eval`, `npm run`). Recognized executors use their stable operation/target token (`python3 -c`, `sh -c`, `npx marp`, `uv run`). | A versioned classifier can distinguish durable command identity from changing operands; unknown commands still have a deterministic fallback. | WS-01 |
| 2026-09-05 | Transparent wrappers resolve to the real executable/command before classification. The initial reviewed set includes `env` (including leading assignments) and `command`; unrecognized wrapper/control forms are Allow-once only until deliberately classified. | Avoid permissions for a wrapper that conceal the invoked capability without guessing through arbitrary shell syntax. | WS-01 |
| 2026-09-05 | Safe POSIX/cmd tokenization may split plain commands joined by `&&` or pipelines into independent scopes and approve them together. Redirects, command/process substitution, dynamic variable/glob expansion that changes executable identity, here-docs, backgrounding, `||`, and unsupported controls are not persistable. | Component rules are reusable; expressions with shell-dependent data flow are not reliably reducible to stable capabilities. | WS-01, WS-02 |
| 2026-09-05 | The classifier recommendation is advisory. The user may select a broader classifier-generated executable scope after an inline warning, with no second confirmation screen. Arbitrary raw prefixes are not offered. | Preserves user control while making widening explicit and bounded to representable scopes. | WS-02 |
| 2026-09-05 | Bare executables match by normalized name. Absolute executables match only an isolated canonical realpath. A relative-path executable never inherits a bare-name grant; it resolves to an isolated realpath when possible, otherwise Always is unavailable. | Prevents `tool`, `/tmp/tool`, and `./tool` from becoming accidental aliases while retaining usable local executables. | WS-01 |
| 2026-09-05 | Permissions are vault-scoped and device-local. Store only normalized rules and enabled state—no chat/Skill source, timestamps, counters, or usage history. | Command and filesystem authority is machine-specific and should not sync through the vault. Minimal records avoid creating an audit/telemetry subsystem. | WS-01, WS-03 |
| 2026-09-05 | Use a versioned `pivi.capability-permissions.v1` local-storage record with discriminated Bash scopes and canonical external-directory realpaths. Rule identity is its normalized content; no independent mutable ID is required. | Matches existing device-local store patterns and provides one source for runtime and Settings. | WS-01 |
| 2026-09-05 | Tool enablement and grants are independent. Turning off Bash/external read retains rules. Settings has one persistent-permissions area grouping Bash and external-directory records. | Users can temporarily close a capability without losing carefully reviewed grants. | WS-03 |
| 2026-09-05 | Settings text additions pass through the production classifier, show the normalized rules before commit, reject `exact:` / `prefix:` implementation syntax, and reject any input that has no safe persistent representation. | Prevents Settings from bypassing the same invariant enforced by the approval UI. | WS-01, WS-03 |
| 2026-09-05 | Legacy entries migrate once and then remain stable across future classifier versions. Existing prefix/executable grants preserve effective scope. Exact entries expand to the current recommended scope and deduplicate; any expansion involving an interpreter, shell, evaluator, package runner, unknown executable, or other high-risk executable class is disabled pending confirmation. | Migration fixes filename-bound rules without silently broadening dangerous exact grants. Persisted meaning must not drift when classifier tables later change. | WS-01 |
| 2026-09-05 | Archive, Delete, and permanent purge remain distinct. Archive is reversible visibility state; Delete moves JSONL into `.pivi/trash/sessions/`; permanent purge destroys that trashed copy. Inventory is the trash folder. Obsidian vault `.trash` is not used because it may be the system trash and is not a recoverable listing. Leftover `data.json` `deletedSessionFiles` marks are consumed once and relocated. | Folder listing is the natural source of truth; plugin-data queues drifted from the files. | WS-05 |
| 2026-09-05 | A session is empty when its valid durable JSONL contains no `message` entry whose role is `user`. Assistant failure after a persisted user message remains valid history. Custom/tool/UI metadata cannot make an otherwise empty session non-empty. | Protects user-authored content while excluding metadata-only artifacts. | WS-04 |
| 2026-09-05 | Lifecycle compensation immediately and permanently removes only an empty file whose ownership is known to the failing/abandoned create transaction. Startup cleanup handles historical residue only after journal recovery and only when valid, not bound by a non-archived/live tab, journal-unowned, and mtime-stable for at least one hour. | Immediate ownership is strong evidence; startup uses a sync-safety window and refuses uncertain/corrupt data. | WS-04 |
| 2026-09-05 | Existing eligible empty archived files and their tab bindings are automatically removed, not moved to Deleted and not confirmed interactively. | They contain no recoverable user conversation and would only pollute the recovery queue. | WS-04 |
| 2026-09-05 | Bulk archived deletion is vault-wide and keyed by unique `sessionFile`. It removes every archived binding, skips any file with a non-archived live/persisted binding, and reports moved/skipped/failed counts. | Prevents duplicate bindings from resurrecting a supposedly deleted session while preserving actively open chats. | WS-05 |
| 2026-09-05 | Settings shows unique Archived and Deleted counts, a bulk Archived → Deleted action, retention and permanent purge for Deleted, and natural-language `pivi_sessions` recovery guidance. It does not list individual deleted sessions. | Makes state and action scope explicit without building a second history browser. | WS-05 |
| 2026-09-05 | New Settings UI uses existing primitives and visual language. Any rendered change still requires automated interaction/accessibility checks, inspected screenshots, and human sign-off. | Structural reuse limits visual scope but does not waive UI acceptance. | WS-02, WS-03, WS-05 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done`. The coordinator owns this spec, cross-workstream integration, migrations, and final evidence. Shared permission contracts and shared session APIs are edited serially.

| ID | Deliverable | Owner | Status | Dependencies | Verification |
| --- | --- | --- | --- | --- | --- |
| WS-01 | Structured permission domain, classifier/matcher, device-local store, and legacy migration | Cursor | Done | None | Classifier matrix; migration fixtures; storage/codec tests |
| WS-02 | One-step capability approval contract and chat prompt | Cursor | In progress | WS-01 scope model | Prompt decision/compound/warning/cancel tests; rendered live states |
| WS-03 | Unified persistent-permissions Settings surface and app ports | Cursor | In progress | WS-01; WS-02 contract stable | Settings jsdom tests; device-local persistence; live light/dark inspection |
| WS-04 | Empty-session transaction compensation and startup cleanup | Cursor | In progress | None; integrate before WS-05 counts | JSONL/index/journal fixtures; startup/reload tests; live disposable residue |
| WS-05 | Archived/Deleted inventory, vault-wide bulk delete, Settings session lifecycle UI, docs and final integration | Cursor | In progress | WS-04 classification; WS-03 presentation patterns | Multi-view/tab fault matrix; Settings tests; full gates; real-host acceptance |

### WS-01 — Stable structured permissions

Own the host-neutral value model in `@pivi/agent` and the Obsidian device-local adapter in `src/app`. The persisted shape is conceptually:

```ts
type ExecutableIdentity =
  | { kind: 'name'; value: string }
  | { kind: 'realpath'; value: string };

type PersistentBashPermission =
  | { kind: 'executable'; executable: ExecutableIdentity; enabled: boolean }
  | {
      kind: 'subcommand';
      executable: ExecutableIdentity;
      subcommand: string;
      enabled: boolean;
    };

interface DeviceLocalCapabilityPermissionsV1 {
  version: 1;
  bash: PersistentBashPermission[];
  externalDirectories: Array<{ realpath: string; enabled: boolean }>;
}
```

Exact exported names may follow package conventions, but semantics may not change. Normalize case only where the host executable/filesystem semantics are case-insensitive. Resolve canonical paths through host adapters; the host-neutral classifier must not import Node/Obsidian APIs.

Implement one pure classification pipeline used by runtime requests, migration, and Settings input:

1. Tokenize with the resolved shell's safe parser.
2. Reject persistability for unsupported/dynamic syntax; retain Allow once for the original complete command.
3. Split allowed compound forms while preserving left-to-right display order.
4. Strip reviewed transparent wrappers and resolve each executable identity.
5. Select a stable second-level token only from a versioned semantic command/executor registry and only when that token is not invocation data.
6. Emit recommended scope, legal broader alternatives, risk/warning metadata, and a normalized display label.
7. Deduplicate exact normalized rules while preserving deterministic order.

Required classifier examples:

| Input | Recommended persistent scope |
| --- | --- |
| `grep needle notes/a.md` | `grep` |
| `ls notes/a.md` | `ls` |
| `git status --short` | `git status` |
| `obsidian eval code=...` | `obsidian eval` |
| `npm run test -- foo.test.ts` | `npm run` |
| `python3 -c '...'` | `python3 -c` with high-risk warning |
| `sh -c '...'` | `sh -c` with high-risk warning |
| `npx marp slides.md` | `npx marp` with executor warning |
| `uv run script.py` | `uv run` with executor warning |
| `env FOO=1 git status` | `git status` |
| `./bin/tool input.txt` | isolated realpath for `./bin/tool`, or no Always when resolution fails |
| `/opt/a/tool input` | canonical realpath `/opt/a/tool`, never bare `tool` |
| `grep a x && wc -l x` | two scopes, `grep` and `wc` |
| `cat x \| grep a` | two scopes, `cat` and `grep` |
| `cat x > out`, `$(tool)`, `` `tool` ``, `A=$X tool` when identity is dynamic | Allow once only |

Authorization succeeds only when every classified component has an enabled matching record. A subcommand permission matches that exact normalized executable identity and semantic token regardless of later argv; an executable permission matches all argv for that identity. Do not retain exact-shell matching after migration.

Create the local store through `App.loadLocalStorage` / `saveLocalStorage`, with strict tolerant decoding, canonical deduplication, immutable snapshots, and explicit update methods suitable for concurrent Settings/approval writes. The settings codec projects records into runtime tool construction but strips `bashAllowlist` and permission-backed external roots from synced `.pivi/settings.json` after successful local commit. Keep session-specific external-context selections in `pivi.external-contexts.v1`; do not mix them into permission records.

Migration must read legacy `bashAllowlist`, `externalReadDirectories`, and any already device-local roots before stripping old fields. It is idempotent and failure-safe: local commit succeeds before synced settings are rewritten. Preserve broad legacy grants as enabled structured equivalents; classify exact values under the fixed migration classifier version, deduplicate covered entries, and disable high-risk expansions. Emit no chat provenance. Tests must include the 15-entry live-vault shape without copying private paths/content into fixtures.

### WS-02 — One approval, one explicit result

Replace the current capability result contract with decisions `deny`, `allow-once`, `allow-always`, and lifecycle `cancel`. Remove user-visible and matching support for `allow-session`; eliminate the second Bash-persistence question and obsolete `full`/`prefix` encoding APIs after all consumers migrate.

The single prompt must show:

- tool and attempted command/path;
- for Bash, every recommended normalized component scope in execution order;
- for external access, the canonical directory root rather than the individual file;
- an inline scope selector only over classifier-produced candidates;
- an immediate warning when the selected scope is broader/high-risk;
- exactly three primary actions: Deny, Allow once, Always.

For unsafe Bash syntax, Always is disabled/unavailable with a localized explanation; Allow once executes the complete original request. For a safe compound request, Always persists all selected component rules as one settings transaction before execution. If persistence fails, do not execute under an Always result and do not retain a phantom in-memory grant.

Permanent writes must become visible to the current main Agent and existing subagents immediately through store revision/publication or an equivalent authoritative refresh. A private in-memory acceleration may cache the newly committed persistent rules, but it must not recreate a distinct session-duration authority and must invalidate on revoke, clear, Settings scope change, session switch, and plugin unload as appropriate.

Changing tabs/sessions, canceling a turn, or disposing the prompt resolves an outstanding request as cancel/deny and never persists. Keep owner-realm DOM, focus restoration, reduced-motion behavior, and localization requirements.

### WS-03 — Permissions visible in Settings

Keep one **Persistent permissions** section under Built-in tools. Capability toggles stay with their tool rows; records remain when a toggle is off.

The section groups Bash and external-directory permissions as stacked `SettingRow`s with values as badges inside `BadgeListInput` (Browse remains a trailing sibling for directories):

- semantic labels (`git status`, `grep`, canonical external root) rather than encoded storage strings;
- classified text addition for Bash with actionable validation feedback;
- existing browse/validation support for adding an external directory;
- revoke by removing a badge; re-adding a disabled identity re-enables it.

Do not display origin, last-used time, count, chat, or Skill. Reject raw `exact:` and `prefix:` syntax with localized guidance. Settings writes go through narrow React-owned ports and the app adapter; React does not read Obsidian storage or runtime ports.

### WS-04 — Empty sessions never become history

Add one authoritative read-only classification at the session-store boundary: valid durable JSONL has a persisted user message or it does not. Use the verified index/range machinery rather than ad hoc whole-file scans where practical. A malformed/stale/index-corrupt source follows existing rebuild/error behavior; if authoritative JSONL still cannot be validated, warn and retain it.

Lifecycle compensation belongs to the transaction that owns a newly created session file. If initialization, title setup, query setup, cancellation, tab close, or teardown leaves that owned file without a persisted user message, permanently discard only that file and clean its open-session registration, tab binding, device-local external-context overlay, index, and journal ownership through existing owner APIs. Never scan sibling files as compensation, and preserve the primary error if cleanup also fails.

Startup ordering:

1. Load settings/device-local stores and run session-journal/cloud recovery.
2. Discover durable sessions across all device directories, as current history discovery does.
3. Classify only successfully parsed files with no persisted user message.
4. Exclude files referenced by active/unresolved journal ownership or any non-archived/live binding available at that phase.
5. Require filesystem mtime to be at least one hour older than the cleanup scan time. Use mtime, not JSON timestamps, so a newly downloaded old cloud file receives a safety window.
6. Permanently discard eligible files idempotently through session ownership APIs and remove every corresponding persisted archived binding. Do not enqueue them in Deleted.
7. Load summaries and call durable-tab reconciliation only after cleanup.

A crash between physical deletion and tab-state cleanup must self-heal on the next restore: missing files are skipped and stale bindings removed rather than recreated. A state-write failure before physical deletion retains the session for retry. Record counts for diagnostics without adding telemetry or a user-facing startup notice unless a failure needs action.

Regression fixtures must cover header/meta only, UI-context only, tool/custom-only, user-without-assistant, corrupt JSONL, newly downloaded old-created file with fresh mtime, exactly-under/over-one-hour boundaries, journal-owned files, recovered empty files, duplicate tab bindings, cleanup failure, and repeated startup.

### WS-05 — Explicit archived and deleted lifecycle

Expose a narrow session-maintenance snapshot/action port to Settings:

```ts
interface SessionMaintenanceSnapshot {
  archivedCount: number; // unique durable sessionFile values
  deletedCount: number;  // unique valid recovery-queue records
}

interface DeleteArchivedResult {
  moved: number;
  skippedActive: number;
  failed: number;
}
```

Names may follow local conventions; counts and semantics are fixed. Unbound blank archived tabs are not chats and do not increment `archivedCount`. Duplicated bindings count once.

Bulk Archived → Deleted processing is per unique file and failure-isolated:

1. Snapshot persisted and every mounted view's tab bindings through semantic maintenance APIs.
2. Build unique archived files and a protected set from every non-archived binding.
3. Skip protected files and retain all their bindings.
4. For each eligible file, close/remove every archived binding across views, immediately persist the resulting tab state, then move the JSONL into `.pivi/trash/sessions/` and remove its open-session projection.
5. If the trash move fails after bindings close, leave the durable file in `.pivi/sessions/`; startup reconciliation may safely restore it. Never physically purge as part of this action.
6. Publish fresh counts and localized moved/skipped/failed feedback. One failure does not prevent independent files from being processed.

Keep individual tab Delete behavior recoverable and Archive behavior reversible. Keep retention auto-purge and explicit purge scoped only to Deleted. Rename copy from ambiguous “removed sessions” to “recently deleted chats” and state that open/archived chats are unaffected by permanent purge. Settings contains no deleted-session rows; include concise copy telling the user to ask Pivi to list/restore recently deleted chats with `pivi_sessions`.

Update all locales and Settings search aliases/metadata. Use existing settings primitives; add feature CSS only if primitives cannot express the layout without changing their shared contract.

## Verification

Planning acceptance:

```bash
npm run check:specs
npm run check:docs-contracts
git diff --check
```

Focused implementation suites (extend the owning files rather than creating overlapping test surfaces):

```bash
npm run test -- --runInBand \
  tests/unit/agent/capabilitySessionGrants.test.ts \
  tests/unit/obsidian-tools/bashAllowlist.test.ts \
  tests/unit/obsidian-tools/bashTool.test.ts \
  tests/unit/obsidian-tools/capabilityApprovalGate.test.ts

npm run test -- --runInBand \
  tests/unit/app/deviceLocalExternalContextStore.test.ts \
  tests/unit/app/ui/imperativeChatAdapter.test.ts \
  tests/jsdom/pivi-react/ToolsSettingsPage.test.tsx \
  tests/jsdom/pivi-react/SettingsUi.test.tsx

npm run test -- --runInBand \
  tests/unit/app/pluginSessionApi.test.ts \
  tests/unit/app/session/openSessionManager.test.ts \
  tests/unit/engine-pi/session/piSessionStore.test.ts \
  tests/unit/engine-pi/session/sessionTreeStore.test.ts \
  tests/unit/features/chat/sessionControllerLifecycle.test.ts \
  tests/unit/features/chat/tabManagerLifecycle.test.ts
```

Add/rename focused files if ownership changes make an existing filename misleading. Delete obsolete exact/prefix/session-grant assertions rather than retaining contradictory compatibility behavior.

Full local gates under the repository-supported Node 24 toolchain:

```bash
npm run check:dependencies
npm run typecheck
npm run lint
npm run check:boundaries
npm run test:coverage
npm run test:platform-security
npm run test:pi-compat
npm run build
npm run check:bundle-size
npm run check:specs
npm run check:docs-contracts
git diff --check
```

Real-host permission scenarios in a controlled/disposable context:

1. Trigger repeated `grep`/`ls` commands with different files and prove one Always grant prevents subsequent prompts.
2. Trigger `git status` then a different `git` command and prove the former grant does not authorize the latter; broaden inline and prove the warning plus executable-wide match.
3. Trigger `python3 -c`, `npx marp`, wrapper, absolute executable, unresolved relative executable, safe pipeline/`&&`, redirect, and substitution states.
4. Invoke a Skill that issues changing Bash arguments and prove it uses the same stored scopes without duplicate prompts.
5. Reload the plugin and prove grants survive on the same device/vault, do not appear in synced `.pivi/settings.json`, remain after tool disable/enable, and can be revoked from Settings immediately.

Real-host session scenarios must use disposable fixture files/sessions, not manually delete the user's existing 18 records during development:

1. Create an owned metadata-only session, exercise lifecycle compensation, and verify JSONL/index/overlay/tab absence.
2. Seed old-mtime and fresh-mtime empty fixtures plus valid user-only/corrupt/journal-owned controls; reload twice and verify only eligible fixtures disappear and reconciliation creates no archived ghosts.
3. Seed duplicate archived bindings and one simultaneous open binding; bulk-delete and verify unique counts, global archived removal, active skip, Deleted queue contents, and `pivi_sessions` restore.
4. Permanently purge Deleted fixtures and verify they are no longer restorable. Never claim snapshot recovery after this point.

Rendered UI verification:

- Capture and inspect the approval prompt for simple Bash, compound Bash, unsafe Always-disabled, scope widening warning, and external-directory states.
- Capture and inspect Built-in tools with normal, high-risk-disabled migration, validation-error, and empty permission lists in light and dark themes.
- Capture and inspect Session files with nonzero Archived/Deleted counts, pending confirmation/action, partial-result feedback, and zero states in light and dark themes.
- Run keyboard/focus/ARIA checks for selectors, three approval actions, revoke/clear confirmation, and Settings result announcements.
- **Human visual sign-off required:** approval prompt and both Settings pages in light/dark themes, including warning/error/disabled states. Only a human who viewed the rendered surfaces may check this item.

Final evidence must record candidate commit/worktree state, exact commands, test counts, production artifact size/digest, migration fixture results, inspected screenshot links, live Obsidian/Pivi versions, and cleanup outcome. No production-vault destructive migration is needed to accept the code; observe it only after the user chooses to install/reload the completed candidate.

## Documentation sync

- Numbered developer docs: update `docs/05-tabs-sessions-and-history.md` for empty-session, Archive/Delete/recovery, startup cleanup, and Settings maintenance semantics; update `docs/07-tools-skills-mcp-and-integrations.md` for capability classification, Skills parity, persistent permissions, and external-root behavior.
- Nearest local guidance: update `src/ui/chat/AGENTS.md` for the removal of session grants and empty-session ownership; update `src/app/AGENTS.md` for the device-local permission store/startup cleanup/session maintenance ports.
- Parent/package guidance: update `packages/agent/AGENTS.md`, `packages/obsidian-tools/AGENTS.md`, `packages/obsidian-host/AGENTS.md`, and `packages/pivi-react/AGENTS.md` where implemented contracts invalidate current exact-prefix, four-option, storage, or Settings descriptions.
- Root guidance and roadmap: update `AGENTS.md` only if an enforceable repository-wide boundary changes; update `docs/10-roadmap-release-and-maintenance.md` to point at this active work and move it to completed history at closeout. No README/CHANGELOG/version change unless implementation produces user-facing release notes in a separately authorized release task.
- Locale contract: mirror every new/changed key from `packages/pivi-react/src/i18n/locales/en.json` into all locale files and run the i18n boundary checks.

### Experiment refs

None. Add final experiment refs only if implementation deliberately uses isolated experimental branches/worktrees.

## Progress and handoff

Append entries rather than rewriting another worker's record. Do not mark a workstream Done without its listed evidence and documentation impact.

### 2026-09-05 — Amp — Investigation and decision closure

- Changed: inspected permission contracts, shell matching, capability UI, Settings persistence, actual vault allowlist/history, durable tab/session state, JSONL contents, rendered tab labels, reconciliation, Delete queue, and permanent purge path. Completed multi-round grill for both issues and reserved spec 051.
- Evidence: the live vault had 21 archived bindings, 18 without any durable message, zero queued Deleted records, and rendered timestamp/Recovered labels. A deterministic read-only script asserted `emptyArchived > 0` and `emptyQueuedForDeletion === 0`. Permission inspection found 15 stored entries including two redundant filename-bearing exact rules. No source or vault data was mutated by the investigation.
- Remaining: all five implementation workstreams, focused/full/live verification, visual inspection and human sign-off, durable docs sync, completion summary, and archival.
- Blockers: none in product policy. Implementation must avoid destructive cleanup of the user's real vault until a completed candidate is intentionally installed/reloaded.
- Next action: claim WS-01, freeze the structured schema and classifier fixture matrix in tests, then implement device-local migration before changing approval or Settings consumers.

### 2026-09-05 — Amp — Planning validation

- Changed: expanded spec 051 to a detailed, decision-complete Active execution contract, indexed it, and linked its outcome from the roadmap's Now section.
- Evidence: `npm run check:specs`, `npm run check:docs-contracts`, and `git diff --check` passed. Placeholder scan found no remaining template prompts. No product code, user settings, session files, or vault content changed.
- Remaining: implementation and acceptance evidence for WS-01 through WS-05.
- Blockers: none.
- Next action: assign/claim WS-01 before editing its contracts or tests.

### 2026-09-05 — Cursor — Implementation candidate

- Changed: shipped structured device-local permissions (`pivi.capability-permissions.v1`), the host-neutral Bash classifier, one-step Deny / Allow once / Always approval, Persistent permissions Settings, empty-session compensation/startup cleanup, unique Archived/Deleted inventory, and locale/docs sync. Session grants, encoded `exact:`/`prefix:` persistence, and the two-step Always flow are gone. Production plugin reloaded after `npm run build`.
- Evidence: focused permission/session suites green; `typecheck` and `lint` clean; `check:dependencies` / `check:boundaries` (including specs, docs contracts, i18n dead keys, Pi pins) green; `test:coverage` 359 suites / 3217 tests; `test:platform-security` and `test:pi-compat` green; `main.js` 4,188,789 bytes (3.99 MB). The live vault's existing empty archived chats were not deleted during development.
- Remaining: live Obsidian scenarios with disposable fixtures; capture/inspect the approval prompt and both Settings pages in light/dark including warning/error/disabled; **human visual sign-off**. Do not archive until that sign-off lands.
- Blockers: none in product code. Closeout is blocked on a human who viewed the rendered surfaces.
- Next action: run the spec's real-host permission and session scenarios, then record visual sign-off and archive.

## Completion summary

Not complete. Before archival, summarize delivered behavior, every scope deviation, migration outcome, test/live/visual evidence, human visual sign-off, and durable documentation updates. Then set `status: Completed`, update the date, and use `spec_archive` to move this unchanged filename and its index row atomically.
