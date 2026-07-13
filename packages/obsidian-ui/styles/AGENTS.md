*This file extends the package [AGENTS.md](../AGENTS.md). Follow package and root guidance first, then these local rules.*

# Pivi Styles

## Purpose

- `packages/obsidian-ui/styles/` contains the modular CSS source for Pivi's Obsidian UI.
- These modules style the sidebar chat, rendered messages and tool calls, composer toolbar, context features, inline editing, modals, settings, and accessibility states.
- The generated root `styles.css` is the release artifact; make source changes here rather than editing `styles.css` directly.

## Build flow

- `manifest.mjs` is the authoritative module inventory and cascade order.
- `scripts/build-css.mjs` resolves manifest paths within this directory, concatenates modules in declaration order, and writes root `styles.css`.
- Development output retains module headers and formatting. Production output removes ordinary comments and whitespace while preserving the Style Settings `/* @settings ... */` metadata block.
- Manifest entries must resolve to `.css` files inside this directory.
- Every CSS file below this directory must be listed. Missing entries, missing files, invalid paths, or an empty manifest fail the build.
- Add, remove, or rename a module together with its `manifest.mjs` entry.

## Directory layout

- `base/`: shared custom properties, container utilities, themes, and animations; loaded first.
- `components/`: core chat structure—header, tabs, messages, markdown, navigation, code, thinking/tool/subagent/status displays, composer input, mentions, and context footer.
- `toolbar/`: model, mode, thinking, and external-context selectors inside the composer toolbar.
- `features/`: feature-specific chat and editor UI, including file/image context, embeds and modals, inline edit, diffs, slash commands, questions, and todos.
- `modals/`: standalone modal styling, currently MCP configuration.
- `settings/`: settings navigation and shared layout plus slash, MCP, and agent-specific rules. `settings/base.css` owns shared `.pivi-sp-*` structures.
- `accessibility.css`: shared focus-visible behavior; intentionally loaded last.
- `manifest.mjs`: build manifest only; it must not contain CSS rules.

## Conventions

- Prefix plugin-owned classes, custom properties, animations, and highlight names with `pivi-` (`.pivi-*`, `--pivi-*`, `pivi-*`).
- Scope overrides beneath a Pivi root such as `.pivi-container`, `.pivi-settings`, or `.pivi-inline-edit-modal` when touching Obsidian or CodeMirror elements.
- Use Obsidian theme variables (`--text-*`, `--background-*`, `--interactive-*`, `--font-*`) and shared `--pivi-*` tokens instead of duplicating theme colors.
- Keep selectors aligned with the classes and state modifiers emitted by UI code; common state forms include `.is-*`, `.active`, `.selected`, `.visible`, `.enabled`, and BEM-style `--modifier`.
- Prefer logical properties (`margin-inline-*`, `padding-inline-*`, `inset-block-*`) where directionality matters.
- Keep styles with their owning UI feature: chat primitives in `components/`, toolbar controls in `toolbar/`, inline edit and optional interactions in `features/`, and settings-only UI in `settings/`.
- Put shared markdown rules in `components/markdown-content.css`; rendered markdown classes may be on the same element, so preserve compound-selector semantics.
- Preserve the `/* @settings ... */` block in `base/variables.css`; external Style Settings integrations depend on it.

## Gotchas

- Cascade order is functional: base tokens must precede consumers, shared components precede feature overrides, settings base precedes specialized settings files, and accessibility overrides come last. Reordering imports can change behavior.
- A new CSS file that is not listed does not remain silently unused—the build fails until it is added to `manifest.mjs`.
- Use `!important` only to defeat known host/theme `!important` rules. Current intentional cases are compact tab-title input normalization in `components/tabs.css` and inline-diff button resets against `.cm-content button` theme rules in `features/inline-edit.css`.
- Obsidian themes and CodeMirror use high-specificity selectors. Prefer tighter Pivi scoping before introducing new `!important` declarations, and document the host rule being overridden.
- Toolbar dropdowns rely on coordinated positioning, hover/focus states, and high `z-index` values; changing overflow or stacking contexts in the composer can hide them. `.pivi-input-container` stays above `.pivi-messages-bottom-controls` so model/thinking/external menus cover the tab switcher.
- `.pivi-input-container` has no extra bottom inset (`padding: 0`); the toolbar stays at the sidebar bottom as the input wrapper's last column-flex portal child. Keep dropdown stacking / focus-within rules so menus cover the tab switcher.
- Composer context meter styles live in `components/context-footer.css`; the UI is input-only (no output ring class).
- Inline-edit styles target CodeMirror 6 decorations and `.pivi-inline-edit-modal.cm-editor`; broad selectors can leak into normal editors.
- Some small modules are intentionally shared or placeholders, such as `settings/agent-settings.css`; keep them imported so the manifest remains a complete inventory.
