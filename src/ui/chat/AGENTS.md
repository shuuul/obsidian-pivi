*This file extends the root [AGENTS.md](../../../AGENTS.md). Follow root guidance first, then these local rules.*

# Chat UI subsystem

## Purpose

`src/ui/chat/` owns chat **runtime orchestration** and **explicit imperative adapters** under the React shell: session binding, turn composition, stream projection into `ChatUiStore`, and Markdown/tool/diff/ask-user/subagent bodies mounted into empty React slots. Obsidian view lifecycle, React shell/tabs/status/composer chrome/messages, and portal bridging live in `src/app/ui/PiviViewHost.ts` and `@pivi/obsidian-ui`.

This layer consumes injected host and runtime contracts; it does not construct the Pi engine, own durable session storage, implement tools, or own migrated product chrome.

## Architecture

```mermaid
flowchart TD
  View["src/app/ui/PiviViewHost<br/>Obsidian lifecycle + ImperativeChatAdapter"] --> Shell["@pivi/obsidian-ui<br/>React shell, tabs, status, composer chrome, MessageList"]
  View --> Tabs["tabs/<br/>tab lifecycle, session binding, portal scaffolds"]
  Tabs --> Controllers["controllers/<br/>input, session, selection, stream"]
  Tabs --> Composer["composer/<br/>turn capture and queueing"]
  Tabs --> Toolbar["toolbar/<br/>DOM-free runtime models → snapshots"]
  Tabs --> UI["ui/<br/>RichChatInput + context-chip adapters"]
  Tabs --> State["state/<br/>per-tab transient state + ChatUiStore"]
  Tabs --> Services["services/<br/>subagent presentation records"]

  Controllers --> Composer
  Controllers --> Stream["stream/<br/>snapshot projection + side effects"]
  Controllers --> Rendering["rendering/<br/>adapters in React message slots"]
  Controllers --> State

  Composer --> UI
  Composer --> Toolbar
  Composer --> State

  Stream --> Services
  Stream --> State
  Shell -. "portals into empty slots" .-> Tabs
  Rendering -. "fills React slots" .-> Shell

  Tabs --> Host["PiviChatHost<br/>src/app/hostContracts.ts"]
  Controllers --> ChatService["PiChatService<br/>@pivi/pivi-agent-core/runtime"]
  Host -. "creates/injects" .-> ChatService
```

### Lifecycle and data flow

1. `PiviViewHost.onOpen()` creates `ChatPorts` via `createChatUiPorts`, prepares the React shell through `createImperativeChatAdapter`, mounts one React shell via `mountChatView` (ports → `ChatShell` + imperative adapter), restores persisted tab bindings or creates a blank tab, then primes eligible runtime state.
2. `ImperativeChatAdapter.mount` constructs `TabManager` with the same `ChatPorts`. `TabManager` creates each `TabData`, initializes service/controller state plus the uncontrolled rich-input and empty portal slots (`tabDom`), and activates only the selected tab. Live chrome/messages reach React through `ActiveChatUiBridge` + immutable `ChatUiStore` snapshots; `scheduleTabsSnapshotPublish` keeps the tab strip store in sync. Ports supply catalogs/factories (`catalog` / `models` / `runtime` / `sessions`), not live UI state. There is no composer `McpServerSelector`, no `navRowEl`, and no DOM-mutating stream path.
3. A new tab begins as `blank`: it has draft UI settings but no durable open-session binding and no chat service.
4. Loading history produces a `bound_cold` tab associated with `openSessionId` and `sessionFile`; runtime work remains lazy.
5. The first send calls `initializeTabService()`. This is the only UI location that calls `plugin.createChatService()` (via `ports.runtime`). It passively syncs the session and moves the tab to `bound_active`; `query()` starts actual work.
6. `InputController` delegates turn capture to composer helpers, streams `PiChatService.query()` chunks through `StreamController`, finalizes the turn, saves session projection, and processes any queued turn.
7. `StreamController` serially reduces chunks into durable `ChatMessage` state and performs non-DOM service effects. Streaming is snapshot-only: React renders every live/stored message from `ChatUiSnapshot.messages`; only explicit Markdown/tool/diff/ask-user/subagent slots invoke imperative adapters.
8. `PiviViewHost.onClose()` disposes the imperative runtime adapter and React root. Adapter disposal persists tab state before `TabManager.destroy()` saves/cleans tabs, subscriptions, controllers, services, and DOM listeners.

