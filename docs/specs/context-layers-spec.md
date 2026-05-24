# Context layers (AGENTS, skills, templates, sessions)

## Problem

`pi-coding-agent` loads project instructions, skills, prompt templates, and JSONL session trees. Obsius migrated to `pi-agent-core` but only implements a static `buildPiSystemPrompt()` plus UI-injected turn context. Skills appear in types/UI without a loader; fork exists in UI without Pi-native session files.

## Goals

- Layer **context engineering** comparable to pi-coding-agent (minus TUI), vault-local under `.obsius/`.
- **Skills** v1: vault-only `.obsius/skills/`; **Agent Skills** spec ([agentskills.io](https://agentskills.io)); install flow compatible with [skills.sh](https://skills.sh/docs) / `npx skills`.
- Register a **`skill` AgentTool** for on-demand load (in addition to system-prompt discovery).
- **Sessions**: **1:1 compatible** with pi-coding-agent JSONL v3 (tree via `id`/`parentId`); reuse pi reference implementation where possible.
- Wire **Subagent** and **Plan mode** to real Pi `Agent` tools (not display-only).
- Provider **OAuth** from Obsius settings (not shell `/login`).

## Non-goals

- pi-coding-agent TUI, `pi install`, themes, keybindings.
- Importing `~/.pi` as source of truth for Obsius runtime config.
- Global Cursor/Claude skill dirs in v1 (vault `.obsius/skills` only).

## Vault layout

```text
.obsius/
  mcp.json
  mcp-oauth/
  skills/                    # Agent Skills roots (SKILL.md trees)
    <skill-name>/
      SKILL.md
      scripts/ …             # optional, per spec
  SYSTEM.md                  # optional vault-wide system appendix
  sessions/
    --<encoded-vault-path>--/
      <timestamp>_<uuid>.jsonl   # same naming as pi-coding-agent
```

Repo-root `AGENTS.md` remains developer documentation unless present in vault; **runtime** loads:

1. Vault root `AGENTS.md` (if present)
2. Walking upward from **active note directory** to vault root

## Session format (1:1 with pi-coding-agent)

**Decision:** Obsius session files must be readable/writable by pi CLI and vice versa (same schema, same migration behavior).

### Reference

| Source | Location |
|--------|----------|
| Format doc | `pi-coding-agent` → `docs/session-format.md` |
| Types / API | `@earendil-works/pi-coding-agent` exports: `SessionManager`, `buildSessionContext`, `CURRENT_SESSION_VERSION` (3) |
| Upstream | [pi-mono `session-manager.ts`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/session-manager.ts) |

### Implementation strategy

1. **Preferred:** Add `@earendil-works/pi-coding-agent` (same semver as `pi-agent-core` / `pi-ai`) and import `SessionManager` + `buildSessionContext` from the package public API. Do not reimplement entry types.
2. **Fallback:** Vendor-copy `session-manager.ts` (+ `messages.ts` deps) from pi-mono into `src/pi/session/` only if bundle size blocks the dependency; keep types identical and add a sync note in `src/pi/AGENTS.md`.

### Path mapping

| pi-coding-agent | Obsius |
|-----------------|--------|
| `~/.pi/agent/sessions/--<cwd>--/*.jsonl` | `<vault>/.obsius/sessions/--<vault-path-encoded>--/*.jsonl` |
| `SessionHeader.cwd` | Vault absolute path (or Obsius workspace root) |
| `SessionHeader.parentSession` | Unchanged on fork/clone |

### Obsius integration

- Each chat tab/conversation holds `sessionFile` path (or creates via `SessionManager.create(vaultPath, sessionDir)`).
- **Fork** / **clone** / **branch**: use `SessionManager.branch`, `branchWithSummary`, `createBranchedSession`, `forkFrom` — same semantics as pi `/fork`, `/clone`, `/tree`.
- **Agent state:** On turn end, `appendMessage` for user/assistant/toolResult; rebuild agent messages via `buildSessionContext()` instead of ad hoc `agentState` blobs.
- **Compaction / branch_summary:** Use pi entry types (`compaction`, `branch_summary`) and pi compaction hooks where applicable.

### Compatibility tests

- Round-trip: write session in Obsius → open with `pi --fork <path>` (manual).
- Unit: parse golden JSONL fixtures copied from pi-coding-agent tests (if vendored, copy fixtures too).

## Skills (Agent Skills + skills.sh)

### Standards

- **Format:** [Agent Skills specification](https://agentskills.io/specification) — `SKILL.md` + YAML frontmatter (`name`, `description`, optional `allowed-tools`, `disable-model-invocation`, etc.).
- **Discovery:** Same rules as pi — see `pi-coding-agent` `docs/skills.md` and `loadSkillsFromDir()`.

### Discovery (vault-only v1)

| Location | Loaded |
|----------|--------|
| `<vault>/.obsius/skills/` | Yes (primary) |
| `~/.pi/agent/skills/`, `.cursor/skills`, etc. | No (v1) |

Use pi exports when possible:

```typescript
import { loadSkillsFromDir, formatSkillsForPrompt } from '@earendil-works/pi-coding-agent';

loadSkillsFromDir({ dir: vaultPath + '/.obsius/skills', source: 'obsius-vault' });
```

### System prompt (progressive disclosure)

- At prompt build: `formatSkillsForPrompt(skills)` → XML block per [integrate-skills](https://agentskills.io/integrate-skills).
- Skills with `disable-model-invocation: true` excluded from XML (invoked only via tool or slash).

### `skill` AgentTool

Register on the Pi `Agent` alongside Obsidian and MCP tools.

| Field | Value |
|-------|--------|
| Name | `skill` |
| Purpose | Load full skill instructions + resolved `baseDir` for relative script paths |
| Input | `name` (required), `args` (optional string appended as `User: …` per pi `/skill:name`) |
| Output | SKILL.md body (markdown text); metadata: `baseDir`, `filePath` |
| Errors | Unknown name → list available skills; invalid frontmatter → diagnostic |

Behavior aligns with pi **explicit** invocation (`/skill:name`); complements passive XML discovery.

### skills.sh / `npx skills` install

[skills.sh](https://skills.sh) distributes skills via the open-source [`vercel-labs/skills`](https://github.com/vercel-labs/skills) CLI.

**v1 UX (Settings → Skills):**

| Action | Behavior |
|--------|----------|
| Install from slug | e.g. `vercel-labs/agent-skills` → run CLI non-interactive |
| List installed | Scan `.obsius/skills/` + `npx skills list` optional |
| Remove | Delete skill dir or `npx skills remove` when agent registered |

**Install command (until Obsius is a first-class agent in skills CLI):**

```bash
cd "<vault>"
npx skills add <owner/repo> --copy -y
# Then sync: move/link from installer output into .obsius/skills/
```

**Target state:** Upstream PR to `vercel-labs/skills` adding agent `obsius`:

| Agent | `--agent` | Project path |
|-------|-----------|--------------|
| Obsius | `obsius` | `.obsius/skills/` |

Then:

```bash
npx skills add vercel-labs/agent-skills -a obsius -y
```

**Security:** Show skills.sh security notice in UI; encourage reviewing `SKILL.md` before install (same as pi docs).

### Slash commands

- `/skill:<name>` and skill picker in `SlashCommandCatalog` call the same loader as `skill` tool.
- Reuse existing `resetRuntimeSkillsCache()` hook after vault skill dir changes.

## User experience

### Instructions

- User edits vault `AGENTS.md` / `.obsius/SYSTEM.md`; next turn picks up changes (`computeSystemPromptKey`).
- Settings `customPrompt` still applies (precedence below).

### Sessions

- Resume lists sessions from `.obsius/sessions/--…--/` (pi-compatible ordering).
- Fork creates branched tree in-file or new JSONL via `createBranchedSession` / `forkFrom`.
- Optional: open session in external `pi` for power users (same file).

### OAuth (models)

- Settings → Models → **Connect** per provider (browser OAuth / device code).
- Tokens in Electron `safeStorage`, not vault JSON.

## API / interfaces

### Core ports (proposed)

| Port | Role |
|------|------|
| `ContextLayerLoader` | AGENTS chain, SYSTEM.md, `formatSkillsForPrompt` block |
| `SkillCatalog` | Wraps `loadSkillsFromDir` / `Skill` type from pi-coding-agent |
| `SessionStore` | Facade over `SessionManager` (no duplicate schema) |
| `ProviderAuthPort` | OAuth in settings — `pi/` |

`buildPiSystemPrompt()`:

```text
base = buildSystemPrompt(settings)
agents = loadAgentsMdChain(...)
system = read(.obsius/SYSTEM.md)
skillsXml = formatSkillsForPrompt(catalog.list())
return compose(base, agents, system, settings.customPrompt, skillsXml)
```

### Subagent + Plan

- **Subagent:** Pi `AgentTool` spawning nested agent; `SubagentManager` UI unchanged.
- **Plan mode:** Tool allowlist restriction + plan instruction layer (`tabPlanMode.ts`).

## Precedence (system prompt)

1. `mainAgent` base (lists **registered** tools only)
2. Vault + path `AGENTS.md` chain (token-capped)
3. `.obsius/SYSTEM.md`
4. `formatSkillsForPrompt` (available skills XML)
5. `settings.systemPrompt`
6. Turn prompt (`buildTurnPrompt`) — MCP, selection, attachments

Full skill body is **not** inlined unless `skill` tool or `/skill:` invokes it.

## Algorithm

### AGENTS.md chain

- From active note directory → vault root; more specific overrides general.
- Truncate with token budget.

### Fork / resume

- Use `SessionManager` leaf/branch APIs; stop persisting parallel opaque `agentState` once JSONL is source of truth.
- Map `TabManager` / `tabFork.ts` `ForkContext` → `branch` / `createBranchedSession`.

### Compaction

- `SessionManager.appendCompaction` + `buildSessionContext` compaction path.
- Optional: `transformContext` on `pi-agent-core` `Agent` for live window management.

## Evaluation

- Unit: `loadSkillsFromDir` on fixture `.obsius/skills/`; `skill` tool returns body; AGENTS merge order.
- Session: golden JSONL from pi parses in Obsius; fork produces valid v3 tree.
- Manual: `npx skills add …` → skill appears in settings list → `skill` tool loads it.
- OAuth: Connect in settings → chat without env paste.

## Resolved decisions

| Question | Decision |
|----------|----------|
| JSONL schema | **1:1** pi-coding-agent v3; reuse `SessionManager` / copy from pi-mono |
| Skill injection | **Both** — `formatSkillsForPrompt` in system prompt **and** `skill` AgentTool |
| skills.sh | Support via `npx skills`; upstream `obsius` agent → `.obsius/skills/` |

## Related

- ADR: [0009](../adr/0009-obsidian-native-tools.md), [0003](../adr/0003-pi-as-sole-agent-runtime.md)
- Architecture: [context-management.md](../architecture/context-management.md), [prompt-system.md](../architecture/prompt-system.md)
- Spec: [obsidian-tools-spec.md](./obsidian-tools-spec.md)
- External: [pi session-format](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/session-format.md), [skills.sh docs](https://www.skills.sh/docs)
