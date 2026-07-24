---
id: "038"
title: "Sidebar capability approvals"
status: Completed
created: 2026-07-24
updated: 2026-07-24
coordinator: "/agent"
---

# 038 — Sidebar capability approvals

## Context

Spec 034 turn-scoped high-risk modal confirms were reverted (`b924dcf`). Pivi still fails closed when `obsidian_bash` misses the allowlist or external read tools target paths outside allowed roots, with no sidebar confirmation.

Pivi already owns Claudian-style inline ask UI (`InlineAskUserQuestion`, `ComposerInlinePrompts`). This spec adds sidebar-only capability approvals for bash and external directory access only.

## Goal and success criteria

- [x] Unlisted bash commands and external paths outside allowed roots show an inline sidebar prompt (not a modal).
- [x] Options: Deny, Allow once (this invocation only), Allow for session (in-memory grant), Always allow (persist to settings).
- [x] Always allow appends to `bashAllowlist` or device-local `externalReadDirectories` and refreshes runtime tools.
- [x] Session grants clear on session switch, tab close, and plugin unload.
- [x] Vault mutations, eval, MCP, and other 034 operations remain out of scope.

## Scope and non-goals

In scope:

- Narrow `CapabilityApprovalPort`, session grant table, tool gates, inline UI, i18n, tests, docs.

Not in scope:

- Restoring spec 034 high-risk modal pipeline.
- Full `AskUserQuestion` model tool wiring.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-24 | Four options: deny / once / session / always | User requested true once-run plus session-scoped and settings persistence | WS-01, WS-02 |
| 2026-07-24 | Reuse `InlineAskUserQuestion` with approval header | Matches Claudian UX without new modal stack | WS-02 |
| 2026-07-24 | Per-tab `CapabilityApprovalPort` on `PiChatRuntime` | Each tab owns its own service and session grants | WS-01 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Port, session grants, runtime/tool wiring | /agent | In progress | None | Unit tests |
| WS-02 | Inline UI, CSS, i18n | /agent | Pending | WS-01 | Keyboard + composer hide tests |
| WS-03 | Docs and AGENTS sync | /agent | Pending | WS-01–WS-02 | `npm run check:specs` |

## Verification

- `npm run test -- tests/unit/obsidian-tools/capabilityApproval`
- `npm run test -- tests/unit/features/chat/capabilityApproval`
- `npm run typecheck && npm run lint && npm run check:boundaries`
- Human visual sign-off: sidebar approval prompt (light/dark), four options, approval header layout after `npm run build && obsidian plugin:reload id=pivi`

## Documentation sync

- Numbered developer docs: `docs/07-tools-skills-mcp-and-integrations.md`
- Nearest local guidance: `packages/obsidian-tools/AGENTS.md`, `src/ui/chat/AGENTS.md`
- Root guidance: `AGENTS.md`, `README.md`

## Progress and handoff

### 2026-07-24 — Agent — WS-01

- Changed: Initial implementation in progress.
- Next action: Complete port, tools, UI, tests, docs.
