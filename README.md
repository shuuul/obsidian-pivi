# Obsius2 — Pi Agent in Obsidian

> **v0.1.0** · This is **Obsius2** — a complete rewrite of the original [Obsius](https://github.com/shuuul/obsius) (ACP-based). Same name, entirely different engine. Read [why we rebuilt it](#what-makes-obsius2-different).

[![version](https://img.shields.io/badge/version-0.1.0-blue)](https://github.com/shuuul/obsius2/releases)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Obsidian plugin](https://img.shields.io/badge/Obsidian-Plugin-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md/plugins)

---

Obsius2 embeds the **Pi agent** directly inside your Obsidian vault — no separate desktop app, no CLI tools to configure, no external terminal needed. Chat with an AI agent in the sidebar, edit inline with precision, and manage your knowledge through tools built for Obsidian, not for coding.

Read the [white paper](https://github.com/shuuul/obsius/blob/master/WHITEPAPER.md) for the design philosophy behind precise context control in AI-assisted writing.

> **⚠️ Distinguishing the two repositories:** This is **obsius2** (`github.com/shuuul/obsius2`), a *ground-up rewrite* of the earlier [Obsius](https://github.com/shuuul/obsius) (`github.com/shuuul/obsius`). The original repo was built on ACP (Agent Client Protocol) and supported multiple agent runtimes via CLI tools. Obsius2 replaces all of that with a single Pi agent runtime, Obsidian-native tools, and vault-local skills — no CLI tools required. See the table below for a full comparison.

## What makes Obsius2 different

Obsius2 is a **complete rebuild** of the original [Obsius](https://github.com/shuuul/obsius). The original was forked from [obsidian-agent-client](https://github.com/RAIT-09/obsidian-agent-client) (ACP-based, multiple agents, CLI-dependent).

Obsius2 takes a fundamentally different approach rooted in a different code lineage — adapted from [Claudian](https://github.com/YishenTu/claudian) — with **Pi agent core** as the sole runtime, **zero CLI tool dependencies**, **Obsidian-native tools** instead of generic coding tools, and **natively bundled vault skills**.

| | Obsius v1 (ACP-based) | Obsius2 (Pi-only) |
|---|---|---|
| **Code lineage** | Forked from `obsidian-agent-client` (ACP) | Adapted from [Claudian](https://github.com/YishenTu/claudian), then heavily modified |
| **Agent Runtime** | Multiple (Claude Code, Codex, Gemini CLI) via ACP | **Pi agent core** — one focused, in-process runtime |
| **CLI tools** | Required (`claude`, `codex`, `gemini` on PATH) | **None needed** — all tools are Obsidian-native |
| **Tool surface** | Generic coding tools (bash, read, write, edit) | **Obsidian-native tools** — `obsidian_read`, `obsidian_write`, `obsidian_search`, `obsidian_links`, `obsidian_tasks`, `obsidian_properties` |
| **Skills** | Manual install | **Natively bundled** — [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) installed on first vault launch |
| **Architecture** | Monolithic plugin | **Hexagonal ports-and-adapters** — `src/core/` (ports), `src/pi/` (Pi adaptor), `src/features/` (UI) |
| **Configuration** | `.env` + CLI configs | Plugin settings UI + vault-local `.obsius/` |
| **Startup speed** | Slow (spawns external process per agent) | **Fast** — Pi runs in-process |
| **MCP** | Host-level global config | **Vault-local** — `.obsius/mcp.json` only |
| **License** | Apache 2.0 | **MIT** |

## Key features

- **Sidebar chat** — Multi-tab conversational AI with streaming, file context, and slash commands.
- **Inline editing** — Selection-aware rewrites using Pi auxiliary queries.
- **Obsidian-native tools** — Read, write, search, and manage notes through tools that understand wikilinks, frontmatter, and vault semantics — not bash.
- **Vault skills** — [Agent Skills](https://agentskills.io) spec-compliant. [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) installed automatically on first use. Install more via `npx skills add`.
- **MCP support** — Vault-local MCP servers (`.obsius/mcp.json`), remote servers with OAuth, `@server` mention transform.
- **Session tree** — Pi-compatible JSONL session persistence. Fork, branch, and resume conversations.
- **Approval manager** — Writes require confirmation; sensitive tools (`command`, `eval`) are disabled by default.
- **Provider keychain** — API keys stored in Obsidian's `app.secretStorage` (Electron safeStorage on desktop).

## Screenshots

> *(Coming soon — see [assets/](./assets/) for icons.)*

## Requirements

- **Obsidian** v1.11.4+ (desktop only)
- **macOS** (tested; Windows/Linux should work but not officially supported)

## Installation

### Via BRAT (recommended)

1. Install and enable [Obsidian42 - BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. Open BRAT settings → **Add Beta plugin**.
3. Paste: `https://github.com/shuuul/obsius2`
4. Enable **Obsius** in Community Plugins.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/shuuul/obsius2/releases).
2. Copy them to `<vault>/.obsidian/plugins/obsius2/`.
3. Enable **Obsius** in Community Plugins.

## Quick start

1. Open **Settings → Community plugins → Obsius**.
2. Add a model provider API key (OpenAI, Anthropic, etc.) via the **keychain** UI.
3. Click the Obsius ribbon icon (or run command `Obsius: Open view`).
4. Start chatting.

On first launch, Obsius automatically seeds [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) into `.obsius/skills/` — no configuration needed.

## How it works

```
┌─────────────────────────────────────────────┐
│  Obsidian Plugin Host                        │
│  main.ts — bootstrap, views, commands        │
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│  src/features/  — UI, controllers           │
│  (chat view, inline edit, settings)          │
│  depends ONLY on core ports                  │
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│  src/core/  — ports, types, prompts         │
│  (zero external library deps)               │
└────────────────────┬────────────────────────┘
                     │ implemented by
┌────────────────────▼────────────────────────┐
│  src/pi/  — Pi adaptor                       │
│  PiChatRuntime, MCP bridge, OAuth, skills   │
│  Obsidian-native tools (api + cli hybrid)   │
└─────────────────────────────────────────────┘
```

## Registered tools

| Tool | Purpose | Mutates | Default |
|------|---------|---------|---------|
| `obsidian_read` | Read notes by path or wikilink | No | On |
| `obsidian_write` | Create, update, append to notes | Yes | On |
| `obsidian_search` | Search vault content | No | On |
| `obsidian_note_info` | Metadata, tags, frontmatter | No | On |
| `obsidian_links` | Incoming/outgoing links & backlinks | No | On |
| `obsidian_properties` | Read/write YAML frontmatter properties | Yes | On |
| `obsidian_tasks` | Query and toggle task status | Yes | On |
| `obsidian_command` | Execute any Obsidian palette command | Yes | **Off** |
| `obsidian_eval` | Run arbitrary JavaScript in Obsidian context | Yes | **Off** |
| `mcp` | Invoke vault MCP servers | Varies | On |
| `skill` | Load skill instructions on demand | No | On |
| Subagent | Spawn child agents for parallel tasks | — | On |

## Design documentation

| Topic | Doc |
|-------|-----|
| System architecture | [docs/architecture/system-architecture.md](docs/architecture/system-architecture.md) |
| Framework adapters | [docs/architecture/framework-adapters.md](docs/architecture/framework-adapters.md) |
| Agent runtime | [docs/architecture/agent-runtime.md](docs/architecture/agent-runtime.md) |
| Context & turns | [docs/architecture/context-management.md](docs/architecture/context-management.md) |
| MCP & tools | [docs/architecture/tool-system.md](docs/architecture/tool-system.md) |
| Prompts | [docs/architecture/prompt-system.md](docs/architecture/prompt-system.md) |
| UI | [docs/architecture/ui-integration.md](docs/architecture/ui-integration.md) |
| All ADRs | [docs/adr/](docs/adr/) |

## Security & privacy

- **API keys** are stored via Obsidian's `secretStorage` (Electron `safeStorage` on desktop) — not in plugin settings JSON.
- **All MCP config is vault-local** — `.obsius/mcp.json` only; no global host MCP discovery.
- **Write operations require approval** — the ApprovalManager prompts before any mutation.
- **`command` and `eval` tools are disabled by default** — must be explicitly enabled in settings, with optional allowlists.
- **Skills are vault-local** — installed under `.obsius/skills/`; no cross-vault or global skill directories.
- **No telemetry** — Obsius does not phone home.

## Development

```bash
# Install dependencies
npm install

# Development (watch mode)
npm run dev

# Build for production
npm run build

# Type-check
npm run typecheck

# Lint
npm run lint

# Test
npm run test
```

### CI and releases

Pull requests and pushes to `main` run [CI](.github/workflows/ci.yaml) (typecheck, lint, test coverage, build).

To publish a release, bump `package.json` / `manifest.json` / `versions.json`, then push a tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

[Release workflow](.github/workflows/release.yaml) builds the plugin and uploads `main.js`, `manifest.json`, and `styles.css` to GitHub Releases (same layout as [Obsius v1](https://github.com/shuuul/obsius)).

## License

MIT. This repo (`obsius2`) is adapted from [Claudian](https://github.com/YishenTu/claudian) (MIT). The earlier [Obsius v1](https://github.com/shuuul/obsius) was forked from [obsidian-agent-client](https://github.com/RAIT-09/obsidian-agent-client) by RAIT-09 (Apache 2.0, ACP-based) and is **not** the codebase you're looking at now.

See [LICENSE](LICENSE) for details.

## Acknowledgments

- [Pi agent core](https://github.com/earendil-works/pi-mono) — The Pi agent runtime that powers Obsius2
- [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) — Agent Skills for Obsidian
- [Claudian](https://github.com/YishenTu/claudian) — Code lineage this version is adapted from
- [Agent Skills](https://agentskills.io) — The Agent Skills specification
- [skills.sh](https://skills.sh) — Skills distribution CLI
- [Obsius v1](https://github.com/shuuul/obsius) — The original ACP-based prototype (separate codebase)
- [obsidian-agent-client](https://github.com/RAIT-09/obsidian-agent-client) — Original ACP-based plugin that v1 was forked from
- [obsidianmd/obsidian-api](https://github.com/obsidianmd/obsidian-api) — Obsidian plugin API

---

*Built for writers who want AI collaboration with nanometer precision, not black-box generation.*
