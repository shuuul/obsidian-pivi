# Pivi — Pi as the Vault Intelligence

[![version](https://img.shields.io/badge/version-0.3.8-blue)](https://github.com/shuuul/obsidian-pivi/releases)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Obsidian plugin](https://img.shields.io/badge/Obsidian-Plugin-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md/plugins)

---

Pivi (formerly Obsius) is **Pi as the Vault Intelligence**: it embeds the **Pi agent** directly inside your Obsidian vault — no separate desktop app, no CLI tools to configure, no external terminal needed. Chat with an AI agent in the sidebar, edit inline with precision, and manage your knowledge through tools built for Obsidian, not for coding.

Read the [white paper](https://github.com/shuuul/obsidian-pivi/blob/master/WHITEPAPER.md) for the design philosophy behind precise context control in AI-assisted writing.

![Pivi sidebar chat screenshot](./assets/pivi-example-sm.png)

## What makes Pivi different

- **Pi agent core** — one focused, in-process runtime for chat, inline edit, tools, and subagents.
- **Obsidian-native tools** — read, inspect, edit, search, links, tasks, and properties operate through Obsidian-aware APIs.
- **No plan-mode ceremony** — Pivi does not interrupt writing with coding-agent plan mode or per-edit permission prompts. Instead, tools are scoped to Obsidian-native operations and reversible vault workflows.
- **Recoverable vault changes** — edits use Obsidian APIs where possible, deletes go through Obsidian trash, and the `obsidian_history` tool can list/read/restore Obsidian file-history snapshots.
- **Vault-local configuration** — MCP servers, OAuth data, skills, and sessions live under `.pivi/` in the vault.
- **Vault skills** — install [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) or other Agent Skills into `.pivi/skills/` after confirmation.
- **Pi-only product architecture** — `src/main.ts` composes concrete services, `src/app/` owns lifecycle and workspace wiring, `src/ui/` owns product UI, and reusable Pi/runtime foundations live in `@pivi/pivi-agent-core` plus Obsidian host/tool packages.

## Key features

- **Sidebar chat** — Multi-tab conversational AI with streaming, file context, and slash commands.
- **Inline editing** — Selection-aware rewrites using Pi auxiliary queries.
- **Obsidian-native tools** — Read, write, search, and manage notes through tools that understand wikilinks, frontmatter, and vault semantics — not bash.
- **Codex image generation** — When `openai-codex` credentials are connected, Pivi can generate images, save them as Obsidian attachments, and insert `![[...]]` embeds into notes.
- **Vault skills** — [Agent Skills](https://agentskills.io) spec-compliant. Pivi can install [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) after confirmation, and install more via `npx skills add`.
- **MCP support** — Vault-local MCP servers (`.pivi/mcp.json`), remote servers with OAuth, `@server` mention transform.
- **Session tree** — Pi-compatible JSONL session persistence. Fork, branch, and resume conversations.
- **Snapshot recovery instead of permission popups** — Pivi avoids plan mode and per-tool approval loops; recoverability comes from Obsidian-native file operations, trash, and official history snapshots that can be listed, read, and restored.
- **Provider keychain** — API keys stored in Obsidian's `app.secretStorage` (Electron safeStorage on desktop).

## Requirements

- **Obsidian** v1.12.0+ (desktop only)
- **macOS** (tested; Windows/Linux should work but not officially supported)

## Installation

### Via BRAT (recommended)

1. Install and enable [Obsidian42 - BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. Open BRAT settings → **Add Beta plugin**.
3. Paste: `https://github.com/shuuul/obsidian-pivi`
4. Enable **Pivi** in Community Plugins.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/shuuul/obsidian-pivi/releases).
2. Copy them to `<vault>/.obsidian/plugins/pivi/`.
3. Enable **Pivi** in Community Plugins.

## Quick start

1. Open **Settings → Community plugins → Pivi**.
2. Add a model provider API key (OpenAI, Anthropic, etc.) via the **keychain** UI.
3. Click the Pivi ribbon icon (or run command `Pivi: Open view`).
4. Start chatting.

On first launch with no vault skills installed, Pivi asks before installing [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) into `.pivi/skills/`. You can skip the prompt and install skills later from settings.

## How it works

```mermaid
flowchart TB
  subgraph obsidian["Obsidian plugin boundary"]
    host["src/main.ts<br/>thin Plugin shell"]
    appLifecycle["src/app/<br/>lifecycle, commands, views"]
    appSettings["src/app/settings/<br/>settings codec, environment apply"]
    appWorkspace["src/app/workspace/<br/>Pi workspace services, readiness, slash commands"]
  end

  subgraph product["Product features"]
    ui["src/ui/<br/>sidebar chat, settings, inline edit"]
    tools["@pivi/obsidian-tools<br/>read/structure/edit/search/history/task tool specs"]
  end

  subgraph core["Reusable Pivi packages"]
    foundation["@pivi/pivi-agent-core/foundation<br/>settings, contracts, UI projections"]
    prompt["@pivi/pivi-agent-core/prompt + context<br/>system prompt, turn prompt, context files"]
    session["@pivi/pivi-agent-core/session<br/>Pi-compatible JSONL sessions"]
    mcp["@pivi/pivi-agent-core/mcp + skills<br/>vault-local MCP, OAuth, skill catalog"]
    pi["@pivi/pivi-agent-core/engine/pi<br/>PiChatRuntime, model/auth, event adapter"]
    coreTools["@pivi/pivi-agent-core/tools<br/>tool protocol, display models, todo/diff helpers"]
    hostPkg["@pivi/obsidian-host<br/>vault/files, paths, keychain, process/http"]
  end

  subgraph vault["User vault"]
    notes["Notes and attachments"]
    piviDir[".pivi/<br/>sessions, MCP config, OAuth, skills"]
    secrets["Obsidian secretStorage<br/>provider API keys"]
  end

  providers["Model providers<br/>OpenAI, Anthropic, etc."]

  host --> appLifecycle
  host --> appSettings
  host --> appWorkspace

  appLifecycle --> ui
  appLifecycle --> hostPkg
  appSettings --> foundation
  appWorkspace --> pi
  appWorkspace --> tools
  appWorkspace --> hostPkg
  appWorkspace --> mcp

  ui --> foundation
  ui --> pi
  ui --> mcp
  ui --> coreTools
  ui --> appWorkspace

  pi --> foundation
  pi --> prompt
  pi --> session
  pi --> mcp
  pi --> coreTools
  pi --> hostPkg
  pi --> providers

  tools --> foundation
  tools --> coreTools
  tools --> hostPkg

  hostPkg --> notes
  hostPkg --> piviDir
  hostPkg --> secrets
  session --> piviDir
  mcp --> piviDir
```

At runtime, `src/main.ts` stays a thin Obsidian `Plugin` shell and delegates product orchestration to `src/app/`. The app layer owns lifecycle wiring, settings normalization, environment changes, model readiness checks, slash-command catalogs, and Pi workspace service construction. UI consumes those app/core services; reusable packages stay behind `@pivi/*` boundaries so product UI does not import low-level Pi SDK or raw Obsidian plumbing directly.

## Registered tools

| Tool                          | Purpose                                                                                                      | Mutates | Default                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ | ------- | --------------------------------------------- |
| `obsidian_read`               | Read note bodies safely by `path`/`file`; supports `mode=stats`, `startLine`, `endLine`, and `maxChars`      | No      | On                                            |
| `obsidian_markdown_structure` | Extract Markdown headings with line numbers and character counts before range-reading large notes            | No      | On                                            |
| `obsidian_edit`               | Preferred partial edit tool: replace exact `old_string` text in an existing note                             | Yes     | On                                            |
| `obsidian_write`              | Create notes, append/prepend content, or deliberately overwrite a full note                                  | Yes     | On                                            |
| `obsidian_search`             | Substring search, simplified `tag:` search, or folder listing via `query=*` / `path:`                        | No      | On                                            |
| `obsidian_note_info`          | Read metadata: size, dates, tags, outgoing links, and frontmatter                                            | No      | On                                            |
| `obsidian_links`              | Read outgoing links or backlinks for one note                                                                | No      | On                                            |
| `obsidian_properties`         | List, read, set, or remove YAML frontmatter properties                                                       | Yes     | On                                            |
| `obsidian_tasks`              | List or toggle Markdown task status                                                                          | Yes     | On                                            |
| `obsidian_history`            | List, read, and restore Obsidian file-history snapshots                                                      | Yes     | On                                            |
| `obsidian_delete`             | Move a vault file or folder to trash via Obsidian `FileManager.trashFile()`                                  | Yes     | On                                            |
| `obsidian_move`               | Rename or move a vault file/folder and update links according to Obsidian settings                           | Yes     | On                                            |
| `obsidian_list`               | List direct children of a vault folder, including notes, folders, and attachments                            | No      | On                                            |
| `obsidian_mkdir`              | Create a vault folder                                                                                        | Yes     | On                                            |
| `obsidian_open`               | Open a vault file in the Obsidian workspace                                                                  | No      | On                                            |
| `obsidian_attachment`         | Get attachment metadata/resource URLs or resolve an available attachment path                                | No      | On                                            |
| `obsidian_generate_image`     | Generate an image with Codex, save it as an Obsidian attachment, and optionally insert the embed into a note | Yes     | On only when `openai-codex` credentials exist |
| `obsidian_command`            | Execute an Obsidian palette command by id                                                                    | Yes     | **Off**                                       |
| `obsidian_eval`               | Run arbitrary JavaScript in the Obsidian context                                                             | Yes     | **Off**                                       |
| `mcp`                         | Invoke vault-local MCP servers from `.pivi/mcp.json`                                                         | Varies  | On when configured                            |
| `skill`                       | Load vault-local skill instructions from `.pivi/skills/`                                                     | No      | On                                            |
| `Agent`                       | Spawn a focused subagent for a delegated task                                                                | Varies  | On                                            |

Mutating tools are designed with safety in mind: Pivi does not add coding-agent plan mode or per-edit permission prompts; `obsidian_delete` intentionally moves items to trash instead of permanently deleting them, following the user's Obsidian trash settings, and file changes are recoverable using the `obsidian_history` tool and Obsidian's file-history snapshots.

Tools can be enabled or disabled from **Settings → Pivi → Tools**. Disabled tools are omitted from the agent's available tool list and system prompt on subsequent turns.

For large Markdown notes, the agent should first call `obsidian_read` with `mode=stats` to inspect line and character counts. If the file is large, `obsidian_markdown_structure` returns heading structure and section sizes so the agent can read only the needed section with `obsidian_read` `startLine` / `endLine`, instead of loading the whole note into context.

`obsidian_generate_image` is registered only after the `openai-codex` provider has credentials in Pivi provider settings. If Codex is not connected, the tool is omitted from the agent's available tool list and its Tools tab toggle is disabled until the user connects ChatGPT Plus/Pro Codex.

## Project guidance

AGENTS.md documentation is layered by scope — root for repo-wide rules, packages for module contracts, and source trees for local feature maps.

| Layer             | Location                                                            | Content                                   |
| ----------------- | ------------------------------------------------------------------- | ----------------------------------------- |
| Repo operations   | [AGENTS.md](AGENTS.md)                                              | Build, test, release, coding standards    |
| Package contracts | `packages/*/AGENTS.md`                                              | Entrypoints, boundaries, dependency rules |
| Feature maps      | Nested `src/**/AGENTS.md`                                           | Local UI/runtime flow, seam rules         |
| Releases          | [GitHub Releases](https://github.com/shuuul/obsidian-pivi/releases) | User-visible release history              |

## Security & privacy

- **Account/API key required** — to use hosted AI providers, you need an account, API key, or supported OAuth session for the provider you choose.
- **Model provider network use** — chat prompts, selected vault context, attachments, inline-edit text, tool results, and MCP results may be sent to the selected model provider for generation.
- **Image generation uses Codex** — image generation is available only with `openai-codex` credentials and sends the image prompt to the ChatGPT/Codex backend; generated image files are saved in the vault as Obsidian attachments.
- **MCP network and process use** — configured MCP servers are user-provided. Remote HTTP/SSE servers receive requests when enabled or mentioned; stdio servers run local commands you configure.
- **Skills network use** — listing, installing, or updating remote skills uses `npx skills` / skills.sh and may access GitHub or the skill source you enter. The default skills prompt accesses `kepano/obsidian-skills` only after you confirm installation.
- **External file access** — if you add external context directories, Pivi reads files from those user-selected directories outside the vault and may include selected content in model prompts.
- **API keys and static MCP secrets** are stored via Obsidian's `secretStorage` (Electron `safeStorage` on desktop) — not in plugin settings JSON or `.pivi/mcp.json`.
- **MCP config is vault-local** — `.pivi/mcp.json` only; no global host MCP discovery. MCP OAuth tokens are stored under `.pivi/mcp-oauth/` in the vault.
- **File changes are recoverable** — Pivi integrates with the Obsidian CLI history command system so that any tool edits or file mutations can be easily listed and restored.
- **`command` and `eval` tools are disabled by default** — must be explicitly enabled in settings, with optional allowlists.
- **Skills are vault-local** — installed under `.pivi/skills/`; no cross-vault or global skill directories.
- **No Pivi telemetry** — Pivi does not send telemetry to this project or the plugin author. Your configured model providers, MCP servers, GitHub, and skills.sh may have their own logging and privacy policies.

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

Releases are normally managed by [release-please](.github/workflows/release-please.yaml). Use Conventional Commits on `main`; release-please opens a release PR that updates version metadata and generates `CHANGELOG.md`. Merging that PR creates the GitHub release notes and uploads plugin artifacts. Obsidian requires the GitHub release tag to exactly match `manifest.json.version` with no leading `v` (for example `0.3.0`, not `v0.3.0`).

The [release workflow](.github/workflows/release.yaml) is a manual/tag fallback. It builds the plugin, reads notes from the matching `CHANGELOG.md` section, and uploads `main.js`, `manifest.json`, and `styles.css` to GitHub Releases.

## License

MIT. This repo is adapted from [Claudian](https://github.com/YishenTu/claudian) (MIT).

See [LICENSE](LICENSE) for details.

## Acknowledgments

- [Pi agent core](https://github.com/earendil-works/pi-mono) — The Pi agent runtime that powers Pivi
- [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) — Agent Skills for Obsidian
- [Claudian](https://github.com/YishenTu/claudian) — Code lineage this version is adapted from
- [Agent Skills](https://agentskills.io) — The Agent Skills specification
- [skills.sh](https://skills.sh) — Skills distribution CLI
- [obsidianmd/obsidian-api](https://github.com/obsidianmd/obsidian-api) — Obsidian plugin API
- [lucide-animated](https://lucide-animated.com/) — Inspiration for lightweight animated subagent status icons

---

_Built for writers who want AI collaboration with nanometer precision, not black-box generation._
