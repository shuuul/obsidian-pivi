# Glossary

| Term | Meaning |
|------|---------|
| **Adaptor** | `src/pi/` — maps core ports to Pi SDK (`Agent`, `pi-ai`). |
| **Port** | Interface in `src/core/` that features depend on (`ChatRuntime`, `AppMcpOAuth`, …). |
| **Turn** | One user message → agent run → assistant output; includes built prompt and metadata. |
| **System prompt** | Long-lived agent instructions (`buildPiSystemPrompt` / `mainAgent`); hot-synced on settings blur. |
| **Turn prompt** | Per-message payload (`buildTurnPrompt`); may include context files XML and MCP mention transforms. |
| **MCP mention** | User types `@server`; API prompt uses `@server MCP` via `finalizeTurnPrompt`. |
| **Proxy MCP tool** | Single Pi tool `mcp` that searches/calls vault MCP servers (not one tool per MCP tool). |
| **Vault-local MCP** | `.obsius/mcp.json` + `.obsius/mcp-oauth/`; never host-global MCP paths. |
| **Workspace services** | `AgentWorkspace` + `PiWorkspaceServices`: MCP storage, OAuth, settings tab renderer. |
| **Auxiliary query** | Short Pi `Agent` run for refine / inline-edit / title (no full chat session). |
| **Hexagonal seam** | `features/` must not import `pi/`; only `main.ts` / bootstrap wires adaptors. |
