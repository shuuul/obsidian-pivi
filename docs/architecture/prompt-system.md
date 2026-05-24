# Prompt system

## Purpose

Separate **long-lived system instructions** from **per-turn user payloads** and **short auxiliary prompts**.

## Responsibilities

| Layer | Location | Output |
|-------|----------|--------|
| Main agent system | `src/core/prompt/mainAgent.ts` + `buildPiSystemPrompt.ts` | `Agent.state.systemPrompt` |
| Turn body | `src/core/runtime/buildTurnPrompt.ts` | User message + context XML |
| MCP finalize | `finalizeTurnPrompt` | API vs display prompt |
| Instruction refine | `src/core/prompt/instructionRefine.ts` | Aux query |
| Inline edit | `src/core/prompt/inlineEdit.ts` | Aux query |
| Title generation | `src/core/prompt/titleGeneration.ts` | Aux query |

## Non-responsibilities

- Slash command prompt libraries (user-defined; catalog only).
- Model-specific token counting (pi-ai).

## Design

System prompt hot-updates on settings blur. Turn prompt stays provider-agnostic in core; Pi adaptor only supplies `buildPiSystemPrompt` mapping from `ObsiusSettings`. Some tool names in `mainAgent.ts` still reflect Claudian-era wording — see roadmap.

## Failure modes

| Failure | Mitigation |
|---------|------------|
| Stale system prompt | `syncSystemPrompt()` on settings save |
| Missing MCP suffix | `finalizeTurnPrompt` + unit tests |

## Related ADRs

- [ADR-0005](../adr/0005-mcp-mention-transform.md)

## Related specs

- [turn-prompt-spec.md](../specs/turn-prompt-spec.md)
