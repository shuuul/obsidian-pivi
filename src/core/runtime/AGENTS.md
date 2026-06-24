# `src/core/runtime/` — Chat runtime contract and turn prompt assembly

Defines the provider-neutral `ChatRuntime` interface and builds `PreparedChatTurn` objects from UI requests, context attachments, and MCP mentions.

## Turn preparation flow

```mermaid
flowchart LR
  Request["ChatTurnRequest"] -- "context + mentions" --> Build["buildTurnPrompt.ts"]
  Build -- "display prompt" --> History["visible chat history"]
  Build -- "api prompt" --> Runtime["ChatRuntime.prepareTurn/send"]
  Runtime -- "stream" --> Chunks["StreamChunk callbacks"]
```

## Rules

- Preserve the display/API prompt split; never persist MCP-transformed API text as the user's message.
- Runtime contracts should stay provider-neutral and use core types.
- Context serialization can use existing framework-neutral helpers from `src/utils/`, but avoid UI or Pi imports.
