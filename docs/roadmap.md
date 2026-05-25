# Roadmap

Lightweight direction only. Detailed work belongs in issues and `docs/specs/`.

**Locked product choices (2026-05-24):** hybrid Obsidian tools (API + CLI); vault skills `.obsius/skills` + `skill` tool + [skills.sh](https://skills.sh/docs) install; pi-coding-agent JSONL v3 **1:1** (`SessionManager`); provider OAuth in settings; Subagent/Plan on Pi tools; optional `command`/`eval` gated.

## Near term

- [x] **Inline context input panel** — [inline-context-input-panel-spec.md](./specs/inline-context-input-panel-spec.md): explicit editor-selection chip + marked prompt context.
- [x] **Obsidian tools MVP** — [obsidian-tools-spec.md](./specs/obsidian-tools-spec.md), [ADR-0009](./adr/0009-obsidian-native-tools.md)
  - [x] `src/pi/tools/` hybrid host (`createObsidianTools`, 11 per-tool files)
  - [x] Approval for writes (`ApprovalManager`); `command`/`eval` off by default
  - [x] Capabilities honesty (`PI_RUNTIME_CAPABILITIES`)
- [x] MCP richer parity — [ADR-0006](./adr/0006-mcp-proxy-tool.md) (proxy tool, OAuth, connection pool)

## Medium term

- [x] **Context layers** — [context-layers-spec.md](./specs/context-layers-spec.md) (AGENTS.md chain, SYSTEM.md, skills tool, skills.sh install)
  - [ ] AGENTS.md chain + `.obsius/SYSTEM.md`
  - [ ] `.obsius/skills/` via `loadSkillsFromDir` + `formatSkillsForPrompt` (pi-coding-agent)
  - [ ] `skill` AgentTool + `/skill:name` slash
  - [ ] Settings: install from skills.sh (`npx skills`); upstream `obsius` agent path
  - [ ] Prompt templates ↔ slash library / CLI `template:*`
- [ ] **Session tree polish** — [session-tree-spec.md](./specs/session-tree-spec.md), [ADR-0010](./adr/0010-jsonl-session-tree-and-obsius-storage.md): history UI branch picker, rewind → leaf, drop in-memory `conversationId` from tabs
- [ ] **Provider OAuth in settings** — safeStorage; Anthropic/OpenAI/etc. flows (not shell `/login`)
- [x] **Subagent + Plan mode** — `SubagentManager`, `createSubagentTool`, `tabPlanMode`
- [ ] Compaction: `transformContext` + wire `buildPromptWithHistoryContext`
- [ ] Evaluation harness for turn prompts and MCP mention behavior

## Longer term

- [ ] Optional export/share of session branches (pi-compatible JSONL)
- [ ] Optional export of stable notes from `docs/notes/` into architecture docs

## Non-goals (unchanged)

- Multi-runtime (Claude SDK + Pi in one plugin)
- Global MCP config discovery
- pi-coding-agent TUI / `pi install` package ecosystem as runtime dependency

Update this file when priorities change; record *why* in an ADR when dropping or adding a major initiative.
