# `src/pi/` — Pi agent adaptor (`pi-agent-core`)

Pi adaptor implementation: in-process `Agent`, streaming runtime, settings, and workspace services. Wired into `AgentServices` / `AgentWorkspace` from `main.ts` at startup.

## Adapter map

```mermaid
flowchart TD
  Bootstrap["bootstrap.ts"] -- "registers" --> Services["core facades<br/>AgentServices + AgentWorkspace"]
  Runtime["runtime/PiChatRuntime.ts"] -- "creates" --> Agent["pi-agent-core Agent"]
  Runtime -- "uses" --> Tools["tools/<br/>Obsidian + MCP + skill + subagent"]
  Runtime -- "reads/writes" --> Session["session/<br/>JSONL session bridge"]
  Workspace["app/PiWorkspaceServices.ts"] -- "creates" --> Mcp["mcp/<br/>bridge + OAuth + storage"]
  Workspace -- "creates" --> Skills["skills/<br/>vault skill provider"]
  Workspace -- "renders" --> UI["ui/ + settings.ts<br/>provider settings"]
```

## Key Files

- `bootstrap.ts` — `bootstrapPiAgent()` registers chat-facing services
- `app/PiWorkspaceServices.ts` — Workspace services (settings tab, command catalog hooks)
- `runtime/PiChatRuntime.ts` — Chat runtime using `pi-agent-core` / `pi-ai`
- `runtime/PiAgentEventAdapter.ts` — Stream chunk translation
- `ui/PiChatUIConfig.ts` — Model selector, reasoning controls, provider icon
- `settings.ts` — Pi agent settings persisted inside `ObsiusSettings.agentSettings`

## Patterns

- Depends only on `src/core/` ports — never on `src/features/`
- Direct imports of `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, and `@earendil-works/pi-coding-agent` belong in this adapter tree (`src/pi/**`) or tests only. Do not re-export those package types through core/app/feature/shared APIs.
- Bootstrap in `main.ts` calls `bootstrapPiAgent()` (installs workspace + agent registration)
- Obsidian-native tools prefer in-process `ObsidianVaultApi`; CLI transport is fallback or opt-in power surface
- MCP servers are exposed to the model through one proxy AgentTool named `mcp`
- Provider OAuth (`auth/`) and MCP OAuth (`mcp/oauth/`) are separate concerns
- Provider credentials are owned by `auth/` + `pi-ai` credential stores (Obsidian secret storage); MCP OAuth tokens are owned by `mcp/oauth/` under `.obsius/mcp-oauth/`. Keep these stores and token types separate.
