# @pivi/tools package guide

## Purpose

`@pivi/tools` is the pure TypeScript shared tool protocol/display-model package. It defines tool names, tool specs, tool classifications, icons, standard result helpers, diff/todo parsers, approval rules, task/subagent lifecycle contracts, and input/result extraction utilities.

## Public entrypoints

- `src/index.ts` re-exports the public surface.
- `src/ToolSpec.ts` defines the minimal `ToolSpec` contract.
- `src/toolNames.ts` defines generic agent tool names and classification helpers.
- `src/obsidianToolNames.ts` defines Obsidian-specific tool names and mutating-tool helpers.
- `src/toolIcons.ts` maps tools to Lucide icon names and MCP markers.
- `src/toolInput.ts` extracts resolved ask-user answers from tool results.
- `src/toolResult.ts` builds standard text tool results.
- `src/toolResultContent.ts` flattens tool result content blocks.
- `src/diff.ts` computes/parses structured patch and apply-patch diffs.
- `src/todo.ts` parses todo tool input and derives todo visualization models.
- `src/taskTypes.ts` defines task result interpretation and subagent lifecycle adapter contracts shared by tool adapters and UI presenters.
- `src/approval/ApprovalManager.ts` describes actions and matches approval patterns.
- `src/approval/SessionApprovalRules.ts` stores in-memory per-session approval rules.

## Boundaries

- Keep this package pure TypeScript. No Obsidian API, DOM, Electron, Node filesystem, Pi SDK, MCP SDK, UI renderers, or tool implementations.
- Add tool names/classifiers here before tool implementations or UI rendering code depends on them.
- Preserve exact tool-name constants; changing names requires migrating all callsites and persisted references.
- Diff and todo helpers should parse structured data defensively but return explicit empty/error states instead of throwing for expected malformed tool input.
- Approval pattern logic must remain deterministic and side-effect free except for the session approval rule store.

## Package map

- `package.json` exports the barrel, source subpaths, and approval subpaths.
- There is no package-local build step; source is consumed by the app build.
- The package-local `typecheck` script is a placeholder. Verify protocol/helper changes with root typecheck and targeted tool/UI tests.

## Documentation

Keep durable package rationale in this file. If behavior moves or package boundaries change, update this guide instead of adding separate architecture/spec/note docs.