## Subdirectory map

| Directory | Responsibility | Local guidance |
|---|---|---|
| `src/ui/chat/tabs/` | Per-tab construction, activation, archive/close behavior, persisted restoration, session opening, lazy runtime creation, fork/redo, portal slot scaffolding, and wiring of controllers/context. | — |
| `src/ui/chat/controllers/` | Stateful coordinators for input, session projection, stream dispatch, selections, keyboard navigation, provider boundaries, title generation, and welcome quote background. | — |
| `src/ui/chat/composer/` | Provider-neutral turn request construction, outgoing-turn setup/finalization, one-turn queueing/restoration, inline prompts, and response duration. | — |
| `src/ui/chat/stream/` | Chunk-to-state snapshot projection for text, thinking, tools, usage, todos, subagents, scrolling, and vault-change notifications. No message DOM; React consumes `ChatUiStore`. | — |
| `src/ui/chat/rendering/` | Imperative adapter slots for Obsidian Markdown, rich tool bodies, diffs, ask-user prompts, write/edit blocks, and stored nested subagents inside React message shells. | `src/ui/chat/rendering/AGENTS.md` |
| `src/ui/chat/toolbar/` | DOM-free external-context runtime model plus toolbar callback types; React owns presentation. MCP availability is settings-owned (no composer toolbar picker). | — |
| `src/ui/chat/ui/` | Imperative adapters for uncontrolled rich input, file/image/inline context chips, and textarea sizing. `src/ui/chat/ui/file-context/` has its own `AGENTS.md`. | `src/ui/chat/ui/file-context/AGENTS.md` |
| `src/ui/chat/services/` | UI-side synchronous/background subagent lifecycle tracking and tolerant result parsing. | — |
| `src/ui/chat/state/` | Per-tab transient chat and streaming state, callbacks, maps, timers, queued-turn shape, and immutable React-store projection. | — |
| Top-level | Shared branch/fork/redo entry-ID helpers and chat constants. | — |

## Key files

| File | Role |
|---|---|
| `src/app/ui/PiviViewHost.ts` | Thin app-owned Obsidian view lifecycle; mounts/disposes React shell, persists tab state, and coordinates vault/workspace events. |
| `src/app/ui/imperativeChatAdapter.ts` | `createImperativeChatAdapter`: TabManager mount path, message presentation adapters, `scheduleTabsSnapshotPublish`, and tabs store bridge. |
| `packages/obsidian-ui/src/mount/ChatShell.tsx` | React-owned header, logo, tabs, welcome/quote adapter slot, queue, composer toolbar (including input usage meter), todo status, navigation, auto-scroll status, and owner-realm interactions. Receives `ChatPorts` via mount. |
| `packages/obsidian-ui/src/mount/activeChatUiBridge.ts` | Runtime-only active-tab selector connecting immutable stores and React-exclusive portal elements without placing DOM in snapshots. |
| `src/ui/chat/tabs/Tab.ts` | Creates one `TabData` graph and its portal/input scaffolds; activates, deactivates, and destroys per-tab resources. |
| `src/ui/chat/tabs/types.ts` | Canonical tab aggregate, lifecycle states, UI/controller/service slots, and persisted tab binding shape. |
| `src/ui/chat/tabs/tabControllerInit.ts` | Composition point for per-tab renderer and controllers; connects callbacks without importing `PiviViewHost`. |
| `src/ui/chat/tabs/tabRuntime.ts` | Sole UI factory call for `PiChatService`; session sync, subscriptions, lazy activation, and failed/closing initialization cleanup. |
| `src/ui/chat/tabs/tabToolbarInit.ts` | `wireComposerChrome()` adapts model/mode/reasoning, external-context, and send/cancel runtime behavior into serializable composer snapshots and narrow React actions. No MCP toolbar picker. |
| `src/ui/chat/tabs/tabFork.ts` | Resolves durable entry IDs and requests a new session fork from the host. |
| `src/ui/chat/controllers/InputController.ts` | Public per-tab input coordinator; delegates turn pipeline, queue restoration, provider boundaries, cancellation, and inline questions. |
| `src/ui/chat/controllers/inputTurnPipeline.ts` | Executes the send/query/finalize sequence and guards against stale stream generations. |
| `src/ui/chat/controllers/SessionController.ts` | Hydrates and saves `OpenSessionState`, resets blank sessions, synchronizes session-scoped UI, and clears transient stream state. |
| `src/ui/chat/controllers/StreamController.ts` | Ordered chunk reducer/service-effect coordinator for tools, subagents, usage, errors, and completion; it owns no message DOM. |
| `src/ui/chat/composer/ComposerSubmission.ts` | Builds visible text plus a provider-neutral `ChatTurnRequest` from files, selections, images, inline context, MCP, and external paths. |
| `src/ui/chat/composer/ComposerTurnLifecycle.ts` | Captures turn state and creates user/assistant message placeholders before streaming. |
| `src/ui/chat/stream/StreamEventReducer.ts` | Canonical merge/register/status operations for streamed tool calls. |
| `src/ui/chat/rendering/MessageRenderer.ts` | Obsidian Markdown/user-content adapter host and message scrolling. |
| `src/ui/chat/state/ChatState.ts` | Mutable transient state plus immutable React snapshot publication; runtime state contains no message DOM. |
| `src/ui/chat/services/SubagentManager.ts` | Correlates task, child-tool, agent-output, and asynchronous completion events into pure subagent records. |
| `src/ui/chat/ui/RichChatInput.ts` | Uncontrolled contenteditable adapter with textarea-compatible API, mention badges, plain-text paste, and IME-safe synchronization. React never owns its children. |

