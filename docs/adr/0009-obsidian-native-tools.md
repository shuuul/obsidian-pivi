# ADR-0009: Obsidian-native tools and hybrid CLI transport

## Status

Proposed

## Context

Obsius embeds `pi-agent-core` (ADR-0003) without `pi-coding-agent`. The agent currently registers only the MCP proxy tool (ADR-0006). System prompts still reference tools that are not registered, causing model hallucination of tool calls.

Obsidian 1.12+ ships an official CLI that exposes vault operations (read, search, tasks, links, properties, commands, eval) via IPC while the app is running. Obsius already documents manual CLI workflows in `AGENTS.md` but does not expose them to the agent.

Product decisions (2026-05-24):

1. **Hybrid** tool backend: in-process Obsidian API + CLI JSON where appropriate.
2. **`command` / `eval`**: may ship later; default off with approval and allowlists.
3. **Skills**: vault-only `.obsius/skills` in v1.
4. **Provider OAuth** in settings UI (separate from MCP OAuth).
5. **Sessions**: Pi-style JSONL tree on disk.
6. **Subagent / Plan**: retain and wire to Pi tools.

## Decision

1. Implement Obsidian-native `AgentTool`s under `src/pi/tools/`, registered in `PiChatRuntime` together with MCP tools.
2. Use **hybrid execution**:
   - Reads/writes and path-validated mutations → Obsidian `App` / vault adapter in-process.
   - Search, tasks, links, properties, and other CLI-rich commands → `child_process` invoking official `obsidian` CLI with `format=json` and explicit `vault=`.
3. Do **not** add pi-coding-agent default bash/read/write tools.
4. Gate optional `obsidian_command` and `obsidian_eval` behind settings + `ApprovalManager`; default disabled.
5. Store session trees as JSONL under `.obsius/sessions/`, **1:1 compatible** with pi-coding-agent v3 (`SessionManager` from `@earendil-works/pi-coding-agent` or vendored copy from pi-mono).
6. Load context layers (AGENTS chain, `.obsius/SYSTEM.md`, skills) in `buildPiSystemPrompt`; skills follow [Agent Skills](https://agentskills.io) + [skills.sh](https://skills.sh/docs); register a `skill` AgentTool for on-demand load (spec: [context-layers-spec.md](../specs/context-layers-spec.md)).

## Rationale

- **Vault semantics**: Wikilinks, frontmatter, and Obsidian-specific task syntax are first-class in CLI/API; generic bash breaks trust boundaries in a note-taking plugin.
- **Hybrid**: API avoids spawn overhead for hot read/write paths; CLI avoids reimplementing search/tasks/graph commands and stays aligned with [Obsidian CLI docs](https://help.obsidian.md/cli).
- **Stay on pi-agent-core**: Product layer (tools, sessions, context) is Obsius-owned; no TUI or pi package manager dependency.
- **Security**: Mutations and `eval`/`command` require explicit opt-in — consistent with vault-local trust model (ADR-0004).

## Alternatives

1. **CLI only** — Simpler single transport; rejected for latency and duplicated path logic on every read.
2. **App API only** — Reimplement search/tasks/links; high maintenance vs official CLI.
3. **Re-import pi-coding-agent tools** — Pulls bash/TUI assumptions; wrong host environment.
4. **obsidian-cli-mcp as dependency** — Extra MCP hop; Obsius already has MCP proxy; native tools keep one agent tool plane.

## Consequences

### Positive

- Model sees tools that match prompt and UI.
- Official CLI upgrades benefit Obsius when commands expand.
- Clear extension point for Subagent tools on same `Agent` instance.

### Negative / trade-offs

- Requires Obsidian running for CLI-backed tools.
- Two execution paths need contract tests and consistent error shapes.
- PATH/installer issues become support burden (document in settings).

### Technical debt

- Update `mainAgent.ts` tool list and `toolNames.ts` to Obsidian names.
- Align `PI_RUNTIME_CAPABILITIES` with real fork/session/commands support as features land.
- Provider OAuth storage abstraction separate from `McpVaultAuthStore`.
- Add `obsius` agent to [vercel-labs/skills](https://github.com/vercel-labs/skills) (`--agent obsius` → `.obsius/skills/`) or document interim copy-from-`.pi/skills` install path.
- Evaluate `@earendil-works/pi-coding-agent` bundle impact (imports only `SessionManager` + `skills` modules).

## Review date

2026-08-24 — Re-evaluate direct MCP tool registration (ADR-0006) vs growing native tool surface.
