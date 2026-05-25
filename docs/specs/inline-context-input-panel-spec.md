# Inline context input panel spec

> **Status note (2026-05-25):** The initial implementation uses composer-text tokens (`@[obsius-inline-context:...]`) rather than visual lavender chips. The editor context menu entry and click-to-reselect features are deferred. See inline context source files `src/utils/inlineContext.ts` and `src/features/chat/ui/InlineContext.ts` for the current implementation.

## Problem

Obsius already has chat input context affordances for files, folders, current note, browser selection, and canvas selection. The next gap is **explicit inline editor context**: while editing a note, the user should be able to select text and attach that selection to the next chat turn from the input panel, without opening the separate inline-edit modal.

The older `../obsius` implementation is the reference pattern: model selections, files, and folders as explicit context references, show them as removable badges in the chat input, and serialize them into the turn prompt with source path and range metadata. Obsius2 should adopt the product behavior while keeping its current Pi-only hexagonal seams and prompt format.

## Goals

- Add an editor right-click menu action for **Add selection to chat input**.
- When the user has a selection in a Markdown source editor, choosing that menu item attaches the selected region as an explicit context chip/button in the input panel for the next send.
- On send, include the selected region in the agent prompt automatically.
- Include enough surrounding line content to preserve readability, but clearly mark the exact user-selected span so the agent knows what was selected.
- Persist user-visible chat content separately from machine prompt context, following `buildTurnPrompt` / `finalizeTurnPrompt` conventions.
- Keep UI and feature code provider-neutral; Pi remains behind `src/core/` contracts.

## Non-goals

- Do not implement inline rewriting or diff application in this feature. The existing inline-edit flow remains separate.
- Do not add RAG, semantic expansion, or automatic pruning.
- Do not attach every active editor selection automatically. The user must explicitly choose the editor context-menu action.
- Do not read arbitrary non-Markdown binary content for inline context.
- Do not change MCP mention behavior.

## User experience

### Entry point

The entry point is the Markdown editor context menu, not a persistent toolbar button:

```diagram
╭────────────────────────────╮
│ Markdown editor selection  │
╰─────────────┬──────────────╯
              ▼ right click
╭────────────────────────────╮
│ Add selection to chat input│
╰─────────────┬──────────────╯
              ▼
╭────────────────────────────╮
│ Input panel lavender chip  │
╰────────────────────────────╯
```

- Menu label: **Add selection to chat input**.
- Menu icon: selection/range-oriented icon if available; otherwise a text-selection or brackets icon.
- The input panel chip uses a lavender accent, visually parallel to file/folder context chips.
- Accessibility: the chip is keyboard-focusable, has an `aria-label`, visible `:focus-visible`, and a remove control.

### States

| State | Behavior |
|-------|----------|
| Active Markdown source editor has a non-empty selection | Context-menu item appears. Click attaches selection. |
| No active Markdown selection | Context-menu item does not appear. |
| Selection already attached | Do not duplicate. Either no-op with a notice or replace the existing identical chip. |
| Source file renamed/deleted before send | Update path on rename when possible; remove or mark unreadable on delete. |
| Selection changes after attach | The chip remains a snapshot of the original range/content for the next turn. The user can remove and re-add if they want the new selection. |

### Chip display

Attached inline context appears in the same chip row as files/folders but with a lavender variant:

```diagram
╭──────────────────────────────────────────────╮
│  lavender chip: “Selection · note.md 12–15” ×│
╰──────────────────────────────────────────────╯
```

The chip should expose:

- source file name,
- line range,
- remove action,
- optional click action to reopen the source note and reselect/scroll to the range.

## API / interfaces

### Core runtime request

Extend the provider-neutral turn request with explicit inline contexts. Suggested shape:

```ts
interface InlineContextReference {
  type: 'editor-selection';
  notePath: string;
  noteName: string;
  /** 0-indexed CodeMirror/Obsidian positions for the exact selected span. */
  selection: {
    from: { line: number; ch: number };
    to: { line: number; ch: number };
  };
  /** 1-indexed inclusive line range actually included in the prompt. */
  includedLines: {
    from: number;
    to: number;
  };
  /** Snapshot at attach time; avoids drift if the file changes before send. */
  text: string;
}
```

Add this to `ChatTurnRequest` as an optional list, for example:

```ts
inlineContexts?: InlineContextReference[];
```

This keeps inline context distinct from existing `editorSelection`, which currently represents the active editor/cursor context collected by the selection controller. The new list is **explicit user-attached context**, equivalent in intent to file chips.

### UI manager

Introduce a small input-panel manager, parallel to file/image context managers:

- Owns the inline-context chips.
- Accepts a selected editor range from the Obsidian `editor-menu` event.
- Stores attached inline-context snapshots for the current input/turn.
- Exposes `collectInlineContextsForTurn()` to `inputTurnSubmission`.
- Exposes lifecycle methods consistent with neighboring managers: `resetForNewConversation()`, `resetForLoadedConversation()`, and `destroy()`.

This manager should live in the chat feature UI layer and import only Obsidian APIs plus `src/core`/`src/utils` helpers, never `src/pi`.

