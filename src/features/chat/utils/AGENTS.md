# `src/features/chat/utils/` — Chat feature helpers

Small helpers used only by the chat feature, currently usage/model display formatting.

## Rules

- Keep helpers feature-local when their output is chat UI specific.
- Move reusable provider-neutral semantics to `src/core/` only when another feature needs them.
