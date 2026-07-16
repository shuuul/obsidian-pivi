*This file extends the root [AGENTS.md](../../../../AGENTS.md). Follow root guidance first, then these local rules.*

# Chat Rendering

## Purpose

`src/ui/chat/rendering/` contains the imperative owner-realm adapters that React cannot express directly: Obsidian Markdown, rich tool bodies, write/edit diffs, stored nested subagent bodies, and ask-user fallback content.

React components under `packages/pivi-react/src/chat/messages/` own message shells, block ordering, thinking, grouping, actions, duration, and live updates. Stream/runtime code writes serializable `ChatMessage` state only; it must never call or retain adapters from this directory.

```mermaid
flowchart LR
  State["ChatUiSnapshot messages"] --> React["React MessageList"]
  React --> Slot["Empty adapter slot"]
  Slot --> Markdown["Obsidian Markdown adapter"]
  Slot --> Tool["Rich tool/diff adapter"]
  Slot --> Subagent["Stored nested subagent adapter"]
  Markdown --> Slot
  Tool --> Slot
  Subagent --> Slot
```

Each adapter exclusively owns the children of one empty React-provided container. Mount returns deterministic cleanup; projected Markdown, tool, and stored-subagent slots keep that mount for a stable entity generation and send reconciled snapshots through explicit update calls. An adapter does not own the container, message order, stream lifecycle, or durable state.

## Key files

| Path | Responsibility |
|---|---|
| `src/ui/chat/rendering/MessageRenderer.ts` | Obsidian Markdown/user-content adapter host. It does not create message shells, action toolbars, or control transcript scrolling. |
| `src/ui/chat/rendering/messageRendererMarkdown.ts` | Obsidian Markdown rendering, first-turn auto-note badge restoration, input-derived mention badges, file-link processing, code wrappers, math, and owner-window-aware Mermaid controls. Expanded `attachedFilePaths` are runtime context and must never be enumerated as UI badges. |
| `src/ui/chat/rendering/ToolCallRenderer.ts`, `toolCallExpandedDispatcher.ts`, `toolCall*Expanded.ts` | Rich tool-body adapter registry used inside React-owned tool slots. |
| `src/ui/chat/rendering/WriteEditRenderer.ts`, `DiffRenderer.ts` | Content-only write/edit diff renderer, context hunks, and bounded new-file rendering. The surrounding generic tool shell owns the sole header/collapse boundary. |
| `src/ui/chat/rendering/SubagentRenderer.ts`, `AsyncSubagentRenderer.ts`, `subagentRendererShared.ts` | Stored nested subagent body adapters with stale-render protection. Runtime managers must never call them. |
| `src/app/ui/createSubagentContentAdapter.ts` | App-owned React message-content bridge that mounts and incrementally updates stored subagent adapters. |
| `src/app/ui/createStreamingMarkdownContentAdapter.ts` | App-owned stable Markdown bridge with rendered sealed segments, an escaped live tail, rewrite rebuilding, and terminal fidelity rendering. |
| `src/ui/chat/rendering/InlineAskUserQuestion.ts`, `inlineAskUserQuestion*.ts` | Interactive ask-user adapter where native input/keyboard behavior remains imperative. |
| `src/ui/chat/rendering/collapsible.ts`, `ToolStepGroupRenderer.ts` | Shared internals used only inside rich adapter-owned containers. |

## Patterns and constraints

