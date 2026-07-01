# `src/core/prompt/` — Pure prompt text helpers

Static prompt fragments for the main agent, inline edit, title generation, and Obsidian tool guidance.

## Rules

- Keep prompt fragments deterministic and free of low-level SDK imports; Pi system prompt assembly belongs in `src/pi/runtime/buildPiSystemPrompt.ts`.
- When changing tool instructions, verify concrete tool names against `src/core/tools/` and `src/pi/tools/`.
- Prefer small, explicit prompt edits over broad rewrites unless updating a documented behavior contract.
