# `src/core/tools/` — Provider-neutral tool taxonomy

Core helpers for naming, categorizing, parsing, and rendering tool activity. These files describe tool semantics for UI/core; concrete execution lives in adaptors such as `src/pi/tools/`.

## Tool helper map

```mermaid
flowchart TD
  Names["toolNames.ts<br/>constants + guards"] --> Icons["toolIcons.ts"]
  Names --> Input["toolInput.ts<br/>argument extractors"]
  Names --> Result["toolResultContent.ts<br/>result text normalization"]
  Todo["todo.ts<br/>TodoWrite parsing"] --> Rendering["chat rendering/state"]
```

## Rules

- Keep this layer dependency-light and provider-neutral.
- Add new tool names here when renderers/controllers need stable categorization.
- Do not implement tool execution or Pi `AgentTool` schemas here.
