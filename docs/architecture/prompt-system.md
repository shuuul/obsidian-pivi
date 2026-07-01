# Prompt system

## Purpose

Separate **long-lived system instructions** from **per-turn user payloads** and **short auxiliary prompts**.

## Responsibilities

| Layer | Location | Output |
|-------|----------|--------|
| Main agent system | `src/pi/prompt/mainAgent.ts` + `buildPiSystemPrompt.ts` | Pi `Agent.state.systemPrompt` |
| Turn body | `src/core/runtime/buildTurnPrompt.ts` | User message + context XML |
| MCP finalize | `finalizeTurnPrompt` | API vs display prompt |
| Inline edit | `src/pi/prompt/inlineEdit.ts` | Aux query |
| Title generation | `src/pi/prompt/titleGeneration.ts` | Aux query |
| Available Tools section | `src/pi/prompt/obsidianAgentTools.ts` | `buildRegisteredToolsSection` for system prompt |
| Context appendices | `src/pi/runtime/loadContextLayers.ts` | AGENTS.md, SYSTEM.md, skills content |

## Non-responsibilities

- Slash command prompt libraries (user-defined; catalog only).
- Model-specific token counting (pi-ai).

## Design

System prompt hot-updates when settings that affect base context change, and on the next turn when vault instruction files change. Custom instructions live in vault files (`AGENTS.md` / `.pivi/SYSTEM.md`) rather than in settings. Turn prompt assembly remains a pure helper so display/API prompt separation is testable; Pi runtime supplies `buildPiSystemPrompt` mapping from `PiviSettings` plus context appendices.

## Failure modes

| Failure | Mitigation |
|---------|------------|
| Stale system prompt | `syncSystemPrompt()` on settings save |
| Missing MCP suffix | `finalizeTurnPrompt` + unit tests |

## Related

- [context-management.md](./context-management.md)
- [../specs/turn-prompt-spec.md](../specs/turn-prompt-spec.md)

## Related specs

- [turn-prompt-spec.md](../specs/turn-prompt-spec.md)
