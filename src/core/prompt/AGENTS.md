# `src/core/prompt/` — Provider-neutral prompt text

Static prompt fragments for the main agent, inline edit, title generation, and Obsidian tool guidance.

## Rules

- Keep prompts runtime-neutral; Pi-specific system prompt assembly belongs in `src/pi/runtime/buildPiSystemPrompt.ts`.
- When changing tool instructions, verify concrete tool names against `src/core/tools/` and `src/pi/tools/`.
- Prefer small, explicit prompt edits over broad rewrites unless updating a documented behavior contract.
