# Obsius — Pi Agent in Obsidian

> **v0.2.0** · An Obsidian community plugin that embeds the Pi agent directly in your vault.

[![version](https://img.shields.io/badge/version-0.2.0-blue)](https://github.com/shuuul/obsius2/releases)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Obsidian plugin](https://img.shields.io/badge/Obsidian-Plugin-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md/plugins)

---

Obsius embeds the **Pi agent** directly inside your Obsidian vault — no separate desktop app, no CLI tools to configure, no external terminal needed. Chat with an AI agent in the sidebar, edit inline with precision, and manage your knowledge through tools built for Obsidian, not for coding.

Read the [white paper](https://github.com/shuuul/obsius/blob/master/WHITEPAPER.md) for the design philosophy behind precise context control in AI-assisted writing.

## What makes Obsius different

- **Pi agent core** — one focused, in-process runtime for chat, inline edit, tools, planning, and subagents.
- **Obsidian-native tools** — read, edit, search, links, tasks, and properties operate through Obsidian-aware APIs.
- **Vault-local configuration** — MCP servers, OAuth data, skills, and sessions live under `.obsius/` in the vault.
- **Vault skills** — [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) is installed automatically on first vault launch.
- **Hexagonal architecture** — `src/core/` defines ports, `src/pi/` adapts Pi, and `src/features/` owns the UI.

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

```mermaid
flowchart TB
  host["Obsidian plugin host<br/>main.ts: bootstrap, views, commands"]
  features["src/features/<br/>UI, controllers, settings, inline edit"]
  core["src/core/<br/>ports, types, prompts<br/>zero external library deps"]
  pi["src/pi/<br/>PiChatRuntime, MCP bridge, OAuth, skills<br/>Obsidian-native tools"]

  host --> features
  features -->|depends only on core ports| core
  core -->|implemented by| pi
```

## Registered tools

| Tool | Purpose | Mutates | Default |
|------|---------|---------|---------|
| `obsidian_read` | Read note bodies by vault-relative `path` or wikilink-style `file` | No | On |
| `obsidian_edit` | Preferred partial edit tool: replace exact `old_string` text in an existing note | Yes | On |
| `obsidian_write` | Create notes, append/prepend content, or deliberately overwrite a full note | Yes | On |
| `obsidian_search` | Substring search, simplified `tag:` search, or folder listing via `query=*` / `path:` | No | On |
| `obsidian_note_info` | Read metadata: size, dates, tags, outgoing links, and frontmatter | No | On |
| `obsidian_links` | Read outgoing links or backlinks for one note | No | On |
| `obsidian_properties` | List, read, set, or remove YAML frontmatter properties | Yes | On |
| `obsidian_tasks` | List or toggle Markdown task status | Yes | On |
| `obsidian_delete` | Move a vault file or folder to trash via Obsidian `FileManager.trashFile()` | Yes | On |
| `obsidian_move` | Rename or move a vault file/folder and update links according to Obsidian settings | Yes | On |
| `obsidian_list` | List direct children of a vault folder, including notes, folders, and attachments | No | On |
| `obsidian_mkdir` | Create a vault folder | Yes | On |
| `obsidian_open` | Open a vault file in the Obsidian workspace | No | On |
| `obsidian_attachment` | Get attachment metadata/resource URLs or resolve an available attachment path | No | On |
| `obsidian_command` | Execute an Obsidian palette command by id | Yes | **Off** |
| `obsidian_eval` | Run arbitrary JavaScript in the Obsidian context | Yes | **Off** |
| `mcp` | Invoke vault-local MCP servers from `.obsius/mcp.json` | Varies | On when configured |
| `skill` | Load vault-local skill instructions from `.obsius/skills/` | No | On |
| `Agent` | Spawn a focused subagent for a delegated task | Varies | On |

Mutating tools go through Obsius approval rules. `obsidian_delete` intentionally moves items to trash instead of permanently deleting them, following the user's Obsidian trash settings.

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
| Releases | [GitHub Releases](https://github.com/shuuul/obsius2/releases) |

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

Releases are managed by [release-please](.github/workflows/release-please.yaml). Use Conventional Commits on `main`; release-please opens a release PR that updates version metadata and generates `CHANGELOG.md`. Merging that PR creates the GitHub release notes.

[Release workflow](.github/workflows/release.yaml) builds the plugin and uploads `main.js`, `manifest.json`, and `styles.css` to GitHub Releases.

## License

MIT. This repo is adapted from [Claudian](https://github.com/YishenTu/claudian) (MIT).

See [LICENSE](LICENSE) for details.

## Acknowledgments

- [Pi agent core](https://github.com/earendil-works/pi-mono) — The Pi agent runtime that powers Obsius
- [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) — Agent Skills for Obsidian
- [Claudian](https://github.com/YishenTu/claudian) — Code lineage this version is adapted from
- [Agent Skills](https://agentskills.io) — The Agent Skills specification
- [skills.sh](https://skills.sh) — Skills distribution CLI
- [obsidianmd/obsidian-api](https://github.com/obsidianmd/obsidian-api) — Obsidian plugin API

---

*Built for writers who want AI collaboration with nanometer precision, not black-box generation.*
