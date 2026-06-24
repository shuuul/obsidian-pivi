# `src/pi/auth/` — Provider credential and OAuth helpers

Obsidian secret-storage integration, provider environment variable metadata, and provider OAuth flows for Pi model providers.

## Rules

- Prefer `app.secretStorage` / keychain-backed storage for API keys.
- Keep provider OAuth separate from MCP OAuth (`src/pi/mcp/oauth/`).
- Never log secrets or persist raw credentials in normal plugin settings.
