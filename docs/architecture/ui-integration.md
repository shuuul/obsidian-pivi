# UI integration

## Purpose

Bind Obsidian views, modals, and settings to core ports without importing Pi.

## Responsibilities

- `ObsiusView` / `TabManager` — chat tabs, service lifecycle.
- `InputController` — send, queue, built-ins (`/mcp-auth`), approvals.
- `MessageRenderer` / tool renderers — stream display.
- `ObsiusSettings` — providers, MCP list, env snippets.
- `InlineEditModal` — selection-based edit via auxiliary service.
- `InlineContext` composer tokens — explicit editor selections attached from the chat toolbar and serialized into the next turn.

## Non-responsibilities

- Agent loop implementation.
- MCP wire protocol.

## Interfaces

Features use:

- `AgentWorkspace.getMcpServerManager()`, `getMcpOAuth()`
- `ChatRuntime` from tab service
- `RuntimeCapabilities` for feature flags

## Design

Strict import rule: `src/features/**` → `src/core/**` only. Bootstrap in `main.ts` wires `piWorkspaceRegistration`. MCP toolbar and mention dropdown are gated on `supportsMcpTools`.

Inline context belongs in the chat UI layer as provider-neutral input state. The current implementation snapshots the selected range from the toolbar action, inserts a composer-text token (`@[obsius-inline-context:...]`), extracts that token into `ChatTurnRequest.inlineContexts`, and leaves prompt serialization to core runtime helpers. The earlier lavender-chip/editor-context-menu UX is deferred; see [inline-context-input-panel-spec.md](../specs/inline-context-input-panel-spec.md).

## Failure modes

| Failure | Mitigation |
|---------|------------|
| Runtime not ready | `ensureServiceInitialized` + notices |

## Related

- [system-architecture.md](./system-architecture.md)

## Related specs

- [inline-context-input-panel-spec.md](../specs/inline-context-input-panel-spec.md)

## Stable UI seams

### Chat tabs

`ObsiusView` owns the Obsidian `ItemView`; `TabManager` owns tab creation, switching, closing, restore, fork, and persisted tab layout. A tab is a data object composed by `createTab()`: state, controllers, renderers, input managers, toolbar controls, and a runtime reference are all wired explicitly.

Durable tab binding is session-oriented: plugin data stores `sessionFile`, `leafId`, and draft UI state such as selected model. In-memory `openSessionId` / `OpenSessionState` projections are rebuildable and should not become the durable identity.

### Controllers, state, and rendering

Controllers translate UI events and runtime stream chunks into state/rendering calls. `ChatState` is the feature-local projection for visible messages, pending tools, streaming flags, todos, usage, and render handles. Renderers own DOM output and accessibility details; controllers should not reach into Pi-specific event types.

The key separation is:

```mermaid
flowchart LR
  UI["UI managers<br/>composer/toolbar/context"] -- "events" --> Controllers["controllers"]
  Controllers -- "core contracts" --> Runtime["ChatRuntime port"]
  Runtime -- "StreamChunk" --> Controllers
  Controllers -- "state updates" --> State["ChatState"]
  Controllers -- "render calls" --> Renderers["rendering/"]
```

### Prompt/display boundary

Feature UI gathers user-visible input, attachments, MCP enabled servers, and inline-context tokens. `inputTurnSubmission` converts that into `ChatTurnRequest`; core runtime helpers build `PreparedChatTurn` and preserve separate display/API prompt data. Do not store MCP-transformed prompt text or inline-context XML as the visible user message.

### Settings UI

`ObsiusSettings` composes plugin settings. Runtime-specific settings sections are rendered through `AgentWorkspace` / Pi workspace services, not direct feature imports from `src/pi/ui/**`.

### Shared UI and mention system

`src/shared/` contains reusable widgets, modals, and mention infrastructure. These helpers stay provider-agnostic and may be used by chat, inline edit, and settings.

## Operational rules

- Use Obsidian DOM helpers and scoped `.obsius2-*` CSS classes.
- Icon buttons and collapsible regions need accessible labels, keyboard support, and visible focus states.
- Managers that register DOM events, timers, editor highlights, or runtime callbacks must expose cleanup through the owning tab/modal lifecycle.
- Use active document/window patterns where popout compatibility matters.
- Keep feature-level implementation maps in local `AGENTS.md` files rather than expanding this architecture document.

## Local context files

- [`../../src/features/AGENTS.md`](../../src/features/AGENTS.md)
- [`../../src/features/chat/AGENTS.md`](../../src/features/chat/AGENTS.md)
- [`../../src/features/chat/tabs/AGENTS.md`](../../src/features/chat/tabs/AGENTS.md)
- [`../../src/features/chat/controllers/AGENTS.md`](../../src/features/chat/controllers/AGENTS.md)
- [`../../src/features/chat/rendering/AGENTS.md`](../../src/features/chat/rendering/AGENTS.md)
- [`../../src/features/chat/ui/AGENTS.md`](../../src/features/chat/ui/AGENTS.md)
- [`../../src/features/settings/AGENTS.md`](../../src/features/settings/AGENTS.md)
- [`../../src/shared/AGENTS.md`](../../src/shared/AGENTS.md)
