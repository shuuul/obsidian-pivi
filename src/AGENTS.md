# `src/` — Pivi application layer

Pi-only TypeScript application for the Obsidian plugin. `main.ts` is the composition root: it patches renderer compatibility, loads settings/storage, creates Pi workspace services, and registers views, commands, inline edit, and settings.

## Layering rules

```mermaid
flowchart TB
  subgraph Obsidian["Obsidian"]
    Main["main.ts<br/>composition root"]
    View["PiviView / features"]
  end

  subgraph Pi["pi/"]
    Runtime["PiChatRuntime"]
    MCP["PiMcpBridge + OAuth"]
    Aux["PiAuxQueryRunner"]
    Types["types / settings / prompts"]
  end

  Vault[(".pivi/<br/>mcp.json + mcp-oauth + sessions")]
  App["app/<br/>settings + storage"]
  Shared["features/shared/<br/>UI primitives"]
  Utils["utils/<br/>cross-cutting helpers"]
  I18n["i18n/<br/>locale bundle"]
  Style["style/<br/>CSS modules"]

  Main -- "registers" --> View
  Main -- "loads/persists" --> App
  Main -- "creates" --> Runtime
  View -- "Pi product services" --> Runtime
  View -- "shared widgets" --> Shared
  View -- "helpers" --> Utils
  View -- "localized text" --> I18n
  View -- "classes styled by" --> Style
  Runtime -- "uses" --> MCP
  MCP -- "persists" --> Vault
  Runtime -- "uses" --> Aux
  Pi -- "depends on" --> PiSDK["pi-agent-core / pi-ai"]
```

- `core/`: provider-neutral shared contracts and pure turn helpers used by Pi runtime and feature UI (`core/types`, `core/runtime`). It must not import `pi/` or `features/`.
- `features/`: Obsidian UI for chat, settings, and inline edit. May import Pivi-owned Pi product modules; prefer explicit dependencies. `features/shared/` contains reusable UI widgets, mention infrastructure, and modals.
- `app/`: plugin settings/storage/session/view helpers. Use Pi settings/session services directly where product behavior is Pi-owned; concrete Obsidian file adapters live here and implement storage ports.
- `utils/`: cross-cutting helpers and explicit platform patches. Avoid moving domain decisions here when they belong in `pi/`.
- `i18n/`: static JSON locale bundle, `t()`, locale state, and typed translation keys.
- `style/`: CSS modules imported through `style/index.css`; build fails if CSS files are not listed.

## Key entry points

- `main.ts` — Obsidian `Plugin` entry, commands, view registration, lifecycle persistence.
- `pi/app/PiWorkspaceServices.ts` — MCP, OAuth, skills, slash catalog, model readiness, and settings renderer.
- `pi/PiSettingsCoordinator.ts` — Pi settings projection and model/reasoning/permission normalization.
- `core/runtime/ChatRuntime.ts` — chat runtime contract used by tabs/controllers; keep it limited to feature-facing lifecycle and stream needs.
- `features/chat/PiviView.ts` — sidebar `ItemView` and multi-tab shell.
- `features/inline-edit/ui/InlineEditModal.ts` — CodeMirror inline-edit UI and service orchestration.
- `features/settings/PiviSettings.ts` — settings tab composition.
- `pi/runtime/PiChatRuntime.ts` — Pi `Agent` lifecycle and streaming bridge.
- `pi/tools/buildAgentToolRegistry.ts` — Obsidian tools, MCP proxy, skills, subagent tools.
- `pi/mcp/McpServerManager.ts` — MCP context-saving and mention semantics.

## Representative turn flow

```mermaid
sequenceDiagram
  participant User
  participant UI as features/InputController
  participant RT as PiChatRuntime
  participant Turn as buildTurnPrompt
  participant Agent as Pi Agent
  participant MCP as PiMcpBridge

  User->>UI: Send message (@server)
  UI->>RT: prepareTurn(request)
  RT->>Turn: buildTurnPrompt + finalizeTurnPrompt
  Turn-->>RT: apiPrompt with @server MCP
  RT->>MCP: setActiveMentions
  RT->>Agent: prompt(apiPrompt)
  Agent->>MCP: mcp tool call
  MCP-->>Agent: tool result
  Agent-->>UI: stream chunks
```

## Gotchas

- `main.ts` must create Pi workspace services before views/settings need MCP, OAuth, skills, slash catalog, or model readiness.
- MCP context-saving servers are active only when mentioned (`/server/tool` token transformed for the API prompt) or toolbar-enabled.
- `PreparedChatTurn` keeps display and API prompts separate; do not store MCP-transformed prompt text as user-visible history.
- Obsidian-native tools should prefer in-process Obsidian APIs; CLI is fallback or developer/power-tool surface.
- Adding locales requires updating locale JSON, `src/i18n/types.ts`, and the single metadata source `SUPPORTED_LOCALES` in `src/i18n/constants.ts`.
