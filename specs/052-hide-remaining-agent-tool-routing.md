---
id: "052"
title: "Hide remaining agent tool routing"
status: Active
created: 2026-09-05
updated: 2026-09-05
coordinator: "Amp"
---

# 052 — Hide remaining agent tool routing

## Context

[Thread T-01a071d1](https://ampcode.com/threads/T-01a071d1-d654-702c-825f-13f2a0efeeac) proposed one agent-facing read and one list, with vault-index vs filesystem routing inside the tool. A 2026-09-05 inventory then found no other `*_external` twins. The remaining leaks of the same class were `file` vs `path` retry, `obsidian_search` used as folder listing, and prompt/skill copy that taught sibling-tool routing.

A grill on 2026-09-05 then folded Pi / Claude / Amp / Copilot tool-shape research into the same spec: Pivi already presents generic coding-agent names (`Read`, `Write`, `Edit`, `Bash`, `LS`, `Grep`, `Glob`) in [`packages/agent/src/tools/toolNames.ts`](../packages/agent/src/tools/toolNames.ts), while the live Obsidian tools are still `obsidian_read` / `obsidian_list` / `obsidian_search` / …. Pi 0.84.4’s native coding tools are lowercase `read` / `write` / `edit` / `bash`, with optional `ls` / `grep` / `find`. This spec owns both the internal routing merge and the live-name / alias contract.

Current evidence:

- Only storage twins: `obsidian_read_external`, `obsidian_list_external` ([`obsidianToolNames.ts`](../packages/agent/src/tools/obsidianToolNames.ts), [`createObsidianTools.ts`](../packages/obsidian-tools/src/createObsidianTools.ts)).
- Mutations stay vault-relative: File Recovery and `requireAgentVaultMutationPath`.
- Semantic tools (`obsidian_links`, `obsidian_properties`, `obsidian_history`, `obsidian_tasks`, `obsidian_graph`, `obsidian_tags`, `obsidian_base`, `obsidian_daily`) are not filesystem twins.
- CLI fallback on `obsidian_search` / `obsidian_links` / `obsidian_note_info` is already internal.
- MCP is one proxy tool `mcp`, not flattened per-server tools.

## Goal and success criteria

The model sees one tool per job with Pi-family live names and Pi-like fields. Vault vs disk vs absolute path, wikilink vs vault path, and search vs list are resolved inside the tool. Aliases still run. Prompt and the registered tool list never advertise aliases. A successful alias call reminds the model of the live name or canonical field. No current capability is dropped.

- [x] Live registered names for the generic family are exactly `read`, `write`, `edit`, `ls`, `search`, `bash`, `mkdir`, `move`, `delete`. Verified by `createObsidianTools` / tool-name constants and the prompt tool list.
- [x] Silent aliases are accepted and never listed in prompt, ToolSpec `promptUsage`, or skill copy: PascalCase `Read` `Write` `Edit` `Bash` `LS` `Search` `Mkdir` `Move` `Delete`; legacy `obsidian_*` including `obsidian_read_external` → `read` and `obsidian_list_external` → `ls`; `list_dir` → `ls`. There is no `grep` / `Grep` alias.
- [x] A successful call that used an alias tool name or alias field appends a short reminder of the live name / canonical field. The call still succeeds. JSONL and presentation persist the live name.
- [x] `read` routes internally: vault-relative indexed → Vault API; vault-relative unindexed (e.g. `.pivi`) → ExternalFileApi; absolute path → ExternalFileApi with existing external-read authorization. `ls` does the same for directories. Top-level `*_external` tools are gone.
- [x] Canonical path field is `path`. Silent aliases: `file_path`, `target_file`. Optional `file` remains wikilink-only. Miss of one form tries the other before erroring. Prompt never says “retry with `path` vs `file`”.
- [x] `read` paging: 1-indexed `offset` + `limit` (line count). Silent aliases: `startLine` → `offset`, `endLine` → converted to `limit`. Extra fields kept: `startChar`, `maxChars`, `mode: stats`. Line-page truncation returns `nextOffset`. Oversized-line pages return `nextStartLine` + `nextStartChar`.
- [x] `ls` does not overload `read`. It keeps 0-based entry `offset`, `limit`, name `query`, and result `nextOffset`. Prompt usage states this is an entry offset, not a line number. A Pi-shaped `{ path, limit }` call still works (`offset` defaults 0).
- [x] `search` is case-insensitive literal substring plus `tag:name`. Canonical field `query`; silent alias `pattern`. Not regex. Not Obsidian in-app search. `query="*"`, empty, `**`, and `path:`-only listing modes error toward `ls`.
- [x] `edit` canonical form is `edits: [{ oldText, newText, replaceAll? }]`. Accept Pi string/object/array `edits`. Top-level `{ old_string, new_string, replace_all }` expands to one item. No snake_case keys inside items. Unique match remains the default.
- [x] `write` is `path` + `content` with optional `mode` defaulting to `overwrite`. `append` / `prepend` / `create` remain. `create` still needs `overwrite: true` to clobber.
- [x] `bash` is `command` with silent alias `cmd`. Optional vault-constrained `cwd`. No `timeout` field. Internal timeout/output caps unchanged. Still lowest-priority; never a vault file tool.
- [x] Semantic / CLI / workspace tools keep the `obsidian_` prefix. MCP stays the `mcp` proxy. Duplicate live names fail registration.
- [x] `disabledTools` migrates once (`obsidian_read` → `read`, …). Disablement and presentation treat every alias as the same logical tool. Old JSONL that already stored `obsidian_read` still renders.
- [x] Skills tell the agent to `read` / `ls` the returned paths. No `*_external` instruction.
- [x] Targeted tests cover routing, identifier fallback, search listing rejection, alias acceptance, alias reminders, prompt/skill string absence, and disabledTools migration. `npm run check:specs` passes before closeout.

## Scope and non-goals

In scope:

- Unified internal routing for `read` / `ls` (the source-thread plan).
- Live names, silent aliases, alias reminders, persistence of live names, and `disabledTools` migration for the generic family.
- Shared identifier resolution (`path` then wikilink fallback) for every tool that currently takes `file` and `path`, including semantic tools that keep the `obsidian_` prefix.
- Removing folder-listing from `search` / `searchNotes`.
- Canonical field shapes (`offset`/`limit`, `edits[]`, write `mode` default, bash `cmd` alias) without dropping extras.
- Prompt, ToolSpec, skill-text, package `AGENTS.md`, and tests.

Not in scope:

- `grep` / `Grep` as a name or as regex search.
- New `find` / `Glob` tool.
- Overloading `read` on directories.
- Filesystem mutation tools outside the vault (`write_external`, etc.).
- Merging semantic tools into generic file tools.
- Collapsing `mode: stats` into `obsidian_note_info`, or `tag:` search into `obsidian_tags`.
- Flattening MCP into top-level tools.
- Changing eval, command, WebSearch/WebFetch, or `pivi_*` management tools beyond name references in prompt copy.
- Exposing bash `timeout`.
- Implementing Obsidian in-app search syntax.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-09-05 | No other `*_external` pair exists; do not invent write/edit/search external twins. | Inventory of `obsidianToolNames.ts` and `createObsidianTools.ts`. Mutations need File Recovery and vault containment. | WS-01 |
| 2026-09-05 | 052 owns unified `read`/`ls` routing and the familiar-name cutover together. | Unification and aliases interact: `obsidian_read_external` can only alias `read` after routing is internal. | WS-01, WS-05 |
| 2026-09-05 | Live names are Pi lowercase: `read` `write` `edit` `ls` `search` `bash` `mkdir` `move` `delete`. | Pi 0.84.4 native family; models already know this shape. Presentation already has PascalCase constants for coding-agent tools. | WS-05 |
| 2026-09-05 | Semantic / CLI / workspace tools keep `obsidian_`. | Models have no trained `links` / `history` name. Prefix still marks host-specific tools. | WS-05 |
| 2026-09-05 | Silent aliases: PascalCase of the live set including `Search`; legacy `obsidian_*`; `obsidian_read_external`→`read`; `obsidian_list_external`→`ls`; `list_dir`→`ls`. No `grep`/`Grep`. | Claude-family muscle memory without implying regex. Old sessions and skills keep working. | WS-05 |
| 2026-09-05 | Prompt and tool list show live names only. Aliases are not advertised. | Listing three names for one job reintroduces the routing leak. | WS-04, WS-05 |
| 2026-09-05 | A successful alias (tool name or field) still runs, then reminds the model of the live name / canonical field. | User requirement 2026-09-05: aliases work, but the model is told which form is canonical. Failure paths do not need a second reminder beyond the existing error. | WS-05 |
| 2026-09-05 | Persist the live name in JSONL and Settings. Aliases share presentation and disablement. Migrate `disabledTools` once. Old JSONL that stored `obsidian_read` still renders via the alias map. | One logical tool. Disable-by-exact-string would hide only one spelling. | WS-05 |
| 2026-09-05 | Unprefixed live names now. Keep the `mcp` proxy. Duplicate live names fail registration. | MCP is not flattened today. Putting the prefix back would undo the familiarity goal. | WS-05 |
| 2026-09-05 | Canonical path field `path`; silent aliases `file_path` and `target_file`; optional `file` is wikilink-only. When both `path` and `file` are passed, `path` wins then fallback. If only one string is passed, try that form then the other when plausible. Never prompt-retry. | Wikilink vs vault path is a real identifier difference. Retry-as-control-flow is the leak. | WS-02 |
| 2026-09-05 | `read` paging is Pi 1-indexed `offset` + `limit`. Keep `startChar` / `maxChars` / `mode: stats`. `startLine`/`endLine` are silent aliases. Line truncation returns `nextOffset`. Oversized-line pages return `nextStartLine`+`nextStartChar`. | Pi/Claude line paging plus Pivi’s Unicode oversized-line contract. Do not make the model convert `nextStartLine` into `offset`. | WS-01 |
| 2026-09-05 | Separate `ls`. Do not overload `read` on directories. Keep 0-based entry `offset` / `limit` / `query` / `nextOffset`. Prompt must say this is not a line offset. | Amp/Copilot overload would put routing back in the model. Large-folder paging must stay. | WS-01 |
| 2026-09-05 | Live name `search`, not `grep`. Canonical `query`; silent `pattern` alias. Case-insensitive literal substring + `tag:`. Not regex. Not Obsidian in-app syntax. Listing modes rejected toward `ls`. | `grep` would imply regex. Current Pivi search is already not in-app syntax. Duplicate listing is the same leak as two read tools. | WS-03 |
| 2026-09-05 | No `find` / `Glob` in this spec. | New capability, not preservation. Listing is `ls`; content/tag is `search`. | WS-03 |
| 2026-09-05 | `edit` is `edits: [{ oldText, newText, replaceAll? }]`. Normalize string/object/array like Pi. Top-level `{ old_string, new_string, replace_all }` → one item. No snake_case inside items. Unique match default. | Pi shape for familiarity; `replaceAll` keeps today’s replace-every without requiring N copies of a hunk. | WS-06 |
| 2026-09-05 | `write`: `path`+`content`, optional `mode` default `overwrite`, keep `append`/`prepend`/`create`, `create` still needs `overwrite: true` to clobber. | Pi-shaped calls work; append/prepend/safe-create are not dropped. | WS-06 |
| 2026-09-05 | `bash`: `command` with silent `cmd` alias; vault `cwd`; no `timeout` field. | Amp `cmd` muscle memory without changing the 30s internal cap. | WS-06 |
| 2026-09-05 | promptUsage teaches extra Pivi fields (stats, startChar/maxChars, write modes, ls query, `file` when you have a title and no path). Never mentions aliases. | Extras are undiscoverable if they live only in JSON schema. Aliases in prompt recreate three-name routing. | WS-04 |
| 2026-09-05 | CLI remains an internal fallback. Prompt may still say a CLI-only action is unavailable this turn. | Already hidden. Availability is not routing. | WS-04 |

## Alias reminder

When a call succeeds after resolving an alias tool name or alias field, append one short reminder to the tool result. Do not fail the call. Do not advertise aliases in prompt.

Examples:

- Tool name `obsidian_read` or `Read` → remind that the live name is `read`.
- Field `file_path` or `target_file` → remind that the canonical field is `path`.
- Field `cmd` → remind that the canonical field is `command`.
- Field `pattern` on `search` → remind that the canonical field is `query`.
- Top-level `old_string` / `new_string` → remind that the canonical form is `edits: [{ oldText, newText }]`.

One reminder per call is enough even if several aliases were used: name first if the tool name was aliased, otherwise the first aliased field. Do not nag on subsequent calls in the same turn beyond that one result line. Errors already name the canonical field when validation fails; do not add a second reminder there.

## Live names and aliases

| Live name | Silent name aliases | Canonical fields | Silent field aliases | Kept extras |
|---|---|---|---|---|
| `read` | `Read`, `obsidian_read`, `obsidian_read_external` | `path`, `offset`, `limit` | `file_path`, `target_file`, `startLine`, `endLine` | `file`, `startChar`, `maxChars`, `mode` |
| `ls` | `LS`, `obsidian_list`, `obsidian_list_external`, `list_dir` | `path`, `offset`, `limit` | `file_path`, `target_file` | `query` |
| `search` | `Search`, `obsidian_search` | `query` | `pattern` | `path`, `limit`, `context` |
| `write` | `Write`, `obsidian_write` | `path`, `content` | `file_path`, `target_file` | `file`, `mode`, `overwrite` |
| `edit` | `Edit`, `obsidian_edit` | `path`, `edits[]` | `file_path`, `target_file`; top-level `old_string`/`new_string`/`replace_all` | `file`; item `replaceAll` |
| `bash` | `Bash`, `obsidian_bash` | `command` | `cmd` | `cwd` |
| `mkdir` | `Mkdir`, `obsidian_mkdir` | `path` | `file_path`, `target_file` | — |
| `move` | `Move`, `obsidian_move` | `path`, `newPath` | `file_path`, `target_file` | — |
| `delete` | `Delete`, `obsidian_delete` | `path` | `file_path`, `target_file` | `file` |

`offset` on `read` is a 1-indexed start line. `offset` on `ls` is a 0-based entry index. Do not share a helper that treats them as the same number.

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done`.

| ID | Deliverable | Owner | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Unified `read` / `ls` internal routing; remove top-level `*_external` tools; keep ExternalFileApi + authorization. | Amp | Done | None | Unindexed `.pivi` file/folder works through `read`/`ls`. Absolute external paths still require `allowExternalRead` / sidebar grant. No `obsidian_read_external` in the registry. |
| WS-02 | Shared identifier resolution: `path` then wikilink fallback; host errors no longer ask to retry the sibling field. | Amp | Done | None | Path hit, wikilink hit, path miss then wikilink hit, both miss, both passed (`path` wins then fallback). Prompt tests: no “retry with the other parameter”. |
| WS-03 | Remove listing modes from `search` / `searchNotes`; schema and promptUsage point listing at `ls`. | Amp | Done | WS-05 live name `ls` or temporary copy using `obsidian_list` until rename lands in the same change | `query="*"`, `**`, empty, and `path:`-only queries error toward `ls`. Substring and `tag:` still work. |
| WS-04 | Prompt, ToolSpec, and skill copy: live names only, extras taught, no aliases, no sibling-tool retry, no search-as-listing. | Amp | Done | WS-01, WS-05 | Ripgrep: no `obsidian_read_external` retry, no `file` vs `path` retry, no advertised `Read`/`file_path`/`cmd`. Skills say `read` / `ls`. |
| WS-05 | Live names, silent aliases, alias reminders, JSONL live-name persistence, presentation/disablement identity, `disabledTools` migration, duplicate-name registration failure. | Amp | Done | WS-01 for `*_external` aliases | Alias call succeeds, result contains the reminder, stored tool name is live. Migrated disable hides every alias. PascalCase and `list_dir` work. `grep` is not registered. |
| WS-06 | Field-shape cutover: `read` offset/limit + extras; `edit` `edits[]` + `replaceAll`; `write` optional mode; `bash` `cmd` alias; `search` `pattern` alias. | Amp | Done | WS-05 | Pi-shaped `{ path, offset, limit }` read works. Top-level `old_string` edits. Missing write `mode` overwrites. `cmd` bash works and reminds. |

## Verification

- Routing: unindexed `.pivi` file and folder through `read`/`ls`; absolute path authorization deny/once/always unchanged; vault-relative indexed notes still use Vault API.
- Identifier fallback: `resolveFile` / shared helper tests for wikilink-only, path-only, fallback, both-provided, true miss.
- Search listing: `*` / `path:folder` / empty listing rejected toward `ls`; `tag:` and substring still hit.
- Names: registry live names; aliases execute; `grep` absent; duplicate live name fails registration.
- Reminders: alias tool name and alias field each produce one reminder; canonical calls have none.
- Persistence: new JSONL stores `read` not `obsidian_read`; old `obsidian_read` rows still present; `disabledTools` migration.
- Paging: `read.offset` 1-indexed vs `ls.offset` 0-based; line `nextOffset`; oversized-line `nextStartLine`+`nextStartChar`.
- Prompt/skill: `buildRegisteredToolsSection` and skill expansion fixtures contain live names and extras, never aliases or retry-routing.
- `spec_check` before closeout.
- No rendered CSS change; no human visual sign-off item.

## Documentation sync

- Durable product/developer docs: numbered handbook only if a page currently documents `obsidian_read` / `obsidian_read_external` / search `query=*`. Prefer package `AGENTS.md`.
- Nearest local `AGENTS.md`: [`packages/obsidian-tools/AGENTS.md`](../packages/obsidian-tools/AGENTS.md) (unified routing, live names, alias reminder, search listing, identifier resolution).
- Parent/package guidance: [`packages/agent/AGENTS.md`](../packages/agent/AGENTS.md) (registered-tools live names, skills use `read`/`ls`, alias map / disablement identity).
- Root guidance: [`AGENTS.md`](../AGENTS.md) vault-skills bullet currently says read supporting files with `obsidian_read_external`; change to `read` / `ls`. External-read bullet currently names `obsidian_read_external` / `obsidian_list_external`; describe internal routing instead.

## Progress and handoff

### 2026-09-05 — Amp — spec authored

- Changed: Created Active spec 052 from the read/list follow-up inventory.
- Evidence: Only `obsidian_read_external` / `obsidian_list_external` are storage twins.

### 2026-09-05 — Amp — grill confirmed; aliases remind

- Changed: Folded Pi-family live names, silent aliases, unified routing, and alias reminders into 052. User confirmed aliases work, are omitted from prompts, and a successful alias call reminds the canonical name/field.
- Remaining: Implementation WS-01 through WS-06.
- Blockers: None.
- Next action: Start WS-01 unified `read`/`ls` routing, or wait for an explicit “implement 052” if this turn is spec-only.

### 2026-09-05 — Amp — implementation complete, uncommitted

- Changed: Live names `read`/`write`/`edit`/`ls`/`search`/`bash`/`mkdir`/`move`/`delete`; silent aliases + one SUCCESS reminder; internal `read`/`ls` routing; `search` listing rejected toward `ls`; `edits[]` + write `mode` default overwrite; prompts, README, docs, package AGENTS.md updated. Focused Jest 523 passed.
- Remaining: Archive after user review. Do not commit unless asked.
- Blockers: None.
- Next action: `npm run check:specs`, then user review.

## Completion summary

Generic file tools now register as Pi-lowercase live names. Vault vs disk vs absolute path, wikilink vs path, and search vs list are resolved inside the tool. Silent aliases still run and remind once. Prompt, README, and package docs teach live names only. Old JSONL `obsidian_*` rows still render. Uncommitted.
