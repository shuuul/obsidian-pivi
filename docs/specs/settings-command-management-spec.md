# Settings command management spec

Status: implemented

Related architecture:
- [UI integration](../architecture/ui-integration.md)
- [Tool system](../architecture/tool-system.md)

## Problem

Pivi settings mixed provider, MCP, environment, hotkey, and slash-command concerns in a small set of tabs. Custom slash commands existed through the chat `/create-command` entry, but there was no settings surface to review, edit, or delete them. The UI copy also described commands under `.pivi/commands/` while the implementation wrote `.pivi/templates/`.

## Goals

- Reorder settings into task-oriented areas:
  - General
  - Models
  - Skills
  - Commands
  - MCPs
- Add a Commands settings area for vault-level custom slash commands.
- Store new custom command Markdown files under `.pivi/commands/`.
- Continue reading and deleting legacy `.pivi/templates/` command files so existing vaults keep working.
- Use Pi workspace services for command catalog refresh/listing.

## Non-goals

- Replacing the slash-command Markdown format.
- Moving vault skills into the Commands tab. Skills remain rendered by the Pi settings/workspace services for now.
- Introducing a new JSON settings field for custom commands.

## User experience

The settings tab groups broad user preferences, chat behavior, hotkeys, shared environment variables, and Pi agent environment variables under General. Agent model providers, vault skills, custom commands, and MCP servers each have their own tabs.

The dedicated Commands tab shows:

1. A short description of vault-level custom commands.
2. A custom command list with add, edit, and delete actions.
3. The existing hidden slash command textarea.

Custom command modals capture:

- command slug used after `/`
- dropdown description
- argument hint
- template prompt body

Saving refreshes slash command catalog caches in open Pivi views.

## Data model

Custom command files are Markdown with optional YAML-style frontmatter:

```markdown
---
description: Explain the selected text
argumentHint: text
---
Explain this:
{{selected_text}}
```

Primary path:

```text
.pivi/commands/<command-id>.md
```

Legacy read/delete path:

```text
.pivi/templates/<command-id>.md
```

When command IDs exist in both directories, `.pivi/commands/` wins. Editing a legacy command writes the updated file to `.pivi/commands/` and removes the legacy file when possible.

## Acceptance criteria

- New commands created from chat or settings are written to `.pivi/commands/`.
- Existing `.pivi/templates/` commands still appear in the slash dropdown and settings list.
- Settings can add, edit, and delete custom slash commands.
- Open chat views refresh slash command caches after command changes.
- `npm run typecheck`, `npm run lint`, targeted tests, and `npm run build` pass.
