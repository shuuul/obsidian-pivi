# `src/pi/mcp/oauth/` — MCP OAuth flow implementation

Local callback server, provider implementation, auth flow orchestration, and vault-local token storage for MCP servers.

## Rules

- Store MCP OAuth state under `.obsius/mcp-oauth/`, not global config directories.
- Keep callback server lifecycle bounded to the auth flow.
- Provider API-key OAuth in `src/pi/auth/` is a separate concern; do not merge the two storage paths.
