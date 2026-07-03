# @pivi/obsidian-tools package guide

*This file extends the root [AGENTS.md](../../AGENTS.md). Follow root guidance first, then these package-specific rules.*

## Purpose

`@pivi/obsidian-tools` provides concrete Obsidian-native agent tools. It adapts abstract tool contracts from `@pivi/pivi-agent-core/tools` to Obsidian vault operations, CLI-backed gaps, approval checks, frontmatter handling, and vault edit helpers.

## Public entrypoints

- `src/index.ts` re-exports all tool creators, settings, types, frontmatter helpers, and vault edit helpers. Default export is `createObsidianTools`.
- `src/createObsidianTools.ts` constructs the full `ToolSpec[]` from an Obsidian `App`, settings, and optional approval callback.
- `src/obsidian/` contains per-tool factories. Each factory accepts `ObsidianToolDeps` and returns a `ToolSpec`.
- `src/obsidian/deps.ts` defines shared tool dependencies: vault API, CLI transport, settings, vault name, and approval callback.
- `src/obsidian/approval.ts` gates mutating tools through approval decisions.
- `src/obsidian/resolveApprovalPattern.ts` maps mutating tool inputs to path patterns for approval UI.
- `src/settings.ts` resolves Obsidian tool settings, CLI toggles, command allowlists, and eval enablement.
- `src/frontmatter.ts` owns YAML frontmatter parsing and slug/name validation.
- `src/vaultEditMatch.ts` builds actionable edit-mismatch messages.

## Boundaries

- Tool implementations use `@pivi/obsidian-host` APIs and the Obsidian CLI transport where public API coverage is unavailable.
- Do not import UI renderers. Return structured/text tool results and let UI packages render them.
- All mutating vault operations must pass through approval handling when an approval callback is present.
- Keep CLI-backed behavior explicit and setting-gated. Do not add hidden fallbacks for required operations.
- Preserve old-string mismatch diagnostics; do not suppress edit failures with best-effort rewrites.

## Package map

- `package.json` exports `src/index.ts` only.
- There is no package-local build step; source is consumed by the root build.
- The package-local `typecheck` script is a placeholder. Verify tool changes with root typecheck and targeted Obsidian tool tests.

## Documentation

Keep durable package rationale in this file. If behavior moves or package boundaries change, update this guide instead of adding separate architecture/spec/note docs.
