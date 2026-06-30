# `src/` — Pivi application layer

Hexagonal TypeScript application for the Obsidian plugin. `main.ts` is the composition root: it patches renderer compatibility, calls `bootstrapPiAgent()`, loads settings/storage, initializes `AgentWorkspace`, and registers views, commands, inline edit, and settings.

## Layering rules

```mermaid
flowchart TB
  subgraph Obsidian["Obsidian"]
    Main["main.ts<br/>composition root"]
    View["PiviView / features"]
  end

  subgraph Core["core/"]
    Ports["Ports: ChatRuntime, MCP, prompts"]
    Types["types / settings"]
  end

  subgraph Pi["pi/"]
    Runtime["PiChatRuntime"]
    MCP["PiMcpBridge + OAuth"]
    Aux["PiAuxQueryRunner"]
  end

  Vault[(".pivi/<br/>mcp.json + mcp-oauth + sessions")]
  App["app/<br/>settings + storage"]
  Shared["shared/<br/>UI primitives"]
  Utils["utils/<br/>cross-cutting helpers"]
  I18n["i18n/<br/>locale bundle"]
  Style["style/<br/>CSS modules"]

  Main -- "registers" --> View
  Main -- "loads/persists" --> App
  Main -- "bootstraps" --> Runtime
  View -- "ports/facades only" --> Ports
  View -- "shared widgets" --> Shared
  View -- "helpers" --> Utils
  View -- "localized text" --> I18n
  View -- "classes styled by" --> Style
  Ports -- "implemented by" --> Runtime
  Runtime -- "uses" --> MCP
  MCP -- "persists" --> Vault
  Runtime -- "uses" --> Aux
  Pi -- "depends on" --> PiSDK["pi-agent-core / pi-ai"]
```

- `core/`: agent-neutral ports, runtime contracts, domain types, prompt/security/MCP semantics. Must not import `src/pi/` or `src/features/`.
- `pi/`: sole Pi adaptor. Implements `ChatRuntime`, system prompt/tools, MCP bridge/proxy, JSONL sessions, skills, provider settings/UI. Must not import `src/features/`.
- `features/`: Obsidian UI for chat, settings, and inline edit. Must not import `src/pi/`; use `core/agent/AgentServices` and `AgentWorkspace`.
- `app/`: plugin settings/storage/view helpers. Keep runtime-specific settings behavior behind `core/agent/AgentServices` registrations; do not import `src/pi/**` here.
- `shared/`: provider-agnostic UI widgets, mention infrastructure, and modals.
- `utils/`: cross-cutting helpers and explicit platform patches. Avoid moving domain decisions here when they belong in `core/`.
- `i18n/`: static JSON locale bundle, `t()`, locale state, and typed translation keys.
- `style/`: CSS modules imported through `style/index.css`; build fails if CSS files are not listed.

## Key entry points

- `main.ts` — Obsidian `Plugin` entry, commands, view registration, lifecycle persistence.
- `pi/bootstrap.ts` — installs Pi registrations into `AgentServices` and `AgentWorkspace`.
- `core/agent/AgentServices.ts` — chat-facing facade for runtimes, UI config, settings persistence, history/title/inline services.
- `core/agent/AgentWorkspace.ts` — workspace services for MCP, OAuth, skills, slash catalog, and settings renderer.
- `core/runtime/ChatRuntime.ts` — provider-neutral runtime contract.
- `features/chat/PiviView.ts` — sidebar `ItemView` and multi-tab shell.
- `features/inline-edit/ui/InlineEditModal.ts` — CodeMirror inline-edit UI and service orchestration.
- `features/settings/PiviSettings.ts` — settings tab composition.
- `pi/runtime/PiChatRuntime.ts` — Pi `Agent` lifecycle and streaming bridge.
- `pi/tools/buildAgentToolRegistry.ts` — Obsidian tools, MCP proxy, skills, subagent tools.
- `core/mcp/McpServerManager.ts` — MCP context-saving and mention semantics.

## Representative turn flow

```mermaid
sequenceDiagram
  participant User
  participant UI as features/InputController
  participant RT as PiChatRuntime
  participant Core as buildTurnPrompt
  participant Agent as Pi Agent
  participant MCP as PiMcpBridge

  User->>UI: Send message (@server)
  UI->>RT: prepareTurn(request)
  RT->>Core: buildTurnPrompt + finalizeTurnPrompt
  Core-->>RT: apiPrompt with @server MCP
  RT->>MCP: setActiveMentions
  RT->>Agent: prompt(apiPrompt)
  Agent->>MCP: mcp tool call
  MCP-->>Agent: tool result
  Agent-->>UI: stream chunks
```

## Gotchas

- Static registries are load-order sensitive: `bootstrapPiAgent()` and `AgentWorkspace.initializeAll()` must run before views need services.
- MCP context-saving servers are active only when mentioned (`/server/tool` token transformed for the API prompt) or toolbar-enabled.
- `PreparedChatTurn` keeps display and API prompts separate; do not store MCP-transformed prompt text as user-visible history.
- Obsidian-native tools should prefer in-process Obsidian APIs; CLI is fallback or developer/power-tool surface.
- Adding locales requires updating locale JSON, `src/i18n/types.ts`, and the single metadata source `SUPPORTED_LOCALES` in `src/i18n/constants.ts`.
