# Implementation notes

Informal engineering log. **Not** normative—promote stable conclusions to `docs/architecture/` or `docs/specs/`.

Suggested files (create as needed):

- `pi-agent-core-notes.md` — version bumps, breaking SDK changes
- `mcp-oauth-gotchas.md` — callback port, Electron browser open
- `obsidian-plugin-notes.md` — esbuild externals, mobile constraints
- `prompt-experiments.md` — A/B on system prompt sections

When a note repeats in three+ PRs, extract an architecture section or spec update.

When a note is implemented or superseded, update its frontmatter/status line (`implemented`, `partial`, `obsolete`, or `superseded by …`) so future agents do not treat old follow-up notes as current plans.
