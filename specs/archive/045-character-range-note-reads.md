---
id: "045"
title: "Character-range note reads"
status: Completed
created: 2026-09-01
updated: 2026-09-01
coordinator: "Amp"
---

# 045 — Character-range note reads

## Context

`obsidian_read` currently supports whole-content reads, stats-only reads, and inclusive 1-based `startLine` / `endLine` ranges. `maxChars` is a response budget, not a source offset. Line-range pagination returns the largest sequence of complete physical lines that fits that budget and reports `nextStartLine`; when the first selected physical line alone cannot fit, `paginateLineRange()` throws and asks the Agent to raise `maxChars` enough to read the whole line.

That failure mode is unsuitable for imported transcripts or generated Markdown containing tens of thousands of characters on one physical line. The Agent needs bounded sequential access to the source without loading the whole line. The proposed extension keeps the existing read API and adds one source coordinate, `startChar`; `maxChars` continues to determine the bounded page size. No `endChar` is needed.

Current repository evidence:

- `packages/obsidian-tools/src/obsidian/readNote.ts` owns the ToolSpec, read modes, range selection, read-budget reservation, and result details.
- `packages/obsidian-tools/src/obsidian/readShared.ts` owns positive-integer validation, UTF-16 string spans, complete-line pagination, continuation text, and the current oversized-first-line error.
- `ToolResult.details` is retained for persistence and UI, but only textual result content is returned to the model; character continuation instructions must therefore appear in the text as well as structured details.
- Existing character counts and `maxChars` use JavaScript string length, so their coordinate unit is UTF-16 code units rather than grapheme clusters or Unicode code points.

## Goal and success criteria

Allow an Agent to read a note sequentially from a 1-based `startChar`, returning the largest safe source slice whose content plus continuation marker fits the effective `maxChars`, instead of requiring an oversized physical line to fit in one response.

- [x] `obsidian_read` accepts optional positive integer `startChar`; no `endChar` parameter is introduced.
- [x] `startChar` is 1-based and uses the same UTF-16 code-unit coordinate system as the existing `Characters` count and JavaScript `string.length`-based `maxChars` accounting.
- [x] An explicit `startChar` content read begins at that source position and may cross physical-line boundaries.
- [x] A standalone `startChar` is file-global; with `startLine`, `startChar` is relative to that physical line and optional `endLine` bounds the read. `startChar + endLine` without `startLine` fails before Vault access as ambiguous.
- [x] `startChar` is invalid with `mode: "stats"`; stats remains whole-file metadata and tells the Agent which `Characters` value bounds later character reads.
- [x] A character page returns at most the effective `maxChars` in total model-visible text, including a continuation marker when more source remains.
- [x] A truncated global page includes exact character continuation. A truncated line-relative page includes `nextStartLine` + `nextStartChar` in structured details and text, and tells the Agent to continue with that exact pair and the same `maxChars`.
- [x] A final page omits the continuation marker and `nextStartChar`; `startChar` beyond the end returns empty content with a non-truncated empty-range result rather than throwing.
- [x] Slice boundaries never split a UTF-16 surrogate pair or the `\r\n` sequence; an explicitly supplied `startChar` inside either sequence fails with the next valid position in the error.
- [x] Existing whole-file, stats, and complete-line pagination behavior remains unchanged when no oversized selected line is encountered and `startChar` is absent.
- [x] When an explicit line range's first selected physical line cannot fit, it falls back to a bounded character page beginning at that line's first character instead of throwing; continuation switches to exact line-relative `nextStartLine` + `nextStartChar` coordinates.
- [x] Explicit character reads bypass the large-file stats-only fallback, while an un-ranged large content read continues to return stats rather than silently returning the first page.
- [x] Existing turn-level read allowance, 1,000-character minimum effective budget, default cap, settlement, and output-reserve behavior apply unchanged.
- [x] ToolSpec-owned, registered, and static Prompt guidance teaches stats → line range → line-relative `startLine + startChar` → exact `nextStartLine + nextStartChar` continuation for oversized physical lines.
- [x] Tests cover a 50,000+ character single line, normal multi-line crossing, EOF, invalid combinations, budget clamping, CJK, emoji/surrogate boundaries, CRLF boundaries, and compatibility with existing line pagination.

