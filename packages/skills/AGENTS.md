# @pivi/skills package guide

## Purpose

`@pivi/skills` owns Pi-compatible skill and slash-command metadata, markdown/frontmatter parsing/serialization, slash command catalog contracts, and vault-local skill provisioning under `.pivi/skills/`.

## Public entrypoints

- `src/index.ts` re-exports the public skill/slash-command surface. Internal helpers stay private unless intentionally promoted.
- `src/frontmatter.ts` parses YAML frontmatter with fallback helpers and validates slug names.
- `src/slashCommand.ts` parses and serializes slash command/skill markdown, supports kebab-case file keys and camelCase runtime fields, and detects skill commands.
- `src/agentUtils.ts` serializes agent definitions and validates agent names.
- `src/commands/SlashCommandCatalog.ts` defines the slash command catalog interface used by chat.
- `src/commands/SlashCommandEntry.ts` defines dropdown/vault/runtime slash command entry shapes.
- `src/commands/hiddenCommands.ts` re-exports core hidden slash-command settings helpers for compatibility; the source of truth is `@pivi/core/settings`.
- `src/vault/VaultSkillsService.ts` manages vault skill installation, removal, update, remote listing, CLI sync, and default-bundle upgrade flows.
- `src/vault/loadVaultSkills.ts` reads `.pivi/skills/*/SKILL.md` and builds the skills XML prompt fragment.
- `src/vault/ensureDefaultVaultSkills.ts` owns startup prompting and default bundle install/upgrade orchestration.
- `src/vault/fetchDefaultVaultSkillsRemoteSha.ts` checks the upstream default bundle SHA.
- `src/vault/notifyVaultSkillsChanged.ts` invalidates open chat views after skill changes through a notifier contract.

## Boundaries

- Keep vault skill files under `.pivi/skills/`. Do not install or mutate repo-local skills from this package.
- Installing/updating the default external skills bundle requires explicit user confirmation from the caller/UI flow.
- CLI calls must be explicit and surfaced through `VaultSkillsService`; do not hide required failures behind silent fallbacks.
- Do not import UI renderers. Use catalog/notifier contracts for UI integration.
- Frontmatter parsing must preserve unknown markdown body content and fail loudly for invalid required identifiers.

## Package map

- `package.json` exports the barrel, source subpaths, command subpaths, and vault subpaths.
- There is no package-local build step; source is consumed by the app build.
- The package-local `typecheck` script is a placeholder. Verify skill changes with root typecheck and targeted slash-command/skill tests.

## Documentation

Keep durable package rationale in this file. If behavior moves or package boundaries change, update this guide instead of adding separate architecture/spec/note docs.
