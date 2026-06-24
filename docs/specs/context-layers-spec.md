# Context layers (AGENTS, skills, templates)

## Problem

`pi-coding-agent` loads project instructions, skills, prompt templates, and JSONL session trees. Obsius migrated to `pi-agent-core`; this spec covers the vault-local instruction and skill layers that feed Obsius system prompts and skill tools.

## Goals

- Layer **context engineering** comparable to pi-coding-agent (minus TUI), vault-local under `.obsius/`.
- **Skills**: vault-only `.obsius/skills/`; **Agent Skills** spec ([agentskills.io](https://agentskills.io)); install flow compatible with [skills.sh](https://skills.sh/docs) / `npx skills`.
- Register a **`skill` AgentTool** for on-demand load (in addition to system-prompt discovery).
- Wire **Subagent** and **Plan mode** to real Pi `Agent` tools (not display-only).
- Provider **OAuth** from Obsius settings (not shell `/login`).

## Non-goals

- pi-coding-agent TUI, `pi install`, themes, keybindings.
- Importing `~/.pi` as source of truth for Obsius runtime config.
- Global Cursor/Claude skill dirs (vault `.obsius/skills` only).

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
  sessions/                  # session persistence; see session-tree-spec.md
```

Repo-root `AGENTS.md` remains developer documentation unless present in vault; **runtime** loads:

1. Vault root `AGENTS.md` (if present)
2. Walking upward from **active note directory** to vault root

## Session boundary

Session persistence is intentionally out of scope for this spec. Obsius uses `.obsius/sessions/*.jsonl` as the single source of truth with pi-inspired v3 tree entries and Obsius custom entries; [session-tree-spec.md](./session-tree-spec.md) is authoritative for schema, fork/rewind behavior, tab binding, and migration cleanup. This spec only references sessions where context-layer precedence needs to mention turn prompt placement.

## Skills (Agent Skills + skills.sh)

### Standards

- **Format:** [Agent Skills specification](https://agentskills.io/specification) — `SKILL.md` + YAML frontmatter (`name`, `description`, optional `allowed-tools`, `disable-model-invocation`, etc.).
- **Discovery:** Same rules as pi — see `pi-coding-agent` `docs/skills.md` and `loadSkillsFromDir()`.

### Discovery (vault-only)

| Location | Loaded |
|----------|--------|
| `<vault>/.obsius/skills/` | Yes (primary) |
| `~/.pi/agent/skills/`, `.cursor/skills`, etc. | No |

Use `loadVaultSkills` from `src/pi/context/loadContextLayers.ts` (wraps pi-coding-agent `loadSkillsFromDir` / `formatSkillsForPrompt`; the `Skill` type is imported from pi-coding-agent):

```typescript
import { loadVaultSkills } from '../context/loadContextLayers';

const { skills, skillsXml } = loadVaultSkills(vaultPath);
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

**Settings UX:**

| Action | Behavior |
|--------|----------|
| List remote skills | Accept `owner/repo`, full GitHub URLs, `git@github.com:org/repo.git`, repo tree URLs, or local paths → run `npx skills add <source> --list` |
| Install selected skills | User checks remote skills from that list; selected names map to repeated `--skill <name>` for multi-skill repositories |
| List installed | Scan `.obsius/skills/` + `npx skills list` optional |
| Update all | Run `npx skills update -p -y` from `.obsius/`, then refresh installed skill folders |
| Update one | Run `npx skills update <skill-name> -p -y` from `.obsius/`, then refresh that skill folder |
| Remove | Delete skill dir or `npx skills remove` when agent registered |

**Install command (until Obsius is a first-class agent in skills CLI):**

```bash
cd "<vault>/.obsius"
npx skills add <source> --copy -y [--skill <name> ...]
# Then sync: move/link from installer output into .obsius/skills/
```

Running `npx skills` from `.obsius/` keeps CLI metadata such as `.skills.json` and `skills-lock.json` inside the vault-local hidden Obsius directory instead of the vault root. The CLI currently documents update by skill name (`npx skills update frontend-design`) and all-project update (`npx skills update -p -y`), but does not document a separate lock-file path option.
When Obsius sees legacy root-level `skills-lock.json` or `.skills.json`, it moves them into `.obsius/` before invoking the CLI.

**Target state:** Upstream PR to `vercel-labs/skills` adding agent `obsius`:

| Agent | `--agent` | Project path |
|-------|-----------|--------------|
| Obsius | `obsius` | `.obsius/skills/` |

Then:

```bash
npx skills add vercel-labs/agent-skills -a obsius -y
```

**Security:** Show skills.sh security notice in UI; encourage reviewing `SKILL.md` before install (same as pi docs).

### Default vault skills bundle

On first use per vault (`.obsius/settings.json` has no `defaultVaultSkillsSeeded: true` and `.obsius/skills/` is empty), Obsius runs:

```bash
npx skills add kepano/obsidian-skills --copy -y
```

then syncs from `.agents/skills/` (and nested `skills/` monorepo layouts) into `.obsius/skills/`. This installs the five skills from [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) (markdown, bases, JSON Canvas, CLI, defuddle).

| Setting | Meaning |
|---------|---------|
| `defaultVaultSkillsSeeded` | Set `true` after first successful default install; prevents reinstall if the user deletes skills later |
| `defaultVaultSkillsCommitSha` | Last applied `main` commit SHA from GitHub API |
| `defaultVaultSkillsRemovedFolders` | Default-bundle folders the user removed; not restored on upstream updates |

On each plugin load (after seed), Obsius compares `defaultVaultSkillsCommitSha` to `GET /repos/kepano/obsidian-skills/commits/main`. When the SHA changes, it runs `npx skills add kepano/obsidian-skills --copy -y` and **overwrites** bundle skill folders under `.obsius/skills/` (except names listed in `defaultVaultSkillsRemovedFolders`).

Users remove individual skills in Settings → Skills (delete folder under `.obsius/skills/`). Removing a default-bundle skill records its folder name so updates do not restore it. Failed installs/updates do not advance the commit SHA; Obsius retries on next load.

### Slash commands

- `/skill:<name>` and skill picker in `SlashCommandCatalog` call the same loader as `skill` tool.
- Reuse existing `resetRuntimeSkillsCache()` hook after vault skill dir changes.

## User experience

### Instructions

- User edits vault `AGENTS.md` / `.obsius/SYSTEM.md`; next turn picks up changes (`computeSystemPromptKey`).
- Custom instruction text is intentionally vault-file based; there is no settings-backed custom system prompt.

### Sessions

Session list, fork, rewind, and JSONL compatibility behavior are defined in [session-tree-spec.md](./session-tree-spec.md).

### OAuth (models)

- Settings → Models → **Connect** per provider (browser OAuth / device code).
- Tokens in Obsidian SecretStorage/keychain, not vault JSON.

## API / interfaces

### Core/adaptor surfaces

| Port | Role |
|------|------|
| `ContextLayerLoader` | AGENTS chain, SYSTEM.md, `formatSkillsForPrompt` block |
| `SkillCatalog` | Wraps `loadSkillsFromDir` / `Skill` type from pi-coding-agent |
| `ProviderAuthPort` | OAuth in settings — `pi/` |

`buildPiSystemPrompt()`:

```text
base = buildSystemPrompt(settings)
agents = loadAgentsMdChain(...)
system = read(.obsius/SYSTEM.md)
skillsXml = formatSkillsForPrompt(catalog.list())
return compose(base, agents, system, skillsXml)
```

### Subagent + Plan

- **Subagent:** Pi `AgentTool` spawning nested agent; `SubagentManager` UI unchanged.
- **Plan mode:** Tool allowlist restriction + plan instruction layer (`tabPlanMode.ts`).

## Precedence (system prompt)

1. `mainAgent` base (lists **registered** tools only)
2. Vault + path `AGENTS.md` chain (token-capped)
3. `.obsius/SYSTEM.md`
4. `formatSkillsForPrompt` (available skills XML)
5. Turn prompt (`buildTurnPrompt`) — MCP, selection, attachments

Full skill body is **not** inlined unless `skill` tool or `/skill:` invokes it.

## Algorithm

### AGENTS.md chain

- From active note directory → vault root; more specific overrides general.
- Truncate with token budget.

### Compaction

Automatic context compaction is excluded from the current product direction. Prefer non-destructive session tree operations (fork/rewind) and explicit context selection.

## Evaluation

- Unit: `loadSkillsFromDir` on fixture `.obsius/skills/`; `skill` tool returns body; AGENTS merge order.
- Manual: `npx skills add …` → skill appears in settings list → `skill` tool loads it.
- OAuth: Connect in settings → chat without env paste.

## Resolved decisions

| Question | Decision |
|----------|----------|
| JSONL schema | Owned by [session-tree-spec.md](./session-tree-spec.md); strict pi CLI 1:1 is not a goal |
| Skill injection | **Both** — `formatSkillsForPrompt` in system prompt **and** `skill` AgentTool |
| skills.sh | Support via `npx skills`; upstream `obsius` agent → `.obsius/skills/` |

## Related

- Architecture: [agent-runtime.md](../architecture/agent-runtime.md), [tool-system.md](../architecture/tool-system.md)
- Architecture: [context-management.md](../architecture/context-management.md), [prompt-system.md](../architecture/prompt-system.md)
- Spec: [session-tree-spec.md](./session-tree-spec.md)
- Spec: [obsidian-tools-spec.md](./obsidian-tools-spec.md)
- External: [pi session-format](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/session-format.md), [skills.sh docs](https://www.skills.sh/docs)
