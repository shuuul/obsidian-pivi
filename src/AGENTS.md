# `src/` — Obsius application layer

> Auto-generated sections updated for Pi-only layout.

## Overview

Hexagonal application layer for the Obsius Obsidian plugin (Pi agent in sidebar + inline edit). `core/` holds ports; `pi/` is the sole adaptor; `features/` is Obsidian UI.

## Key Files

- `main.ts` — Plugin entry: installs Pi into registries, registers view/settings/commands
- `core/agent/types.ts` — Agent ports (`ProviderRegistration`, UI config, workspace services)
- `core/runtime/ChatRuntime.ts` — Chat runtime contract implemented by `pi/runtime/PiChatRuntime`
- `features/chat/ObsiusView.ts` — Sidebar chat view and tab orchestration
- `pi/registration.ts` — Pi `ProviderRegistration` wired at startup

## Patterns

- `features/` imports only `core/` — never `pi/` directly
- `main.ts` and `app/settings/` bootstrap `pi/` into `ProviderRegistry` / `ProviderWorkspaceRegistry`

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `app/` | Settings storage and shared app services |
| `core/` | Ports, types, registries |
| `features/` | Obsidian UI (chat, settings, inline edit) |
| `pi/` | Pi adaptor |
| `shared/` | Shared UI utilities |
| `style/` | CSS modules |
| `i18n/` | Locales |
| `utils/` | Helpers |
