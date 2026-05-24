# Roadmap

Lightweight direction only. Detailed work belongs in issues and `docs/specs/`.

## Near term

- [ ] MCP: richer parity with pi-mcp-adapter (direct tool registration, metadata cache) — see [adr/0006-mcp-proxy-tool.md](./adr/0006-mcp-proxy-tool.md)
- [x] Prompt: Pi-native tool naming in `mainAgent` (uses `core/tools/toolNames` constants)
- [ ] Session recovery: wire `buildPromptWithHistoryContext` where product needs it

## Medium term

- [ ] Evaluation harness for turn prompts and MCP mention behavior
- [ ] Optional export of stable notes from `docs/notes/` into architecture docs

## Non-goals (unchanged)

- Multi-runtime (Claude SDK + Pi in one plugin)
- Global MCP config discovery

Update this file when priorities change; record *why* in an ADR when dropping or adding a major initiative.
