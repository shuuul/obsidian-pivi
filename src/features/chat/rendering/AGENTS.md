# `src/features/chat/rendering/` — Chat DOM renderers

Render structured chat state into accessible Obsidian DOM: messages, tool calls, diffs, thinking blocks, todos, plans, ask-user cards, and subagent output.

## Renderer relationships

```mermaid
flowchart TD
  Message["MessageRenderer"] --> Text["markdown/text blocks"]
  Message --> Tool["ToolCallRenderer"]
  Message --> Diff["DiffRenderer + WriteEditRenderer"]
  Message --> Thinking["ThinkingBlockRenderer"]
  Message --> Subagent["SubagentRenderer"]
  Message --> Todo["TodoListRenderer"]
  Tool --> Collapse["collapsible.ts<br/>ARIA + keyboard"]
  Thinking --> Collapse
  Subagent --> Collapse
```

## Rules

- Maintain live streaming and stored-history render paths; do not assume every block is created live.
- Interactive/collapsible elements need ARIA state and keyboard handling.
- Keep renderer code provider-neutral. If adaptor behavior is needed, resolve it through core facades.
- Use `.obsius2-*` CSS classes; avoid inline style assignment.
