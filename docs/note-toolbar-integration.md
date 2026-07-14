# Note Toolbar integration

Pivi can add the current Markdown editor selection to the active chat input as an inline context badge from [Note Toolbar](https://github.com/chrisgurney/obsidian-note-toolbar). This avoids opening the editor context menu whenever you want to attach selected text.

## Automatic setup

1. Install Note Toolbar from Obsidian Community Plugins.
2. Open **Settings → Pivi → Integrations**.
3. Under **Note Toolbar**, choose **Pivi + icon** or **Icon only**.
4. Select text in a Markdown editing view.
5. Select the Pivi item in the toolbar that appears above the selection.

Pivi uses the stable Obsidian command ID:

```text
pivi:add-selection-to-chat-input
```

**Pivi + icon** adds the `message-square-plus` icon with a visible `Pivi` label. **Icon only** adds the same icon without a label. Setup is idempotent when the existing command already matches the selected style. If it uses the other style, Pivi opens that item's Note Toolbar settings so you can clear or restore the label manually; Note Toolbar's CLI can create items but does not currently provide an item-edit command. Pivi never rewrites Note Toolbar's `data.json` directly.

## If Note Toolbar is not installed

Pivi checks for Note Toolbar's installed manifest before enabling any Note Toolbar action. Install it from Obsidian Community Plugins, then reopen the Commands or Integrations settings page. Pivi never installs Note Toolbar automatically.

An installed but disabled Note Toolbar still enables the actions. Pivi asks the official Obsidian CLI to enable it when available; otherwise it opens the plugin page so you can enable it manually.

After a new installation, Note Toolbar still needs to know which toolbar should appear for selected text. In **Settings → Note Toolbar → Display locations → Selected text**, choose an existing toolbar, then return to Pivi settings and run setup again.

Pivi does not silently choose or replace this toolbar because doing so would change the user's Note Toolbar behavior outside Pivi.

## Automatic setup requirements

- Obsidian 1.12.2 or newer for automatic command-item setup.
- Note Toolbar 1.31.06 or newer.
- The official Obsidian CLI enabled under **Settings → General → Command line interface**.
- A toolbar selected under **Settings → Note Toolbar → Display locations → Selected text**.

Pivi and Note Toolbar still work without the CLI, but the setup button opens the relevant Note Toolbar screen and the command item must be added manually.

Custom slash commands use the same gate under **Settings → Pivi → Commands**. Expand a command card, then use **Save** to persist it or **Add to Note Toolbar** to save the current form and add its icon-only command item.

## Manual setup

If automatic setup is unavailable:

1. Open **Settings → Note Toolbar**.
2. Open the toolbar selected under **Display locations → Selected text**.
3. Add a **Command** item.
4. Choose **Pivi: Add selection to chat input**.
5. Use `message-square-plus` as the icon. Add `Pivi` as the label for the text-and-icon style, or leave the label empty for icon-only.

The full command ID is `pivi:add-selection-to-chat-input`.

## What the badge contains

The badge stores a snapshot of the selected context:

- note path and name;
- exact start and end positions;
- the complete touched lines;
- markers around the exact selected text.

Opening the Pivi sidebar is not required before invoking the command. Pivi opens or reuses its view and inserts the badge into the active chat tab.

## Current scope

The command requires an Obsidian Markdown editor and therefore supports Source mode and Live Preview. Reading mode selections are not attached because Obsidian does not provide an `Editor` selection with stable note positions in that mode.

## Configuration safety

Pivi reads the minimum Note Toolbar configuration needed to find the selected-text toolbar and detect an existing command. It does **not** rewrite Note Toolbar's `data.json`.

All automatic mutations go through Note Toolbar's official CLI, so Note Toolbar remains responsible for item defaults, UUID generation, persistence, migrations, and refreshing its rendered toolbar.

## Troubleshooting

### The setup button opens Note Toolbar settings

Choose a toolbar under **Display locations → Selected text**, then run setup again.

### The setup button opens the community plugin page

Enable or update Note Toolbar, then return to Pivi and run setup again. The setup actions remain disabled when Note Toolbar is not installed; automatic item setup currently requires Note Toolbar 1.31.06 or newer.

### The setup button requests manual configuration

Enable the official Obsidian CLI under **Settings → General → Command line interface**, or follow the manual setup steps above.

### The command is already present

Pivi intentionally does not add a duplicate. Edit or move the existing item from Note Toolbar settings if you want to change its appearance or position.