## Patterns and constraints

### Boundaries

- UI chat code depends on the narrow `PiviChatHost` contract from `src/app/hostContracts.ts`, not the concrete plugin class, `PiviViewHost`, or app workspace implementations. Do not import `@/app/ui/**` from this directory.
- Depend on `PiChatService` from `@pivi/pivi-agent-core/runtime`. Never import, instantiate, or type against `PiChatRuntime`.
- Consume injected `ChatPorts` (`runtime` / `sessions` / `catalog` / `models`) via `TabManager`—type-import `@pivi/obsidian-ui/ports` only; never implement ports, never import `@pivi/obsidian-ui/mount`, never call `getPiWorkspace()`, and never cast host objects `as ChatPorts`.
- Do not import `@pivi/pivi-agent-core/engine/pi`, raw `@earendil-works/*` SDK modules, `src/app/workspace/**`, or `@pivi/obsidian-host/**` from this directory.
- Host/platform operations must arrive through `PiviChatHost`, narrow structural callbacks, or approved UI adapters such as `src/app/hostPlatform.ts`.
- Use core-owned message, turn, tool, session, todo, context, and usage models. Do not duplicate provider/runtime protocols in UI.
- Keep `src/app/hostContracts.ts` structural and UI-neutral. Use interfaces such as `TabManagerViewHost` to prevent app↔UI and view↔tab cycles.
- Runtime state is rebuildable. Durable identity belongs to the session file/header; open-session projections and adapter DOM are rebuildable.

### Tabs and sessions

- Preserve the lifecycle transitions `blank` → `bound_cold` → `bound_active` → `closing`.
- Blank tabs may carry `draftModel` and `draftTitle`; do not create empty sessions merely by opening a tab.
- `tab.id`, `openSessionId`, runtime session ID, JSONL header ID, `sessionFile`, and legacy `leafId` are distinct identifiers.
- Persist tab binding with `sessionFile` plus draft UI state. Do not treat `openSessionId`, tab ID, runtime ID, or `leafId` as durable session identity.
- Session switching must save current state, dismiss inline prompts, orphan/clear active subagents, reset queued/transient UI, sync the service, and re-publish stored messages into the React snapshot.
- Archiving hides a tab without destroying its runtime/session state. Closing destroys it. Do not collapse these behaviors.
- Fork and redo operations require persisted user/assistant entry IDs. Preserve `userMessageId`, `assistantMessageId`, and `parentEntryId` through rendering and hydration.

### Controllers, streaming, and rendering

