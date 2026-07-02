# @pivi/tools

## Purpose

`@pivi/tools` is Pivi's shared tool protocol and display-model package. It intentionally does not implement tools; concrete Obsidian tool execution stays outside this package.

## Allowed dependencies

- `@pivi/core` pure contracts.
- TypeScript/JavaScript built-ins.

## Forbidden dependencies

- Obsidian API imports.
- Pi SDK imports (external Pi SDK packages).
- MCP SDK imports.
- Feature UI imports.

## Public API

- tool-name constants and classification helpers
- Obsidian tool-name constants (names only, not implementations)
- approval pattern and session-rule helpers
- diff parsing/display helpers
- todo display models and parsers
- tool-result display helpers
- the minimal `ToolSpec` interface for future tool implementations
- Exported through `@pivi/tools`, `@pivi/tools/*`, and `@pivi/tools/approval/*`.
