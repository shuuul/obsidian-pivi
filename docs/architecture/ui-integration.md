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

## Related

- [system-architecture.md](./system-architecture.md)

## Related specs

- [inline-context-input-panel-spec.md](../specs/inline-context-input-panel-spec.md)

## Tab System

### Responsibilities

- **TabData** (`tabs/types.ts`) — Core data type holding a tab's identity, lifecycle state, conversation references, draft model, all controller references, UI components, renderer, and mode state. Lifecycle states form a directed graph: `blank → bound_cold/active → inactive → closing`. Each state transition is explicit (`deactivateTab`, `activateTab`, `destroyTab`).
- **createTab()** (`tabs/Tab.ts`) — Factory function that assembles a complete tab: creates `ChatState`, builds DOM (messages area, input toolbar, context row, status panel), initializes all controllers and context managers, wires toolbar components and slash command dropdown, and starts selection polling. Tabs are data-driven, not class-instance-driven.
- **TabManager** (`tabs/TabManager.ts`) — Coordinates the full set of tabs: create, close, switch, reorder (recently-used with teleport). Manages view lifecycle against the `ObsiusView` host. Handles fork workflows (`ForkTargetModal` → new tab), settings-initiated cleanup, and persisted tab state in plugin data.
- **TabBar** (`tabs/TabBar.ts`) — Minimal numbered badge navigation. Renders badges with state CSS classes (`active`, `attention`, `streaming`, `idle`) for at-a-glance status. Click to switch, close button per tab.
- Supporting modules (`tabFork.ts`, `tabPlanMode.ts`, `tabAutoTurn.ts`, `tabRuntime.ts`, `tabAgentContext.ts`, `tabControllerInit.ts`, `tabSlashCatalog.ts`) — Fork workflow, plan mode toggle, auto-turn, runtime service initialization, agent-context helpers, controller wiring, and slash command catalog sync.

### Design

`createTab()` is the single entry point for tab assembly. It receives a `ChatRuntime` and optional session file, then wires every subsystem: controllers receive their dependencies (state, DOM elements, services) at construction; no post-hoc injection. `TabManager` owns the tab array and delegates DOM management to `ObsiusView`. Tab state is serializable to plugin data via `TabData` snapshots, enabling session restoration across Obsidian restarts.

---

## Controllers

### StreamController (`controllers/stream/`)

Manages the streaming lifecycle: tool calls, subagents, and render queue coordination.

#### Responsibilities

- Handles thinking blocks, tool call rendering, write/edit live updates, and subagent streaming chunks.
- Coordinates between `ChatState` (state), `MessageRenderer` (DOM), and `SubagentManager` (subagents).
- Manages text/thinking render queues via `StreamRenderQueue`.

#### Supporting modules

- `streamMessageUpdates.ts` — Tool call registration, result status updates, and streaming merge into rendered messages.
- `streamRenderQueue.ts` — `StreamRenderQueue`: debounced render dispatching using animation frames.
- `streamToolUseRouting.ts` — Routes `tool_use` chunks by tool name to the correct renderer.
- `streamSubagentLifecycle.ts` — Subagent lifecycle events: `ask_approval`, `resume`, `exit_plan_mode`.
- `streamActiveModel.ts` — Model resolution during streaming (which model is generating the current response).
- `streamUsageFilter.ts` — Usage/credit tracking filter that distinguishes subagent sessions from parent sessions.

### SelectionController (`controllers/selection/`)

Polls the active Markdown editor for cursor and selection changes. Renders an indicator chip (editor icon) in the context row when a note is active. Supports an input-handoff grace period. Highlights selections in the editor using CodeMirror's custom highlight registry under the `obsius2-selection` key. Polling stops when the tab is inactive.

### BrowserSelectionController (`controllers/selection/`)

Polls browser selection from the embedded web view (if present) and renders an indicator icon in the context row. Parallel in structure to `SelectionController` but sources data from the web view rather than the Markdown editor.

### CanvasSelectionController (`controllers/selection/`)

Polls canvas node selection and renders an indicator icon in the context row. Follows the same polling pattern but sources data from Obsidian's canvas API.

### NavigationController (`controllers/navigation/`)

Keyboard navigation within the messages area: arrow-up/down for scrolling, Escape to focus the input. Tracks scroll direction, uses animation frames for smooth scrolling. Settings-driven via `KeyboardNavigationSettings`.

### ConversationController (`controllers/conversation/`)

