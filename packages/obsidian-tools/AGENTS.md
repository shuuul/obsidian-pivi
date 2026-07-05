# @pivi/obsidian-tools package guide

*This file extends the root [AGENTS.md](../../AGENTS.md). Follow root guidance first, then these package-specific rules.*

## Purpose

`@pivi/obsidian-tools` provides concrete Obsidian-native agent tools. It adapts abstract tool contracts from `@pivi/pivi-agent-core/tools` to Obsidian vault operations, CLI-backed gaps, frontmatter handling, vault edit helpers, history recovery, and injected image generation that persists outputs as Obsidian attachments.

## Public entrypoints

- `src/index.ts` re-exports all tool creators, settings, types, frontmatter helpers, and vault edit helpers. Default export is `createObsidianTools`.
- `src/createObsidianTools.ts` constructs the full `ToolSpec[]` from an Obsidian `App`, settings, and optional image generator.
- `src/obsidian/` contains per-tool factories. Each factory accepts `ObsidianToolDeps` and returns a `ToolSpec`.
- `src/obsidian/deps.ts` defines shared tool dependencies: vault API, CLI transport, settings, vault name, and optional image generator.
- `src/obsidian/history.ts` defines `obsidian_history`; it uses the Obsidian CLI history commands to list, read, and restore stored file versions, including deleted files when history exists.
- `src/obsidian/generateImage.ts` defines `obsidian_generate_image`; it consumes an injected image-generator port, saves binary output through `ObsidianVaultApi`, and optionally inserts `![[...]]` embeds into notes.
- `src/settings.ts` resolves Obsidian tool settings, disabled tool names, CLI toggles, command allowlists, and eval enablement.
- `src/frontmatter.ts` owns YAML frontmatter parsing and slug/name validation.
- `src/vaultEditMatch.ts` builds actionable edit-mismatch messages.

## Boundaries

- Tool implementations use `@pivi/obsidian-host` APIs and the Obsidian CLI transport where public API coverage is unavailable.
- Image generation tools depend only on an injected generator port; Pi/Codex provider wiring stays in app/Pi composition.
- Do not import UI renderers. Return structured/text tool results and let UI packages render them.
- Mutating vault operations execute directly; only CLI-backed optional tools use explicit settings gates (`allowCommand`, `allowEval`).
- Keep CLI-backed behavior explicit and setting-gated. Do not add hidden fallbacks for required operations.
- Preserve old-string mismatch diagnostics; do not suppress edit failures with best-effort rewrites.

## Tool display contract

- Obsidian tool factories in `packages/obsidian-tools/src/obsidian/*` define execution only: `name`, `label`, `description`, parameters, and result shape.
- Any new Obsidian tool constant must be added to `packages/pivi-agent-core/src/tools/obsidianToolNames.ts`; its Chat display name/summary must be added to `src/ui/chat/rendering/piviToolDisplay.ts`; its icon must be added to `packages/pivi-agent-core/src/tools/toolIcons.ts`; and tests must cover the icon/display mapping.
- Chat UI renderers must use `appendToolIcon`/`getToolIcon`; they must not hardcode Obsidian tool icon names or add per-tool CSS sizing.
- Tool-call alignment is class-based: standard 16px `.pivi-tool-icon`, 14px only through `.pivi-tool-icon--small`, and no ad hoc `margin-top`/`transform` nudges for tool icons.
- Vault skills such as `defuddle` are not `@pivi/obsidian-tools` tools; every skill/tool call rendered in a nested/subshell tool list must use the shared `TOOL_SKILL`/`getToolIcon`/`appendToolIcon` contract and the same `.pivi-tool-icon` or `.pivi-tool-icon--small` class standard as adjacent tool rows.

## Package map

- `package.json` exports `src/index.ts` only.
- There is no package-local build step; source is consumed by the root build.
- The package-local `typecheck` script is a placeholder. Verify tool changes with root typecheck and targeted Obsidian tool tests.

## Documentation

Keep durable package rationale in this file. If behavior moves or package boundaries change, update this guide instead of adding separate architecture/spec/note docs.
