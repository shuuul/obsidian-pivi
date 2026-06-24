# `src/pi/runtime/` — Pi chat runtime and stream adapter

Concrete `ChatRuntime` implementation using `pi-agent-core` / `pi-ai`: system prompt assembly, model resolution, event adaptation, auxiliary queries, and message-content conversion.

## Runtime flow

```mermaid
sequenceDiagram
  participant UI as Chat controllers
  participant RT as PiChatRuntime
  participant Prompt as buildPiSystemPrompt
  participant Agent as pi-agent-core Agent
  participant Adapter as PiAgentEventAdapter

  UI->>RT: create/prepare/send turn
  RT->>Prompt: assemble system prompt + tools
  RT->>Agent: stream prompt
  Agent-->>Adapter: Pi events
  Adapter-->>UI: StreamChunk updates
```

## Rules

- Implement core runtime contracts without importing `src/features/**`.
- Keep system prompt assembly Pi-specific here; reusable prompt text remains in `src/core/prompt/`.
- Preserve streaming order and stale-callback guards when adapting Pi events.
- Map Pi SDK message/content shapes at the boundary before returning core types.