Orchestrates the full conversation lifecycle: create new, switch, save, load. Coordinates between `ChatState`, `MessageRenderer`, `SubagentManager`, and all context managers (file, image, inline). Handles welcome state (greeting) and initialization flows.

### InputController (`controllers/input/`)

Handles send/stop, queue management, slash commands, MCP-auth approvals, and provider boundary validation. Builds `ChatTurnRequest` with all context (files, images, inline selections, browser/canvas selection, MCP server enablement).

#### Supporting modules

- `contextRowVisibility.ts` — Updates context row CSS class based on active context.
- `inputQueue.ts` — Queued turns with merge support (text, images, inline contexts).
- `inputTurnSubmission.ts` — Builds `ChatTurnRequest` from context managers.
- `inputResumeCheckpoint.ts` — Resume session checkpoint helpers.
- `inputProviderBoundary.ts` — Provider boundary validation.

---

## State (`src/features/chat/state/`)

### ChatState

Central state container wrapping `ChatStateData` (immutable-style). Holds messages, streaming flags, current render elements, thinking state, tool call elements, write/edit states, todos, usage info, and pending tools. Fires callbacks on state changes (`onMessagesChanged`, `onStreamingChanged`, etc.). All controllers read from and write to `ChatState`; it is the single source of truth for tab UI state.

---

## Services (`src/features/chat/services/`)

### SubagentManager

Manages subagent lifecycle. Creates sync/async subagent blocks from tool calls (`TOOL_TASK`). Tracks spawned count, handles pending tasks, provides streaming state. Coordinates with `SubagentRenderer` for DOM creation. Subagents run in the same runtime but produce separate streaming chunks that the `StreamController` routes through `streamSubagentLifecycle.ts`.

---

## Rendering (`src/features/chat/rendering/`)

### MessageRenderer

Main renderer for `ChatMessage[]` arrays. Handles full re-render and incremental append. Integrates all sub-renderers (thinking blocks, tool calls, write/edit, subagents). Renders markdown content, file links, image embeds, and mention badges. Plugs in two context-menu extensions: Rewind (right-click to rewind to a message) and Fork (fork the conversation from a message).

### ToolCallRenderer

Renders individual tool calls as collapsible blocks with icon, name, summary, status, and expandable content. Handles tool-specific content: bash output, diffs, todo status, web search results, Obsidian-native tool results, and more. Content type is dispatched based on the tool name.

### SubagentRenderer

Creates and manages subagent DOM blocks (sync and async). Each block shows a header (label + status), collapsible prompt section, tools container, and result section. Supports lifecycle events: orphaned (parent message removed) and finalized (subagent completed).

### ThinkingBlockRenderer

Renders the "Thinking Xs..." collapsible block. A timer updates the displayed duration every second while the assistant is actively thinking. Collapsed by default, toggleable by click or keyboard.

### WriteEditRenderer

Renders write/edit tool blocks showing the file path, diff stats (lines added/removed), and inline diff content. Manages expansion state and live diff updates during streaming to reflect accumulated changes as new chunks arrive.

### DiffRenderer

Renders unified diff content with color-coded additions (green) and deletions (red), plus file-level stats (+/- lines). Used by `WriteEditRenderer` and `ToolCallRenderer` for diff display.

### Other rendering modules

- `collapsible.ts` — Shared collapsible UI behavior (used by tool calls, subagents, thinking blocks).
- `obsiusToolDisplay.ts` — Obsidian-native tool display names and summary formatters.
- `subagentLifecycleResolution.ts` — Resolves `SubagentLifecycleAdapter` (plan mode, exit).
- `InlineAskUserQuestion.ts` / `InlineExitPlanMode.ts` / `InlinePlanApproval.ts` — Inline approval and plan-mode renderers embedded in the message stream.
- `todoUtils.ts` — Todo item DOM rendering utilities.

---

## UI Components (`src/features/chat/ui/`)

### RichChatInput

Contenteditable composer with inline mention badge support and a textarea-compatible API. Uses composition-aware input handling for IME support. Supports mention badge sync (insertion, deletion, backspace handling), inline context tokens, and placeholder text.

### InputToolbar

Contains the model selector (dropdown with provider icons), mode selector (chat/plan/auto), thinking budget/level selectors, permission mode toggle, external context selector, and MCP server enablement. Also houses `InlineContextManager` for editor selection attachment to the current turn.

### InputSendButton

Single button that toggles between send (arrow-up icon) and stop (square icon) based on streaming state. Disabled when no input is present.

### StatusPanel

Persistent bottom panel with two collapsible sections: Todo list (populated by `todo-write` tool calls) and bash command output. Mounted below the messages area, remounts on conversation switch to display the active session's state.