- Keep this directory presentation-only. Do not execute tools, mutate vault files, create chat services, interpret provider events, or persist sessions here.
- Consume host-neutral models and helpers from non-engine `@pivi/pivi-agent-core/*` subpaths. Follow the `src/ui/AGENTS.md` prohibition on engine, raw Pi SDK, host-adapter, concrete-tool, and workspace implementation imports.
- Treat `ChatMessage`, `ContentBlock`, `ToolCallInfo`, `ToolDiffData`, `SubagentInfo`, and todo display models as upstream contracts. Normalize or parse only display-specific variants; do not recreate runtime policy.
- Render from durable message state. Stored subagent renderers are owner-realm adapters only; runtime managers and stream coordination must not create, retain, or update their DOM state.
- A mounted stored subagent must be updated through `updateStoredSubagent`; rebuilding it for every stream chunk discards expansion state and multiplies Markdown/tool rendering. Running text is retained in state and rendered as Markdown only when the subagent reaches a terminal result.
- Every subagent uses the same individual card path regardless of sibling count. Visible terminal results must strip fenced `pivi-agent-report` protocol blocks without mutating the durable result. Animate the profile icon and bottom light bar only in the canonical `running` state; queued, waiting, and terminal states are static.
- A mounted rich tool body must receive tool-entity changes through its adapter `update` path. Do not remount it for status/input/result patches; remount only when React supplies a new stable tool generation.
- Extend tool bodies through `toolCallExpandedDispatcher.ts`; block classification, grouping, ordering, labels, and shell state belong to `@pivi/pivi-react`.
- Completed Markdown Read results use the injected Obsidian Markdown renderer with the resolved vault path as `sourcePath`; generic/external reads render Markdown only for explicit Markdown paths. Preserve the existing bounded line previews.
- Markdown Structure/Outline keeps JSON as its tool protocol but renders a YAML-style heading list in the UI. Malformed protocol results fall back to bounded raw lines.
- Write/edit adapters render content only. Diff stats live in the generic tool header, and no adapter may create a nested write/edit header or collapsible shell.
- Write/edit, stored nested subagents, and ask-user interaction remain isolated adapters; never route ordinary React-renderable content through them.
- Use `setupCollapsible()` rather than ad hoc toggles. It owns keyboard activation, `aria-expanded`, chevrons, `.expanded`, and `.pivi-hidden`.
- Build DOM with Obsidian helpers and `textContent`/`setText`; tool results and agent output are untrusted display data.
- All plugin chrome and ARIA copy must use `t()` and receive matching locale updates. Raw tool identifiers, commands, paths, results, and agent content may remain untranslated.
- Keep CSS class contracts stable; styling is owned by `packages/pivi-react/styles/`, not this directory.
- Normalize host-rendered task-list, code-copy, and Mermaid nodes onto stable `.pivi-*` presentation classes before package CSS consumes them. Host classes may be queried inside this adapter, but must not become selectors in `packages/pivi-react/styles/`.
- For element-bound document/window work, including animation-frame scheduling for scrolling, use `getActiveDocument()` and `getActiveWindow()` so pop-out windows remain functional.
- Preserve accessibility roles, labels, status text, keyboard controls, and decorative `aria-hidden` attributes when changing headers or icons.
- Bound large output. Reuse line caps, compact summaries, diff hunking, and collapsed bodies instead of mounting unlimited result text.
- Imperative nested-subagent step groups mirror the React header contract: count plus unique translated tool names in first-use order, followed by the shared slash-separated per-status counts, with input/result details confined to expanded rows.
- Imperative Agent headers mirror the React `pivi-activity-*` layout and canonical status mapping while retaining their own DOM ownership. They may recompute elapsed text on lifecycle updates but must not start a recurring timer from legacy render helpers that return only bare DOM.

## Gotchas

- Tool icons are a cross-package contract. `getToolIcon()` may return `MCP_ICON_MARKER`, which must go through `appendMcpIcon()` rather than Obsidian `setIcon()`. Do not duplicate icon maps locally.
- Tool semantics are single-sourced in `@pivi/pivi-agent-core/tools/toolPresentation`: add or rename a tool there once for kind, icon, translation keys, visibility/grouping, and summary. `toolPresentationI18n.ts` only translates title/step tokens and composes ARIA text; `obsidianToolResultPresentation.ts` only decides whether structured Obsidian results use the compact imperative body. Expanded-body capability remains in the dispatcher.
- Obsidian tool display names are keyed by canonical constants from `@pivi/pivi-agent-core/tools/obsidianToolNames`; unknown tools intentionally fall back to their raw names.
- `contentBlocks` order is authoritative, but historical/provider data can leave tool calls unreferenced. Preserve orphan rendering and ID deduplication.
- Streaming tool input is reduced into `ChatUiSnapshot` before rendering. React content blocks own order and status; imperative renderers must not retain stream-specific DOM maps or create duplicate tool rows.
- Async Markdown can finish out of order. Subagent rendering uses generation tokens to discard stale completions; preserve that guard when rerendering prompt or result sections.
- Background subagents lazily render expanded content and can become `orphaned` when a session ends. Do not collapse `pending`, `running`, `error`, and `orphaned` into a simple completed flag.
- Thinking presentation and timing belong to the package React message view; no imperative thinking renderer or timer is permitted here.
- Full Markdown rendering is destructive (`el.empty()`) and asynchronous. During streaming, render only sealed safe segments and keep the live tail as text; terminal state must perform one complete fidelity render. Give every segment its own `Component` scope and unload it with the virtual row so links, code, math, Mermaid observers, timers, and postprocessors cannot outlive the row.
- `DiffRenderer` intentionally shows only changed hunks with context and caps all-insert new-file previews. Do not turn it into an unbounded full-file renderer.
- Ask-user rendering has both passive stored-result display and active keyboard-driven interaction. Keep answer extraction compatible with structured `toolUseResult` and text fallback results.