- Keep controllers as orchestration layers. Put turn capture in `composer/`, pure chunk/model operations in `stream/`, and explicit owner-realm adapters in `rendering/`.
- Consume `PiChatService.query()` with `for await` and await chunk handling in arrival order.
- Check `ChatState.streamGeneration` after asynchronous boundaries. A reset, forced new session, or close invalidates the old stream even if chunks still arrive.
- Reduce each chunk into the authoritative `ChatMessage` before service effects, then publish the post-effect message snapshot.
- Streaming `tool_use` chunks may repeat with partial input. Merge by tool ID; do not create duplicate tool calls or reorder their content blocks.
- Tool results may arrive with imperfect error flags. Resolve against the existing tool ID and prefer structured result metadata where available.
- Stored-history and live streaming must converge on the same `ChatMessage`/`contentBlocks` representation.
- Keep Obsidian Markdown adapters asynchronous and generation-guarded so a stale completion cannot replace a newer React slot.

### Composer and toolbar

- Build `ChatTurnRequest` at send time from current UI capability selections. Visible `displayContent` and runtime/persisted prompt content are intentionally different.
- MCP slash tokens (`/server`), attached files, inline references, editor/browser/canvas selections, images, and external roots belong in the turn request—not ad hoc prompt strings in controllers.
- Queued submissions are snapshots of turn content/context; external-context permissions refresh from current UI when the queued turn executes. MCP availability comes from settings-enabled servers (no per-turn toolbar pick).
- Only one queued turn is maintained; additional submissions merge through the core queue helpers.
- Preserve IME composition guards in `RichChatInput`; rebuilding mention badges during composition breaks CJK input.
- Model changes on blank tabs update draft state. Bound-tab model/mode/reasoning changes update that tab's runtime settings and capability gating.
- External-context selections are session/turn capabilities. Reset session-only selections on new/load flows; synchronize pinned external roots across all views. MCP enable/disable lives in Settings; slash catalog + MCP tool lists are prefetched at tab/view open and refreshed after MCP settings save.
- Allowed imperative composer surfaces: uncontrolled `RichChatInput`, file/image/inline context chips, and cursor-relative mention/slash dropdowns. React owns toolbar chrome and never reconciles those adapter children. Do not reintroduce `McpServerSelector` or other composer MCP pickers.
- All user-visible labels, notices, placeholders, status text, and accessibility text must use the shared translator from `@/app/i18n`.

### Ownership and cleanup

- Every tab owns its controllers, renderer, state, subagent manager, UI adapters, service, subscriptions, and event cleanup callbacks.
- Register manual DOM listeners in `tab.dom.eventCleanups` or an Obsidian `Component`; remove vault event refs and timers on destroy.
- Do not retain tab DOM references after close. Cleanup must tolerate partially initialized tabs and repeated calls.
- `services/` manages presentation correlation only; it must not execute subagents or become a second runtime.
- Render todo status from `TodoVisualizationModel` published into `ChatUiStore`; do not parse raw `TodoWrite` payloads independently in adapters.

## Gotchas

- **Tab binding is not session identity.** A restored tab can be cold, an open-session ID is in-memory, and `leafId` is legacy compatibility. Use `sessionFile` for durable binding.
- **First send is a binding boundary.** Service initialization can race tab closure; re-check `closing` after asynchronous work and clean up an uncommitted service.
- **Session sync is passive.** `syncSession()` updates runtime context; it must not eagerly start agent work. `query()` starts the turn.
- **Chunk ordering is semantic.** Text, thinking, tools, compact boundaries, and subagents must be finalized in arrival order or stored history will render differently from the live turn.
- **Streaming tool input is incremental.** Empty or partial repeated `tool_use` chunks are normal.
- **Provider message boundaries can replace the assistant placeholder.** Route them through `InputProviderBoundaryHandler` before ordinary stream rendering.
- **Background subagent chunks may outlive the foreground turn.** Correlate by task/agent/tool IDs, persist terminal state when appropriate, and orphan unresolved work during session reset.
- **Cancellation is cooperative.** Set `cancelRequested`, invalidate stream generation when resetting, restore queued composer content, and call `PiChatService.cancel()`.
- **Async Markdown can finish late.** Use render-generation or element-identity checks and never let stale work overwrite a newer block.
- **Auto-scroll is user-sensitive.** Scrolling away disables it; only re-enable near the bottom after the existing delay.
- **Current-note attachment is session-aware.** It is automatically attached before a session starts but should not be resent every turn.
- **Forking while streaming is unsafe.** Fork only from stable messages with durable entry IDs.
