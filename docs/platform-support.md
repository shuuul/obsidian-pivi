# Platform support

Pivi is a desktop-only Obsidian plugin. The tiers below describe current project testing and maintenance, not a guarantee that every feature works on every machine.

| Platform | Tier | Evidence and scope |
|---|---|---|
| macOS | Supported | Primary development platform; focused path, process, MCP, and Skills security tests run in CI. The real Obsidian lifecycle smoke is available and requires a maintainer's configured macOS vault. |
| Windows | Preview | Focused path, process, MCP, and Skills security tests run in CI. Full product and real-Obsidian smoke coverage are not continuous. |
| Linux | Preview | The full quality-gate suite runs on Ubuntu CI. Full product and real-Obsidian smoke coverage are not continuous. |
| iOS | Not supported | `manifest.json` declares `isDesktopOnly`; desktop process and integration capabilities are required. |
| Android | Not supported | `manifest.json` declares `isDesktopOnly`; desktop process and integration capabilities are required. |

Preview-platform bug reports are welcome when they include exact Pivi and Obsidian versions and minimal reproduction steps. See [support routes](../SUPPORT.md).
