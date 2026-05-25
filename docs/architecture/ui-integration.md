# UI integration

## Purpose

Bind Obsidian views, modals, and settings to core ports without importing Pi.

## Responsibilities

- `ObsiusView` / `TabManager` — chat tabs, service lifecycle.
- `InputController` — send, queue, built-ins (`/mcp-auth`), approvals.
- `MessageRenderer` / tool renderers — stream display.
- `ObsiusSettings` — providers, MCP list, env snippets.
- `InlineEditModal` — selection-based edit via auxiliary service.
- `InlineContext` input-panel chips — explicit editor selections added from the Markdown editor context menu for the next chat turn, visually parallel to file/folder context chips.

## Non-responsibilities

- Agent loop implementation.
- MCP wire protocol.

## Interfaces

Features use:

- `AgentWorkspace.getMcpServerManager()`, `getMcpOAuth()`
- `ChatRuntime` from tab service
- `RuntimeCapabilities` for feature flags

## Design

Strict import rule: `src/features/**` → `src/core/**` only. Bootstrap in `main.ts` wires `piWorkspaceRegistration`. MCP toolbar and mention dropdown gated on `supportsMcpTools`.

Inline context belongs in the chat UI layer as provider-neutral input state. The editor context menu snapshots the selected range, the input panel renders a removable lavender chip, and `ChatTurnRequest` carries structured data; prompt serialization remains in core runtime helpers.

## Failure modes

| Failure | Mitigation |
|---------|------------|
| Runtime not ready | `ensureServiceInitialized` + notices |

## Related ADRs

- [ADR-0002](../adr/0002-hexagonal-ports-and-adapters.md)

## Related specs

- [inline-context-input-panel-spec.md](../specs/inline-context-input-panel-spec.md)

### Missing from this doc (2026-05-25 update)

The chat feature has grown significantly. Key components not yet documented:
- **StreamController** — manages streaming lifecycle (tool calls, subagents, render queue)
- **ConversationController** — manages conversation state and history
- **NavigationController** — sidebar navigation
- **SelectionController** / **BrowserSelectionController** / **CanvasSelectionController** — selection state
- **ChatState** — unified chat state management
- **SubagentManager** — parallel subagent orchestration
- **RichChatInput**, **InputToolbar**, **InputSendButton**, **StatusPanel** — input UI components
- **Tab system** — Tab, TabBar, TabManager with fork/plan/auto-turn modes
- **Renderers** — DiffRenderer, ToolCallRenderer, SubagentRenderer, ThinkingBlockRenderer, TodoListRenderer, WriteEditRenderer
- **Shared components** — ResumeSessionDropdown, ForkTargetModal, InstructionConfirmModal
- **Mention system** — VaultMentionCache, MentionDropdownController, mention badges
- **Settings panels** — McpServerModal, McpSettingsManager, McpTestModal, EnvironmentSettingsSection