## Scope and non-goals

In scope:

- `obsidian_read` schema, ToolSpec usage guidance, execution routing, result text, and structured details.
- Pure character-page helpers colocated with existing read pagination helpers.
- Automatic character fallback for an oversized first line in an explicit line range.
- Static and registered Agent guidance for bounded sequential reads.
- Focused unit tests and durable read-tool documentation.

Not in scope:

- Adding `endChar`, negative offsets, suffix reads, or random byte ranges.
- Changing `Characters` from UTF-16 code units to Unicode code points or grapheme clusters.
- Splitting, editing, or reformatting the note during reads.
- Automatically choosing semantic paragraph boundaries.
- Changing `obsidian_read_external`; parity may be specified separately after the Vault behavior is proven.
- Returning a prefix for an un-ranged large content read; stats-first remains the safe default.
- Changing provider context limits, compaction thresholds, or read-allowance calculation.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-09-01 | Add only `startChar`; use existing `maxChars` as the sequential page budget. | This matches the requested workflow, avoids redundant/conflicting `endChar`, and gives a stable continuation cursor through `nextStartChar`. | WS-01, WS-02 |
| 2026-09-01 | Make character positions 1-based UTF-16 code-unit positions. | It aligns with existing 1-based line coordinates, JavaScript slicing, the reported `Characters` count, and current budget accounting without redefining existing metadata. | WS-01 |
| 2026-09-01 | Count the textual continuation marker inside `maxChars`. | Only tool-result text reaches the model; the continuation instruction cannot live only in structured details, and the existing line pager already treats the complete model-visible result as the hard cap. | WS-01 |
| 2026-09-01 | Reject starts inside surrogate pairs or CRLF and shorten page ends to the previous safe boundary. | A bounded read must not emit malformed Unicode or split one logical line-ending sequence. Rejecting ambiguous caller offsets keeps continuation deterministic. | WS-01 |
| 2026-09-01 | Give `startChar` contextual coordinates: file-global alone, line-relative with `startLine`. | This lets Agents address a known oversized line directly without computing a file-global offset. Returning exact `nextStartLine` + `nextStartChar` removes continuation ambiguity; `endLine` remains a natural range bound. | WS-01, WS-02 |
| 2026-09-01 | Preserve stats-first behavior for un-ranged large reads. | Character pagination should be deliberate; silently returning a prefix would change an established context-safety contract. | WS-02 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Implement pure safe character pagination and oversized-line fallback | Amp | Done | Design confirmed | 11 focused character-pagination tests plus existing line-range hardening suite passed |
| WS-02 | Extend `obsidian_read` schema/execution/results and Agent guidance | Amp | Done | WS-01 contract | Tool and Prompt suites passed; full suite passed |
| WS-03 | Synchronize docs/guidance and run repository/live-host verification | Amp | Done | WS-01, WS-02 | Typecheck, lint, boundaries, build, reload, and live error check passed |

## Verification

Required behavioral fixtures:

- `startChar: 1` on a 50,000+ character single line returns a bounded first page and a valid `nextStartChar`; repeated continuation reconstructs the original content exactly once.
- Starting in the middle of a normal line with `startLine + startChar`, crossing LF/CRLF boundaries, and following returned line/character pairs respects `maxChars` and reconstructs the bounded range exactly once.
- CJK positions remain one UTF-16 code unit each; an emoji remains intact even when the nominal budget boundary lands between its surrogate halves.
- A caller-supplied low-surrogate or between-CR/LF `startChar` fails without Vault mutation and names the next valid character position.
- A page too small to hold any safe source unit plus its required continuation marker returns an actionable minimum-budget error rather than looping.
- Existing line-range fixtures keep complete-line output and `nextStartLine`; only an oversized first selected line switches to character continuation.
- Explicit `startChar`, no range, and an oversized file returns content rather than stats; no `startChar` and no line range retains stats-only fallback.
- Read-budget reservation is settled against the complete returned text, including the continuation marker.

Commands:

```bash
npm run test -- --runInBand tests/unit/obsidian-tools/management/obsidianInputHardening.test.ts
npm run test -- --runInBand tests/unit/agent/prompt
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

## Documentation sync

- Numbered developer docs: update `docs/07-tools-skills-mcp-and-integrations.md` with character coordinates, continuation, and oversized-line fallback.
- Nearest local guidance: update `packages/obsidian-tools/AGENTS.md` for `obsidian_read` character pagination ownership.
- Parent/package guidance: update `packages/agent/AGENTS.md` only if static/registered Prompt ownership wording needs a durable character-read rule.
- Root guidance and roadmap: None; the behavior remains inside the existing read-tool boundary and does not alter roadmap scope.

## Progress and handoff

### 2026-09-01 — Amp — specification draft

- Changed: Verified current complete-line pagination, model-visible continuation requirements, and UTF-16 accounting; drafted the `startChar + maxChars` sequential-read contract.
- Evidence: `packages/obsidian-tools/src/obsidian/readNote.ts`, `packages/obsidian-tools/src/obsidian/readShared.ts`, `packages/engine-pi/src/tools/piToolAdapter.ts`, and existing read hardening tests.
- Remaining: Confirm the decisions, especially 1-based UTF-16 coordinates, how line and character coordinates interact, and continuation-marker budget accounting; then set the spec Active before implementation.
- Blockers: Design confirmation only.
- Next action: Review the Decisions table and success criteria with the user.

### 2026-09-01 — Amp — design confirmed

- Changed: Set the spec Active and claimed all implementation, Prompt, documentation, and verification workstreams after user confirmation.
- Evidence: User confirmed the 1-based `startChar + maxChars` design in the owning thread.
- Remaining: Implement and verify WS-01 through WS-03.
- Blockers: None.
- Next action: Add safe character pagination to `readShared.ts` and route Vault note reads through it.

### 2026-09-01 — Amp — completed

- Changed: Added 1-based UTF-16 `startChar` pagination to `obsidian_read`, exact `nextStartChar` continuation in text/details, safe surrogate/CRLF boundaries, automatic oversized-line fallback, and aligned ToolSpec/static/registered Prompt guidance.
- Evidence: Focused coverage passed 4 suites / 81 tests, including 11 dedicated character-pagination tests; full coverage passed 338 suites / 2,984 tests. Typecheck, lint, architecture/boundary checks, i18n dead-key scan, spec validation, production build, bundle-size gate, and `git diff --check` passed. The built bundle contains the new schema/guidance, the production plugin reloaded successfully, and `obsidian dev:errors` reported no errors.
- Remaining: None within this spec; `obsidian_read_external` character parity remains the documented non-goal.
- Blockers: None.
- Next action: None; this completed spec is archived.

### 2026-09-01 — Amp — line-relative follow-up

- Changed: Allowed `startLine + startChar`, defined `startChar` as line-relative in that form, preserved standalone file-global character reads, bounded combined reads by optional `endLine`, and changed continuation to exact `nextStartLine + nextStartChar` pairs.
- Evidence: Added focused tests for direct line-relative starts, bounded final pages, multi-page cross-line reconstruction, invalid ambiguous input, invalid offsets, automatic oversized-line fallback, ToolSpec text, and static/registered Prompt guidance. Full verification passed 338 suites / 2,987 tests plus typecheck, lint, architecture/boundary checks, spec validation, and `git diff --check`. The production build and bundle-size gate passed at 4,119,211 bytes with 1,123,669 bytes headroom; the built bundle contains the new schema/Prompt strings, the production plugin reloaded successfully, and `obsidian dev:errors` reported no errors.
- Remaining: None within this follow-up.
- Blockers: None.
- Next action: None; the completed follow-up remains archived with the owning spec.

## Completion summary

`obsidian_read` can now page through tens-of-thousands-character physical lines without raising `maxChars` or failing. Agents address a known line with line-relative `startLine + startChar`, follow the exact returned `nextStartLine + nextStartChar` pair, and may retain `endLine` as a range bound. Standalone `startChar` remains file-global. Bounded model-visible output preserves Unicode surrogate pairs and CRLF line endings, while existing complete-line and stats-first behavior remains intact.
