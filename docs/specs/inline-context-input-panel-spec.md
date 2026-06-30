# Inline context input panel spec

> **Status:** implemented with composer-text tokens. Earlier lavender-chip, editor-context-menu, and click-to-reselect designs are rejected/deferred indefinitely.

## Problem

Chat users need a lightweight way to attach an explicit Markdown editor selection to the next turn without opening the separate inline-edit modal. The attached selection must be visible/editable in the composer, serialized into the model prompt with source/range metadata, and kept separate from the user-visible message history.

## Goals

- Attach active Markdown editor selections through the chat input toolbar, with an optional slash entry point.
- Represent attached selections as composer-text tokens (`@[pivi-inline-context:...]`) so they can be removed before send.
- Snapshot the selected text/range at attach time and include it in the next turn prompt.
- Mark the exact selected span inside the prompt context block.
- Keep UI/feature code provider-neutral; Pi remains behind `src/core/` contracts.

## Non-goals

- Inline rewriting or diff application; that remains the separate inline-edit flow.
- Automatic attachment of every active editor selection.
- RAG, semantic expansion, or automatic pruning.
- Reading arbitrary non-Markdown/binary content.
- Changing MCP mention behavior.
- Visual lavender chips, editor right-click entry points, or click-to-reselect behavior.

## User experience

The chat input toolbar exposes an inline-context button such as **Attach selection to chat**.

| State | Behavior |
|-------|----------|
| Active Markdown source editor has a non-empty selection | Button is active; clicking it attaches the selected region as a composer token. |
| No active Markdown selection | Button is disabled or hidden. |
| Same selection already attached | Deduplicated by note path + selection range. |
| Selection changes after attach | Existing token keeps the original snapshot. The user can remove and re-attach. |
| Source file renamed/deleted before send | Token remains an attach-time snapshot; prompt construction must not crash. |

The visible composer contains a token, not prompt XML:

```text
Please summarize this @[pivi-inline-context:...]
```

## API / interfaces

Inline contexts are explicit user-attached context on `ChatTurnRequest`:

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
  /** 1-indexed inclusive line range included in the prompt. */
  includedLines: {
    from: number;
    to: number;
  };
  /** Snapshot at attach time; avoids drift if the file changes before send. */
  text: string;
}

interface ChatTurnRequest {
  inlineContexts?: InlineContextReference[];
}
```

Feature-layer ownership:

- `InlineContextManager` captures the editor selection from the toolbar action.
- `src/utils/inlineContext.ts` handles token encoding/decoding and marker insertion helpers.
- `inputTurnSubmission` extracts inline-context tokens from submitted composer text and passes snapshots into `ChatTurnRequest.inlineContexts`.
- `buildTurnPrompt` serializes `inlineContexts` into prompt-only context.

The manager imports only Obsidian APIs plus `src/core` / `src/utils` helpers, never `src/pi`.

## Data model and prompt format

Range rules:

- Normalize reversed selections so `from <= to`.
- Store exact `from` / `to` character positions for the selected span.
- Store 1-indexed inclusive `includedLines`; current behavior includes touched lines only.
- Insert `<selection_start>` and `<selection_end>` around the exact selected span.
- Preserve attach order when multiple inline contexts are present.

`buildTurnPrompt` appends an XML-ish block separate from visible history:

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
- Escape or safely serialize XML-sensitive characters in attributes/body; tests should cover selected Markdown containing angle brackets.
- Keep `<inline_contexts>` distinct from active-editor context such as `<editor_selection>`.

## Flow

```diagram
╭──────────────────╮
│ User selects text│
╰────────┬─────────╯
         ▼
╭──────────────────────╮
│ Click toolbar action │
╰────────┬─────────────╯
         ▼
╭────────────────────────────╮
│ Normalize range + snapshot │
│ touched lines with markers │
╰────────┬───────────────────╯
         ▼
╭────────────────────────────╮
│ Insert composer token      │
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
╭───────────────────╮
│ agent.prompt(...) │
╰───────────────────╯
```

## Evaluation

Automated coverage should include:

- reversed range normalization;
- marker insertion for single-line partial, multi-line partial, and full-line selections;
- selected Markdown containing links/code/angle brackets;
- `buildTurnPrompt` appending `<inline_contexts>` while preserving display/API prompt separation;
- `extractUserQuery` ignoring `<inline_contexts>` blocks.

Manual checks:

1. Select text in a Markdown note, click the inline-context toolbar button, and confirm a token appears in the composer.
2. Send a message and confirm the prepared prompt contains selected lines with selection markers.
3. Remove the token before send and confirm the prompt excludes inline context.
4. Rename/delete the source note before send and confirm submission does not crash.
5. Verify keyboard-only focus/removal for the token.

## Rejected / deferred designs

| Design | Status | Rationale |
|--------|--------|-----------|
| Lavender chips in a separate chip row | Deferred indefinitely | Composer-text tokens reuse existing input behavior and keep implementation smaller. |
| Obsidian editor context menu entry | Deferred indefinitely | Toolbar action is sufficient and avoids extra editor lifecycle/event complexity. |
| Click token/chip to reopen and reselect source text | Deferred indefinitely | The token is an attach-time snapshot. Users can remove and re-attach for a new selection. |
| Surrounding-line expansion | Not implemented | Current touched-lines-only prompt is simpler and has been sufficient. |

## Related

- Architecture: [context-management.md](../architecture/context-management.md)
- Architecture: [ui-integration.md](../architecture/ui-integration.md)
- Spec: [turn-prompt-spec.md](./turn-prompt-spec.md)
