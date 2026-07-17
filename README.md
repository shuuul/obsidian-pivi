<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/icons/pivi-p.svg">
    <img src="assets/icons/pivi-p.svg" alt="Pivi" width="64">
  </picture>
  <br>
  <strong>Pivi</strong> — <em>Pi as the Vault Intelligence</em>
</p>

<p align="center">
  An AI agent that lives inside Obsidian — no separate app, no terminal,
  no coding-mode interruptions. Chat with your notes, edit with precision,
  and extend through tools built for knowledge work, not software engineering.
</p>

<p align="center">
  <a href="https://github.com/shuuul/obsidian-pivi/releases"><img src="https://img.shields.io/static/v1?label=version&message=0.11.6&color=blue" alt="version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT"></a>
  <a href="https://obsidian.md/plugins"><img src="https://img.shields.io/badge/Obsidian-Plugin-7C3AED?logo=obsidian&logoColor=white" alt="Obsidian plugin"></a>
</p>

<br>

![Pivi sidebar chat](assets/pivi-example-sm.png)

---

## Quick start

Install from [Obsidian Community Plugins](https://community.obsidian.md/plugins/pivi), add an API key in Settings → Pivi, and start chatting.

---

## Why Pivi?

✦ **No separate app, not a repurposed coding agent** — Pivi runs inside Obsidian as a vault-native AI — no desktop app, no terminal, no Claude Code / Codex mode. Built on Pi for knowledge work, not software engineering.

✦ **Obsidian-native tools** — Read, search, edit, link, and manage notes through tools that understand wikilinks, frontmatter, backlinks — not file paths.

✦ **No plan mode** — Pivi doesn't interrupt you with permission prompts or coding-agent plan approvals. Changes are recoverable through Obsidian trash and file history instead.

✦ **Vault skills** — Install [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) or other Agent Skills into `.pivi/skills/` to teach the agent your workflows.

✦ **MCP support** — Wire in vault-local MCP servers (`.pivi/mcp.json`), remote servers with OAuth, and use `/server` or `/server/tool` slash tokens in chat.

✦ **Privacy first** — API keys stored in Obsidian's secretStorage (Electron safeStorage). Or run fully local with Ollama, LM Studio, or llama.cpp. No Pivi telemetry.

---

## Features
### 💬 Sidebar chat
Multi-tab conversational AI with streaming, file context, slash commands, and model switching. Sessions persist as Pi-compatible JSONL under `.pivi/sessions/` — resume a complete linear session or fork a new session file from an earlier entry.

Attach vault files or explicitly allowed external folders as turn context. External folders require external read access and can be pinned on this device without syncing their absolute paths into settings or session history.

### ✏️ Inline editing
Select text, run a rewrite — Pivi uses auxiliary queries to edit with precision, no context window overhead, no conversation history pollution.

### 🛠️ Obsidian-native tools
Vault note operations prefer Obsidian's public plugin APIs. Capabilities that Obsidian does not expose publicly use explicit CLI, network-provider, MCP, or allowlisted process integrations as noted below.

<details>
<summary><strong>All tools</strong></summary>

| Tool | What it does |
|------|-------------|
| `obsidian_read` | Read note bodies with line/char limits |
| `obsidian_markdown_structure` | Extract headings and section sizes from a note |
| `obsidian_search` | Substring search, tags, folder listing |
| `obsidian_note_info` | Metadata, tags, links, frontmatter |
| `obsidian_links` | Outgoing links and backlinks for a note |
| `obsidian_list` | List vault folder contents |
| `obsidian_attachment` | Attachment metadata and paths |
| `obsidian_daily` | Read, append to, or open the daily note (requires the official Obsidian CLI) |
| `obsidian_graph` | Analyze orphans, dead ends, and unresolved links |
| `obsidian_tags` | List tags and inspect tagged notes |
| `obsidian_base` | List Bases, inspect views, or run CLI-backed Base queries |
| `obsidian_edit` | Replace text in an existing note |
| `obsidian_write` | Create or overwrite notes |
| `obsidian_properties` | List, read, set, or remove frontmatter properties |
| `obsidian_delete` | Move files or folders to trash |
| `obsidian_move` | Rename or move files, update links |
| `obsidian_mkdir` | Create a vault folder |
| `obsidian_history` | List, read, and restore file-history snapshots (requires the official Obsidian CLI) |
| `obsidian_tasks` | List or update Markdown task status (requires the official Obsidian CLI) |
| `obsidian_open` | Open a file in the Obsidian workspace |
| `obsidian_read_external` | Read files outside the vault (off by default) |
| `obsidian_list_external` | List external directories (off by default) |
| `obsidian_bash` | Run an allowlisted shell command (off by default) |
| `obsidian_command` | Execute an Obsidian command by id (off by default) |
| `obsidian_eval` | Run JavaScript in Obsidian context (off by default) |
| `obsidian_generate_image` | Generate images with Codex, save as attachments |
| `WebSearch` | Search the web (Brave, Tavily, Exa, AnySearch) |
| `WebFetch` | Fetch readable content from a URL |
| `mcp` | Call vault-local MCP servers |
| `skill` | Load vault-local Agent Skills |
| `spawn_agent` | Delegate tasks to a subagent |

</details>

### 🔌 Skills & MCP
- **Vault skills**: Install Agent Skills into `.pivi/skills/` after confirmation. Add more via `npx skills add`.
- **MCP servers**: Configure in `.pivi/mcp.json` — stdio or remote HTTP/SSE servers with OAuth support. Test connections, inspect available tools, and enable or disable individual tools from settings.
- **`/server` slash tokens**: Type `/server` or `/server/tool` in chat to emphasize an MCP server or tool; settings-enabled servers are already available to the agent.
- **`/generate-image` tool token**: When Codex image generation is connected and `obsidian_generate_image` is enabled under Tools, the slash selector inserts this durable token. Pivi expands it only in the API prompt; the composer and session keep `/generate-image` unchanged.

### 🧠 Subagents
Run concurrent subagents with configurable limits (`maxConcurrentSubagents`) and background permissions (`allowBackground`). Delegate research, analysis, or writing tasks while you keep working.

### 🌐 Web search & fetch
Query Brave, Tavily, Exa, or AnySearch in the configured provider order. Fetch URL content through the same ordered provider queue. Public Exa search and direct HTTP fetch remain terminal fallbacks.

### 🎨 Image generation
With `openai-codex` credentials connected, generate images, save them as vault attachments, and insert standard Markdown image embeds into notes.

### 📂 Session history
Pi-compatible JSONL session persistence. Sessions are linear per tab; fork creates a new session file from a selected entry. All session state is rebuildable from `.pivi/sessions/`.

### 🎛️ Style Settings support
With the [Style Settings](https://github.com/obsidian-community/obsidian-style-settings) plugin installed, customize chat typography — message, composer, welcome, and assistant heading font sizes. Open it directly from **Settings → Pivi → Integrations → Style Settings**.

### 🧰 Note Toolbar support
Add the current editor selection or a custom Pivi command to an installed [Note Toolbar](https://github.com/chrisgurney/obsidian-note-toolbar) selected-text toolbar. Pivi can add commands through the official Obsidian CLI, or guide you through manual setup.

### ⚙️ Obsidian CLI integration
Optional integration with the official Obsidian CLI powers history, tasks, daily notes, Base queries, command execution, JavaScript evaluation, and Note Toolbar command-item setup. The binary path and timeout are configurable in settings; individual command/eval capabilities remain separately gated.

> [!NOTE]
> Upgrade note: installations that never saved an Obsidian CLI preference now treat the integration as disabled. Re-enable it in Pivi settings to restore CLI-backed history, tasks, daily-note, Base-query, command, and evaluation features.

---

## Installation

Install from [Obsidian Community Plugins](https://community.obsidian.md/plugins/pivi).

On first launch with no vault skills installed, Pivi asks before installing [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) into `.pivi/skills/`. You can skip the prompt and install skills later from settings.

---

## Requirements

- **Obsidian** v1.12.0+ (desktop only)
- **macOS** (tested; Windows / Linux should work but not officially supported)

---

## Documentation

- [Developer handbook](docs/README.md) — architecture, technology choices, feature flows, and contribution routes
- [Input panel and context](docs/04-input-panel-and-context.md) — composer, selectors, context indicators, and prompt construction
- [Tabs, sessions, and history](docs/05-tabs-sessions-and-history.md) — tab switcher, persistence, restore, and fork
- [Subagents, streaming, and rendering](docs/06-subagents-streaming-and-rendering.md) — delegated execution, concurrency, events, and persistence
- [Tools, skills, MCP, and integrations](docs/07-tools-skills-mcp-and-integrations.md) — capability registry, security gates, and Note Toolbar
- [AGENTS.md](AGENTS.md) — repo operations and coding standards
<details>
<summary><strong>Security & privacy</strong></summary>

| Area | Policy |
|------|--------|
| **API keys** | Required for hosted AI providers. Stored via Obsidian `secretStorage` (Electron `safeStorage`), not in plugin JSON or `.pivi/mcp.json`. |
| **Network use** | Prompts, vault context, attachments, tool results, and MCP results may be sent to the selected model provider. |
| **Image generation** | Available only with `openai-codex` credentials. Prompts go to ChatGPT / Codex backend. Images saved as vault attachments. |
| **MCP** | User-provided servers. Enabled remote HTTP/SSE servers may receive inventory requests during startup/settings refresh. Stdio commands run only after explicit **Connect / refresh tools** or the agent's first search/list/call. |
| **Skills** | Listing, installing, or updating remote skills uses `npx skills` / `skills.sh`. Default prompt accesses `kepano/obsidian-skills` only after confirmation. |
| **External file access** | Disabled by default. Allowed absolute roots come from this device's vault-local overlay or folders attached for the current turn; they are not synced through `.pivi/settings.json` or session JSONL. |
| **Bash access** | Disabled by default. Allowlisted one-line commands only; rejects shell control syntax. |
| **Obsidian CLI** | Disabled by default. When enabled, Pivi starts the configured official Obsidian CLI for the specific CLI-backed tools listed above. |
| **Vault index** | File mentions, search, graph, tags, and properties enumerate vault metadata and file paths locally; Pivi does not send an index to its author. |
| **System environment** | Read only at desktop integration boundaries for configured provider credentials, MCP authentication/stdio variables, the official CLI, and Skills tooling. Pivi does not transmit machine identity to its author. |
| **Clipboard** | MCP import accepts JSON pasted into an editor and never invokes the clipboard-read API. Writes occur only after explicit copy actions. |
| **MCP config location** | Vault-local — `.pivi/mcp.json` only. OAuth tokens under `.pivi/mcp-oauth/`. |
| **Skills location** | Vault-local — `.pivi/skills/`. No cross-vault or global directories. |
| **File recovery** | Edits use Obsidian APIs, deletes go to trash, `obsidian_history` can list/read/restore file-history snapshots. |
| **Telemetry** | Pivi sends none to the plugin author or this project. |

</details>



## Acknowledgments

- [Pi agent core](https://github.com/earendil-works/pi-mono) — The Pi agent runtime that powers Pivi
- [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) — Agent Skills for Obsidian
- [Claudian](https://github.com/YishenTu/claudian) — Code lineage this version is adapted from
- [Agent Skills](https://agentskills.io) — The Agent Skills specification
- [skills.sh](https://skills.sh) — Skills distribution CLI
- [obsidianmd/obsidian-api](https://github.com/obsidianmd/obsidian-api) — Obsidian plugin API
- [lobe-icons](https://github.com/lobehub/lobe-icons) — Provider and model icon set
- [lucide-animated](https://lucide-animated.com/) — Inspiration for lightweight animated subagent status icons

---
<p align="center">
  <em>Built for writers who want AI collaboration with nanometer precision, not black-box generation.</em>
</p>
