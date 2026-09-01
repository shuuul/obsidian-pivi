---
id: "044"
title: "Local-substring newline edits"
status: Completed
created: 2026-08-31
updated: 2026-08-31
coordinator: "Amp"
---

# 044 — Local-substring newline edits

## Context

Imported transcripts can contain tens of thousands of characters on one physical line. `obsidian_edit` already replaces an exact substring rather than requiring a whole-line match, but Agent guidance did not clearly teach that a short unique span around the desired boundary is sufficient for inserting `\n` or `\n\n`.

The same gap caused a Markdown regression in the referenced Session. The source contained `>> Target`, while the Agent matched only `Target` and replaced it with text beginning `### Heading`. Literal replacement correctly preserved the unmatched `>> ` prefix and produced `>> ### Heading`, which is not a heading.

## Goal and success criteria

Teach Agents to use the existing `obsidian_edit` exact-replacement contract for safe local newline insertion and Markdown block boundaries.

- [x] ToolSpec-owned guidance says `old_string` need not contain a whole physical line.
- [x] Guidance tells the Agent to copy the shortest exact local span that is unique and repeat it in `new_string` with `\n` or `\n\n` inserted.
- [x] Static and registered prompts include a concrete local-substring newline example suitable for very long lines.
- [x] Guidance retains unique-by-default matching and limits `replace_all: true` to identical replacements at every exact occurrence.
- [x] ToolSpec-owned, static, and registered prompts explain that unmatched surrounding text remains adjacent to `new_string`.
- [x] Markdown guidance covers headings, lists, blockquotes/callouts, fenced code blocks, and thematic breaks, including the `>> Target → >> ### Heading` regression.
- [x] Focused tests cover local newline payload forwarding, prompt delivery, delimiter replacement, and physical-line-boundary guidance.

## Scope and non-goals

In scope:

- `obsidian_edit` ToolSpec guidance.
- Static main-Agent mutation guidance.
- Capability-aware registered-tool guidance.
- Durable tool documentation and focused prompt/tool tests.

Not in scope:

- Changing exact replacement semantics or the host mutation path.
- Fuzzy, regex, semantic, or offset-based matching.
- Automatic discovery of semantic paragraph boundaries.
- Reformatting a whole note or normalizing existing line endings.
- Making `replace_all` implicit.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-08-31 | Use `obsidian_edit` for local newline insertion. | Its exact substring replacement already works inside arbitrarily long physical lines and preserves the existing unique-match safety, File Recovery, containment, structured patch, and latest-content mutation path. | WS-01, WS-02 |
| 2026-08-31 | Teach shortest-unique-span matching rather than whole-line matching. | The Agent needs only enough context around the boundary to identify one occurrence, avoiding multi-thousand-character arguments. | WS-01 |
| 2026-08-31 | Treat Markdown physical-line boundaries as part of the replacement. | Literal replacement cannot infer that `###`, `-`, `>`, fences, or thematic breaks should begin a new block. | WS-01, WS-02 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Add ToolSpec-owned and static local-newline/Markdown guidance | Amp | Done | None | ToolSpec and main-prompt tests |
| WS-02 | Add registered-tool guidance and synchronize durable docs | Amp | Done | WS-01 | Registered-prompt and spec checks |
| WS-03 | Run repository and live-host verification | Amp | Done | WS-01, WS-02 | Tests, typecheck, lint, build, reload, and error inspection |

## Verification

Required scenarios:

- A local span such as `sentence.Second` is represented as `sentence.\n\nSecond` without copying the full physical line.
- Tool execution forwards literal line endings unchanged to the existing host API.
- Ambiguous matches still require more context unless every occurrence intentionally receives the identical replacement through `replace_all: true`.
- Delimiter replacement can use `>> → \n\n` or `>> → \n\n>>`.
- Replacing only `Target` inside `>> Target` with `### Heading` is documented as producing `>> ### Heading`, not a heading.
- Corrective guidance includes the delimiter and required physical-line endings in one self-contained replacement and requires read-back verification.

Commands:

```bash
npm run test -- --runInBand tests/unit/obsidian-tools/editNoteTool.test.ts tests/unit/agent/prompt/mainAgent.test.ts tests/unit/agent/prompt/obsidianAgentTools.test.ts
npm run typecheck
npm run lint
npm run check:boundaries
npm run check:specs
npm run build
obsidian plugin:reload id=pivi
obsidian dev:errors
git diff --check
```

## Documentation sync

- `docs/07-tools-skills-mcp-and-integrations.md` documents shortest-unique-substring newline insertion and Markdown physical-line boundaries.
- `packages/obsidian-tools/AGENTS.md` records ToolSpec ownership of the guidance.
- `packages/agent/AGENTS.md` records static and registered prompt ownership.

## Progress and handoff

### 2026-08-31 — Amp — completed

- Changed: Updated `obsidian_edit` ToolSpec, static system Prompt, and generated registered-tool Prompt to teach local-substring newline insertion and physical-line-safe Markdown replacement.
- Evidence: Focused coverage passed 3 suites / 29 tests; full coverage passed 337 suites / 2,973 tests. Typecheck, lint, architecture/boundary checks, i18n dead-key scan, spec validation, production build, bundle-size gate, and `git diff --check` passed. The production plugin reloaded successfully and `obsidian dev:errors` reported no errors. Repository and built-bundle search found no removed dedicated-tool identity or implementation references.
- Remaining: None within this spec.
- Blockers: None.
- Next action: None; this completed spec is archived.

## Completion summary

Agents now use `obsidian_edit` to split very long physical lines by matching only a short unique local substring and inserting `\n` or `\n\n` in `new_string`. Prompt guidance also prevents Markdown block markers from remaining adjacent to unmatched prefixes such as `>> `, and requires read-back verification after structural edits.
