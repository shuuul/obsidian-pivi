# `src/core/mcp/` — MCP config, mention, and test semantics

Core MCP logic for parsing user/server config, managing active MCP context, and testing server connectivity. Concrete Pi MCP connection pooling and OAuth live under `src/pi/mcp/`.

## Rules

- Preserve context-saving semantics: servers are active when toolbar-enabled or explicitly mentioned.
- Keep API prompt mention transformations separate from display/user history text.
- Parser/tester code may understand MCP config shapes, but must not depend on Pi SDK runtime classes.
