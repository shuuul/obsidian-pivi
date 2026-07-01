# `src/features/chat/services/` — Chat feature services

Small services that interpret runtime/tool outputs for the chat feature, especially subagent lifecycle and trusted output files.

## Rules

- Keep services focused on chat interpretation; classify tool output through stable tool names/helpers.
- Treat external output paths as untrusted until validated by helper functions.
- Return UI-ready interpretations; rendering remains in `rendering/`.
