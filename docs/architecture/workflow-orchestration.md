# Workflow orchestration

## Purpose

Multi-step task graphs, checkpoints, and parallel sub-workflows.

## Responsibilities

*Limited today.*

- **SubagentManager** — spawns/tracks subagent runs from chat ([ui-integration.md](./ui-integration.md)).
- **Queued turns** — user message queue in `InputController` / `QueuedTurn`.
- Pi agent internal tool loop — planning tools, todos (rendered in UI).

## Non-responsibilities

- LangGraph-style explicit graphs (not used).
- Server-side workflow engine.

## Open questions

- Deeper integration with Pi workflow APIs if exposed in future SDK versions.

## Related ADRs

- [ADR-0003](../adr/0003-pi-as-sole-agent-runtime.md)