## Data model

### Range normalization

- Normalize reversed selections so `from <= to`.
- Store exact `from`/`to` character positions for the selected span.
- Also store an included line range. The initial implementation may include every line touched by the selection, without extra surrounding lines.

### Prompt text snapshot

At attach time, build the prompt snapshot from full touched lines, not only the exact substring. This satisfies readability while still marking the exact selected span.

For a selection from line 12 column 8 to line 14 column 20, include lines 12–14 and mark the selected region inside those lines.

Recommended marker format inside the context block:

```text
<selection_start>
...
<selection_end>
```

For multi-line selections, insert `<selection_start>` at the exact start character and `<selection_end>` at the exact end character. For full-line selections, markers naturally wrap the full included lines.

## Prompt format

Add a new XML-ish block appended by `buildTurnPrompt`, after current note/editor/browser/canvas context and before or alongside `<context_files>`:

```xml
<inline_contexts>
<inline_context path="notes/example.md" range="12:9-14:21" included_lines="12-14">
The following lines were explicitly attached by the user. The exact selected span is marked with <selection_start> and <selection_end>.

line 12 before <selection_start>selected text
line 13 selected text
line 14 selected text<selection_end> after
</inline_context>
</inline_contexts>
```

Rules:

- `path` is vault-relative.
- `range` is 1-indexed line/column for human readability.
- `included_lines` is 1-indexed inclusive.
- Preserve the original selected text as closely as possible.
- Escape or otherwise safely serialize XML-sensitive characters in attributes and body if the implementation chooses strict XML parsing later. If using plain XML-ish prompt text only, tests should still cover angle brackets in selected Markdown.
- If multiple inline contexts are attached, preserve attach order.

This differs from the current `<editor_selection>` block: `<editor_selection>` describes active editor focus; `<inline_contexts>` describes explicit, user-attached context chips.

## Algorithm / flow

```diagram
╭──────────────────╮
│ User selects text│
╰────────┬─────────╯
         ▼
╭──────────────────────╮
│ Right click selection│
│ + choose menu item   │
╰────────┬─────────────╯
         ▼
╭────────────────────────────╮
│ Normalize range + snapshot │
│ touched lines with markers │
╰────────┬───────────────────╯
         ▼
╭────────────────────────────╮
│ Render lavender input chip │
╰────────┬───────────────────╯
         ▼
╭────────────────────────────╮
│ inputTurnSubmission builds │
│ ChatTurnRequest            │
╰────────┬───────────────────╯
         ▼
╭────────────────────────────╮
│ buildTurnPrompt appends    │
│ <inline_contexts>          │
╰────────┬───────────────────╯
         ▼
╭────────────────────────────╮
│ finalizeTurnPrompt applies │
│ MCP transform unchanged    │
╰────────┬───────────────────╯
         ▼
╭──────────────────╮
│ agent.prompt(...) │
╰──────────────────╯
```

## Implementation notes for later

- Prefer a dedicated small manager over expanding `FileContextManager` deeply. Inline selections are not file attachments, but they share the same input-panel chip affordance.
- Register the entry point through Obsidian's `editor-menu` event so the action is discoverable exactly where the selection is made.
- Reuse existing Obsidian editor selection helpers where possible; add utility functions only when needed for range normalization and marker insertion.
- Avoid storing live editor objects in state. Store serializable snapshots.
- Keep file rename/delete handling consistent with file chips if practical, but do not block the MVP on complex drift reconciliation.
- Unit-test marker insertion separately from DOM behavior.
- Add `inline_contexts` to context stripping/extraction helpers so history display and user query extraction keep working.

## Evaluation

### Unit tests

- Range normalization: reversed selections produce stable `from`/`to`.
- Marker insertion:
  - single-line partial selection,
  - multi-line partial selection,
  - full-line selection,
  - selected text containing Markdown links/code/angle brackets.
- `buildTurnPrompt` appends `<inline_contexts>` and preserves user-visible text.
- `extractUserQuery` ignores `<inline_contexts>` blocks.

### Manual checks

- Select text in a note, right-click, choose **Add selection to chat input**, and confirm a lavender chip appears.
- Send a message and inspect the prepared prompt/debug output: selected lines are present and exact selected span is marked.
- Remove chip before send; prompt excludes inline context.
- Rename/delete source note before send; behavior is predictable and does not crash.
- Keyboard-only: focus/remove chip. The context-menu entry follows Obsidian's native menu accessibility.

## Open questions

- Should the MVP include only touched lines, or also one line before/after for additional context? Recommendation: start with touched lines only; add surrounding-line expansion later if prompts are ambiguous.
- Should inline context chips persist across queued turns, or clear immediately after successful send? Recommendation: clear after successful send, matching one-turn explicit context semantics.
- Should clicking the chip reopen and reselect the source range in MVP? Recommendation: yes if cheap, otherwise defer; removal is required.

## Related

- Architecture: [context-management.md](../architecture/context-management.md)
- Architecture: [ui-integration.md](../architecture/ui-integration.md)
- Spec: [turn-prompt-spec.md](./turn-prompt-spec.md)
