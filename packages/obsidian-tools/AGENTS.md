# @pivi/obsidian-tools package guide

*This file extends the root [AGENTS.md](../../AGENTS.md). Follow root guidance first, then these package-specific rules.*

## Purpose

`@pivi/obsidian-tools` provides concrete Obsidian-native agent tools. It adapts abstract tool contracts from `@pivi/agent/tools` to Obsidian vault operations, CLI-backed gaps, Obsidian file-history recovery, and injected image generation that persists outputs as Obsidian attachments. The host-neutral `pivi_sessions` tool and recovery port belong to `@pivi/agent` and are composed by the app's shared base provider.

## Architecture

```mermaid
flowchart LR
  App["src/app composition"] --> Registry["createObsidianTools"]
  Registry --> Factories["Obsidian ToolSpec factories"]
  Factories --> Contracts["@pivi/agent/tools + ports"]
  Factories --> Host["@pivi/obsidian-host<br/>vault · path · CLI · process"]
  App -. "injects" .-> Image["image generator port"]
  Image --> Factories
  Factories --> Results["structured / text tool results"]
  Results --> UI["React + imperative renderers"]
  Registry -. "forbidden" .-> Engine["@pivi/engine-pi / raw Pi SDK"]
  Registry -. "forbidden" .-> UI
```

Tool execution depends on host adapters and host-neutral contracts only. Engine-specific image/provider wiring is injected from app composition.

## Public entrypoints

- `src/index.ts` re-exports all tool creators, settings, and types. Default export is `createObsidianTools`.
- `src/createObsidianTools.ts` constructs the full `ToolSpec[]` from an Obsidian `App`, settings, and optional image generator.
- `src/obsidian/` contains per-tool factories plus their shared dependency, read-range, and result helpers. Tool factories accept `ObsidianToolDeps` and return `ToolSpec` values.
- `src/obsidian/deps.ts` defines shared tool dependencies: vault API, external-file API, CLI transport, settings, vault name, and optional image generator.
- `src/obsidian/readNote.ts`, `writeNote.ts`, `editNote.ts`, `search.ts`, `listPath.ts`, `mkdir.ts`, `movePath.ts`, `deletePath.ts`, `openPath.ts`, `noteInfo.ts`, `links.ts`, `properties.ts`, and `attachment.ts` define the core vault tools (`obsidian_read`, `obsidian_write`, `obsidian_edit`, `obsidian_search`, `obsidian_list`, `obsidian_mkdir`, `obsidian_move`, `obsidian_delete`, `obsidian_open`, `obsidian_note_info`, `obsidian_links`, `obsidian_properties`, `obsidian_attachment`) over the injected vault API; mutating paths go through host `requireAgentVaultMutationPath` (containment + Pivi-managed MCP/Skills/Commands namespace rejection with `pivi_*` tool guidance). `obsidian_edit` owns literal exact replacement, including local newline insertion, delimiter removal/repositioning, and explicit `replace_all: true`; its prompt usage must teach shortest-unique-substring newline edits and explain that surrounding text remains adjacent and Markdown block markers require physical-line boundary handling. `obsidian_search` `promptUsage` owns search-not-read: locate notes and match positions; `context: true` dumps are not a substitute for reading note bodies. `obsidian_list` filters direct-child names with an optional case-insensitive substring `query`, then pages the filtered rows with a default 50-entry / maximum 200-entry limit, returns `nextOffset`, and enforces a 50,000-character serialized-result ceiling so one large folder cannot overflow the next model request.
- `src/obsidian/tasks.ts` defines `obsidian_tasks` (CLI-backed; no public task index API). `src/obsidian/command.ts` and `src/obsidian/eval.ts` define the separately gated `obsidian_command` / `obsidian_eval` tools (`allowCommand` / `allowEval`).
- `src/obsidian/history.ts` defines `obsidian_history`; it uses the Obsidian CLI history commands to list, read, and restore stored file versions, including deleted files when history exists.
- `src/obsidian/daily.ts` defines `obsidian_daily`; it uses the official Obsidian CLI daily-note commands and avoids daily-notes internals.
- `src/obsidian/graph.ts` defines `obsidian_graph`; it analyzes orphans, deadends, and unresolved links through the injected vault API / MetadataCache, without shelling out.
- `src/obsidian/tags.ts` defines `obsidian_tags`; it lists tags and tag details through the injected vault API / MetadataCache, without shelling out.
- `src/obsidian/base.ts` defines `obsidian_base`; list/views actions use the vault API and `.base` YAML parsing, while query remains explicitly CLI-backed.
- `src/obsidian/markdownStructure.ts` defines `obsidian_markdown_structure`; it extracts Markdown headings with line numbers and character counts so agents can inspect large notes before range-reading sections.
- `src/obsidian/generateImage.ts` defines `obsidian_generate_image`; it consumes an injected image-generator port, saves binary output through `ObsidianVaultApi`, and optionally inserts standard Markdown `![](...)` embeds into notes. It intentionally ignores Obsidian's wiki-link attachment preference because wiki-style image embeds are not reliably recognized in every context.
- `src/obsidian/bash.ts` defines `obsidian_bash`; it is registered only when `allowBash` is enabled, matches allowlist entries by shell-safe argv prefix, prompts through `CapabilityApprovalPort` on miss, runs single-line commands through the user login shell (`$SHELL -lc`, fish `-c`, or `cmd.exe /d /s /c` on Windows), constrains cwd to the vault, and invokes the injected process runner with shell forbidden at the Node spawn layer. Prefix authorization rejects control operators, substitution, pipelines, redirects, and control syntax for both POSIX shells and cmd.exe. Its schema describes it as a lowest-priority host diagnostic, never a vault file tool.
- `src/bashAllowlist.ts` owns platform-specific safe defaults (`which`/`type`/`pwd` on POSIX and `where`/`cd` on cmd.exe) and delegates shell-safe argv policy shared with capability session grants.
- `src/loginShell.ts` resolves the user's login shell and builds argv for `obsidian_bash` single-line commands (`$SHELL -lc`, fish `-c`, or Windows `cmd.exe /d /s /c`).
- `src/obsidian/readExternal.ts` defines `obsidian_read_external`; it reads external files by absolute path through the injected `ExternalFileApiLike`, with stats, automatically paged complete-line ranges, and large-file handling. Gated by `allowExternalRead`; paths outside allowed roots prompt through `CapabilityApprovalPort`.
- `src/obsidian/listExternal.ts` defines `obsidian_list_external`; it lists direct children of an external folder by absolute path. Gated by `allowExternalRead`; paths outside allowed roots prompt through `CapabilityApprovalPort`.
- `src/capabilityApprovalGate.ts` owns bash/external miss handling against `CapabilityApprovalPort` and session grants.
- `src/obsidian/readShared.ts` and `src/obsidian/readTypes.ts` own shared line-span, stats, and complete-line range pagination used by `readNote.ts` and `readExternal.ts`, plus UTF-16-safe character pagination used by Vault note reads. Content reads resolve a turn-scoped `ReadAllowanceReservation` (via injected `resolveReadMaxChars`), clamp `maxChars` to a 1,000-character minimum so exhausted turn allowances and smaller explicit values can still advance to compaction, then `settle` against the characters actually returned so a stats-only large-file response refunds unused headroom. Explicit line ranges return a bounded page plus `nextStartLine`; an oversized first Vault line switches to line-relative 1-based `startLine` + `startChar` pagination and returns an exact `nextStartLine` + `nextStartChar` pair. Standalone `startChar` remains file-global. Complete model-visible character results (including continuation markers) fit `maxChars` without splitting a surrogate pair or CRLF. External reads retain complete-line pagination. When an explicit `maxChars` is clamped by the remaining turn budget, the stats text says so. Pagination error hints are owned here: `paginateLineRange` names `startLine` plus line-relative `startChar` continuation and the returned `nextStartLine` / `nextStartChar` pair when the first selected line cannot fit; `paginateCharacterRange` tells the caller to stop rather than retry when even one character plus the continuation marker cannot fit. Neither hint instructs raising `maxChars` past the effective clamp.
- `src/settings.ts` resolves Obsidian tool settings, disabled tool names, CLI toggles, command/Bash allowlists, external-read enablement, and allowed external directory roots.

