# @pivi/obsidian-tools package guide

*This file extends the root [AGENTS.md](../../AGENTS.md). Follow root guidance first, then these package-specific rules.*

## Purpose

`@pivi/obsidian-tools` provides concrete Obsidian-native agent tools. It adapts abstract tool contracts from `@pivi/pivi-agent-core/tools` to Obsidian vault operations, CLI-backed gaps, frontmatter handling, vault edit helpers, history recovery, and injected image generation that persists outputs as Obsidian attachments.

## Public entrypoints

- `src/index.ts` re-exports all tool creators, settings, types, frontmatter helpers, and vault edit helpers. Default export is `createObsidianTools`.
- `src/createObsidianTools.ts` constructs the full `ToolSpec[]` from an Obsidian `App`, settings, and optional image generator.
- `src/obsidian/` contains per-tool factories plus their shared dependency, read-range, and result helpers. Tool factories accept `ObsidianToolDeps` and return `ToolSpec` values.
- `src/obsidian/deps.ts` defines shared tool dependencies: vault API, external-file API, CLI transport, settings, vault name, and optional image generator.
- `src/obsidian/history.ts` defines `obsidian_history`; it uses the Obsidian CLI history commands to list, read, and restore stored file versions, including deleted files when history exists.
- `src/obsidian/daily.ts` defines `obsidian_daily`; it uses the official Obsidian CLI daily-note commands and avoids daily-notes internals.
- `src/obsidian/graph.ts` defines `obsidian_graph`; it analyzes orphans, deadends, and unresolved links through the injected vault API / MetadataCache, without shelling out.
- `src/obsidian/tags.ts` defines `obsidian_tags`; it lists tags and tag details through the injected vault API / MetadataCache, without shelling out.
- `src/obsidian/base.ts` defines `obsidian_base`; list/views actions use the vault API and `.base` YAML parsing, while query remains explicitly CLI-backed.
- `src/obsidian/markdownStructure.ts` defines `obsidian_markdown_structure`; it extracts Markdown headings with line numbers and character counts so agents can inspect large notes before range-reading sections.
- `src/obsidian/generateImage.ts` defines `obsidian_generate_image`; it consumes an injected image-generator port, saves binary output through `ObsidianVaultApi`, and optionally inserts standard Markdown `![](...)` embeds into notes. It intentionally ignores Obsidian's wiki-link attachment preference because wiki-style image embeds are not reliably recognized in every context.
- `src/obsidian/bash.ts` defines `obsidian_bash`; it is registered only when `allowBash` is enabled, runs one single-line allowlisted host command, and rejects shell control syntax before invoking the injected process runner. Its schema describes it as a lowest-priority host diagnostic, never a vault file tool.
- `src/obsidian/readExternal.ts` defines `obsidian_read_external`; it reads external files by absolute path through the injected `ExternalFileApiLike`, with stats, automatically paged complete-line ranges, and large-file handling. Gated by `allowExternalRead` plus allowed external directory roots from settings/current session context.
- `src/obsidian/listExternal.ts` defines `obsidian_list_external`; it lists direct children of an external folder by absolute path. Gated by `allowExternalRead` plus allowed external directory roots from settings/current session context.
- `src/obsidian/readShared.ts` and `src/obsidian/readTypes.ts` own shared line-span, stats, and complete-line range pagination used by `readNote.ts` and `readExternal.ts`. Explicit ranges that exceed `maxChars` return a bounded page plus `nextStartLine`; only an individually oversized first line fails.
- `src/settings.ts` resolves Obsidian tool settings, disabled tool names, CLI toggles, command/Bash allowlists, external-read enablement, and allowed external directory roots.
- `src/frontmatter.ts` owns YAML frontmatter parsing and slug/name validation.
- `src/vaultEditMatch.ts` builds actionable edit-mismatch messages.

## Boundaries

- Tool implementations use `@pivi/obsidian-host` APIs and the Obsidian CLI transport where public API coverage is unavailable.
- Image generation tools depend only on an injected generator port; Pi/Codex provider wiring stays in app/Pi composition.
- Do not import UI renderers. Return structured/text tool results and let UI packages render them.
- Mutating vault operations execute directly; optional tools are setting-gated: `allowCommand`, `allowBash` plus `bashAllowlist`, `allowEval`, and `allowExternalRead` plus allowed external directory roots for external filesystem tools.
- Keep CLI-backed or external filesystem behavior explicit and setting-gated. Do not add hidden fallbacks for required operations.
- Preserve old-string mismatch diagnostics; do not suppress edit failures with best-effort rewrites.

## Tool display contract

- Obsidian tool factories in `packages/obsidian-tools/src/obsidian/*` define execution only: `name`, `label`, `description`, parameters, and result shape.
- Any new Obsidian tool constant must be added to `packages/pivi-agent-core/src/tools/obsidianToolNames.ts`, and its complete Chat presentation entry must be added once to `packages/pivi-agent-core/src/tools/toolPresentation.ts`. That canonical entry owns kind, icon, translation key, visibility/grouping, and pure summary behavior; tests must cover the descriptor and both renderer surfaces.
- Chat UI renderers must use `appendToolIcon`/`getToolIcon`; they must not hardcode Obsidian tool icon names or add per-tool CSS sizing.
- Tool-call alignment is class-based: standard 16px `.pivi-tool-icon`, 14px only through `.pivi-tool-icon--small`, and no ad hoc `margin-top`/`transform` nudges for tool icons.
- Vault skills such as `defuddle` are not `@pivi/obsidian-tools` tools; every skill/tool call rendered in a nested/subshell tool list must use the shared `TOOL_SKILL`/`getToolIcon`/`appendToolIcon` contract and the same `.pivi-tool-icon` or `.pivi-tool-icon--small` class standard as adjacent tool rows.

## Package map

- `package.json` exports `src/index.ts` only.
- There is no package-local build step; source is consumed by the root build.
- There is no package-local typecheck script. Verify tool changes with the root typecheck and targeted Obsidian tool tests.

## Documentation

Keep durable package rationale in this file. If behavior moves or package boundaries change, update this guide instead of adding separate architecture/spec/note docs.
