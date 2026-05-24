# ADR-0004: Vault-local MCP configuration

## Status

Accepted

## Context

Desktop Pi and IDEs use global MCP config (`~/.config/mcp`, editor-specific files). Obsius runs **inside a vault**; servers often contain vault-specific paths, secrets, and OAuth callbacks tied to the user’s notes.

## Decision

- MCP registry: **`.obsius/mcp.json`** (legacy read: `.obsius2/mcp.json`).
- OAuth tokens: **`.obsius/mcp-oauth/`** (per-server hashed dirs).
- **Do not** read `~/.config/mcp` or host IDE MCP configs.

## Rationale

Trust boundary follows the vault. Synced config travels with the knowledge base. Avoids surprising cross-vault server leakage.

## Alternatives

1. **Global MCP merge** — convenient but wrong default for multi-vault users.
2. **pi-mcp-adapter default paths** — desktop agent dir, not vault.

## Consequences

- **Positive:** Predictable paths; documentable in specs.
- **Negative:** Users must configure per vault (import clipboard helps).
- **Debt:** Migration from `.obsius2/` path only partially automated.

## Review date

2026-09-01