## Boundaries

- Tool implementations use `@pivi/obsidian-host` APIs and the Obsidian CLI transport where public API coverage is unavailable.
- Do not import `@pivi/engine-pi` or raw `@earendil-works/*` SDKs; consume host-neutral `@pivi/agent` contracts only (enforced by ESLint and `check:architecture`).
- Image generation tools depend only on an injected generator port; Pi/Codex provider wiring stays in app/Pi composition.
- Do not import UI renderers. Return structured/text tool results and let UI packages render them.
- Mutating vault operations execute directly; optional tools are setting-gated: `allowCommand`, `allowBash` plus `bashAllowlist`, `allowEval`, and `allowExternalRead` plus allowed external directory roots for external filesystem tools.
- Keep CLI-backed or external filesystem behavior explicit and setting-gated. Do not add hidden fallbacks for required operations.
- Preserve old-string mismatch diagnostics; do not suppress edit failures with best-effort rewrites.

## Tool display contract

- Obsidian tool factories in `packages/obsidian-tools/src/obsidian/*` own `name`, `label`, `description`, parameters, optional detailed `promptUsage`, execution, and result shape. Prompt guidance consumes these actual registered ToolSpecs; never duplicate argument or behavior contracts in a central tool-name switch.
- Any new Obsidian tool constant must be added to `packages/agent/src/tools/obsidianToolNames.ts`, and its complete Chat presentation entry must be added once to `packages/agent/src/tools/toolPresentation.ts`. That canonical entry owns kind, icon, translation key, visibility/grouping, and pure summary behavior; tests must cover the descriptor and both renderer surfaces.
- Chat UI renderers must use `appendToolIcon`/`getToolIcon`; they must not hardcode Obsidian tool icon names or add per-tool CSS sizing.
- Tool-call alignment is class-based: standard 16px `.pivi-tool-icon`, 14px only through `.pivi-tool-icon--small`, and no ad hoc `margin-top`/`transform` nudges for tool icons.
- Vault skills such as `defuddle` are not `@pivi/obsidian-tools` tools; every skill/tool call rendered in a nested/subshell tool list must use the shared `TOOL_SKILL`/`getToolIcon`/`appendToolIcon` contract and the same `.pivi-tool-icon` or `.pivi-tool-icon--small` class standard as adjacent tool rows.

## Package map

- `package.json` exports `src/index.ts` only.
- There is no package-local build step; source is consumed by the root build.
- There is no package-local typecheck script. Verify tool changes with the root typecheck and targeted Obsidian tool tests.

## Documentation

Keep durable package rationale in this file. If behavior moves or package boundaries change, update this guide instead of adding separate architecture/spec/note docs.