### FileContextManager (`FileContext.ts`)

Manages file and folder context chips displayed in the input panel. Auto-attaches the active note. Integrates `MentionDropdownController` for `@`-mention autocomplete (files, folders, MCP servers, agents). Handles file rename and delete events to keep context chips consistent.

### ImageContextManager (`ImageContext.ts`)

Manages image attachments via drag-and-drop and clipboard paste. Shows image preview chips in the context row. Each chip shows a thumbnail and a remove button.

### InlineContextManager (`InlineContext.ts`)

Captures editor selection snapshots and inserts them as composer-text inline context tokens (`@[obsius-inline-context:...]`). Invoked from the input toolbar's inline context button. The tokens are rendered as mention badges in the composer.

### NavigationSidebar

Sidebar navigation for the chat view. Provides tab-level navigation alongside the tab bar.

### Textarea resize utility

Auto-resizes the `RichChatInput` textarea on content change to prevent scroll overflow inside the composer.

---

## Mention System (`src/shared/mention/`)

### MentionDropdownController

Dropdown for `@`-mention autocomplete. Supports file, folder, MCP server, and agent mentions. Filters suggestions as the user types, shows a selected item, and triggers a callback on selection. Reused in both the chat input and the inline-edit modal.

### VaultMentionCache

Caches vault files (`TFile[]`) and folder structures for fast mention resolution. Implemented as `VaultFileCache` and `VaultFolderCache` with dirty-marking and async background initialization. Caches are invalidated on vault changes.

### VaultMentionDataProvider

Wraps `VaultFileCache` and `VaultFolderCache` as a data provider for mention dropdowns. Provides file search with path-based matching for partial filename queries.

### Mention badge system

- `mentionBadgeTypes.ts` — Type definitions for mention badges and parse context.
- `mentionBadgeLabels.ts` — Label helpers (`getFolderLabel`, `getMcpServerLabel`, etc.).
- `inlineMentionBadgeDom.ts` — DOM operations for inline mention badges in the composer.
- `renderMentionBadges.ts` — Renders mention badges in messages and input.
- `parseMessageMentions.ts` — Parses `@`-mentions from message text.
- `expandFolderMentions.ts` — Expands folder mentions into individual file paths.
- `composerInputTypes.ts` — `ComposerInput` interface for contenteditable input handling.

---

## Settings Panels (`src/features/settings/`)

### ObsiusSettings (`ObsiusSettings.ts`)

Main settings tab with sub-tabs: General, Chat, Hotkeys, Providers. Built with the Obsidian `Setting` API. Tabs managed via `ObsiusSettingTab` with a custom tab bar UI.

### McpSettingsManager (`ui/McpSettingsManager.ts`)

MCP server list management: add, edit, delete servers, test connection, view auth status. Each server row shows the name, transport type, and status badge (connected / error / untested).

### McpServerModal (`ui/McpServerModal.ts`)

Modal for adding or editing an MCP server: type (stdio / http / sse), command, arguments, environment variables, disabled tools, and OAuth configuration.

### McpTestModal (`ui/McpTestModal.ts`)

Modal for testing MCP server connectivity: shows connection status, the list of advertised tools, and any error details.

### EnvironmentSettingsSection (`ui/EnvironmentSettingsSection.ts`)

Environment variable management: global and per-provider environment variables, with a review warning before applying changes.

### EnvSnippetManager (`ui/EnvSnippetManager.ts`)

Snippet manager for provider environment variables: list, add, insert, edit, and delete reusable environment variable snippets.

---

## Shared UI Components (`src/shared/`)

### SlashCommandDropdown

Dropdown UI for slash commands (`/clear`, `/resume`, `/fork`, `/mcp-auth`, `/skill:name`, etc.). Supports custom commands via `CreateCommandModal`.

### ForkTargetModal

Modal for choosing a fork target location: new tab vs. current tab.

### SelectableDropdown

Generic keyboard-navigable dropdown component. Supports filter, selection, and scroll-into-view for long lists.

### SelectionHighlight

CodeMirror selection highlight abstraction: show, hide, and delete highlights in the editor via the `obsius2-selection` highlight registry.

---

## Related directories

- `src/features/chat/controllers/`
- `src/features/chat/state/`
- `src/features/chat/services/`
- `src/features/chat/rendering/`
- `src/features/chat/ui/`
- `src/features/chat/tabs/`
- `src/features/settings/`
- `src/shared/mention/`
- `src/shared/`
