# `src/pi/` — Pi agent adaptor (`pi-agent-core`)

> Auto-generated sections updated for Pi-only layout.

## Overview

Pi adaptor implementation: in-process `Agent`, streaming runtime, settings, and workspace services. Wired into `AgentServices` / `AgentWorkspace` from `main.ts` at startup.

## Key Files

- `registration.ts` — `AgentAdaptor` for chat-facing services
- `app/PiWorkspaceServices.ts` — Workspace services (settings tab, command catalog hooks)
- `runtime/PiChatRuntime.ts` — Chat runtime using `pi-agent-core` / `pi-ai`
- `runtime/PiAgentEventAdapter.ts` — Stream chunk translation
- `ui/PiChatUIConfig.ts` — Model selector, reasoning controls, provider icon
- `settings.ts` — Pi agent settings persisted inside `ObsiusSettings.piSettings`

## Patterns

- Depends only on `src/core/` ports — never on `src/features/`
- Bootstrap in `main.ts` calls `AgentServices.install(piAgentAdaptor)` and `AgentWorkspace.install(piWorkspaceRegistration)`
