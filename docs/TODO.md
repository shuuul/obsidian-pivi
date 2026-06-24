# Obsius design TODO

This file tracks design follow-ups discovered during the June 2026 docs / `AGENTS.md` refresh. Treat these as maintenance candidates, not committed implementation plans; promote any medium+ item into `docs/specs/` before coding.

## 1. Split oversized chat/runtime UI modules incrementally

**Current state**

- Lint currently reports no errors, but many existing warnings identify large or complex files.
- Notable examples include `InputController`, `StreamController`, `ToolCallRenderer`, `SessionController`, `SubagentManager`, `InputToolbar`, and `InlineEditModal`.

**Why it matters**

- Large controllers/renderers are harder to test, review, and safely modify.
- Complexity warnings often point to hidden feature coupling.

**Potential direction**

- Do not perform a broad rewrite.
- Split along existing seams when touching a file for functional work:
  - command handling vs turn submission in `InputController`
  - chunk dispatch vs per-chunk handlers in `StreamController`
  - label/icon/input parsing vs DOM rendering in `ToolCallRenderer`
  - session list/title/history concerns in `SessionController`
  - CodeMirror widget/diff/service orchestration in `InlineEditModal`
- Add focused tests around extracted units.

**Likely touchpoints**

- `src/features/chat/controllers/InputController.ts`
- `src/features/chat/controllers/StreamController.ts`
- `src/features/chat/controllers/SessionController.ts`
- `src/features/chat/rendering/ToolCallRenderer.ts`
- `src/features/chat/services/SubagentManager.ts`
- `src/features/chat/ui/InputToolbar.ts`
- `src/features/inline-edit/ui/InlineEditModal.ts`
