# @pivi/skills

## Purpose

Pi-compatible Pivi skills, slash command catalog contracts, slash command markdown helpers, agent definition helpers, and vault-local skill provisioning.

## Allowed dependencies

- `@pivi/core` for shared settings and plugin contracts.
- Obsidian APIs for user-facing vault-skill notices, YAML parsing, and remote request helpers.
- Node `fs`/`path` for vault-local skill discovery and environment-file loading.
- Vault skill parsing and prompt formatting are implemented inside @pivi/skills.

## Forbidden dependencies

- Obsidian UI package imports.
- Pi chat runtime construction or raw Agent lifecycle imports.
- MCP server management or Obsidian tool execution imports.

## Public API

- Slash command catalog and entry contracts.
- Skill markdown/frontmatter helpers.
- Compatibility exports for core hidden slash-command settings helpers.
- Vault skill provisioning (`VaultSkillsService`, default skill installation helpers, change notifications).
- Exported through `@pivi/skills`, `@pivi/skills/*`, `@pivi/skills/commands/*`, and `@pivi/skills/vault/*`.
