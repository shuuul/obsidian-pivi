*This file extends the root [AGENTS.md](../../AGENTS.md). Follow root guidance first, then these local rules.*

# Pivi Styles

## Purpose

- `src/styles/` contains the modular CSS source for Pivi's Obsidian UI.
- These modules style the sidebar chat, rendered messages and tool calls, composer toolbar, context features, inline editing, modals, settings, and accessibility states.
- The generated root `styles.css` is the release artifact; make source changes here rather than editing `styles.css` directly.

## Build flow

- `src/styles/index.css` is the authoritative import manifest and cascade order.
- `scripts/build-css.mjs` parses the manifest's `@import` statements, resolves each path within `src/styles/`, concatenates modules in declaration order, and writes root `styles.css`.
- Development output retains module headers and formatting. Production output removes ordinary comments and whitespace while preserving the Style Settings `/* @settings ... */` metadata block.
- Imports must resolve to `.css` files inside `src/styles/`.
- Every CSS file below `src/styles/`, except `index.css`, must be imported. Missing imports, missing files, invalid paths, an empty manifest, or a missing manifest fail the build.
- Add, remove, or rename a module together with its `src/styles/index.css` entry.

## Directory layout

- `src/styles/base/`: shared custom properties, container utilities, themes, and animations; loaded first.
- `src/styles/components/`: core chat structure—header, tabs, messages, markdown, navigation, code, thinking/tool/subagent/status displays, composer input, mentions, and context footer.
- `src/styles/toolbar/`: model, mode, thinking, external-context, and MCP selectors inside the composer toolbar.
- `src/styles/features/`: feature-specific chat and editor UI, including file/image context, embeds and modals, inline edit, diffs, slash commands, questions, and todos.
- `src/styles/modals/`: standalone modal styling, currently MCP configuration.
- `src/styles/settings/`: settings navigation and shared layout plus slash, MCP, plugin, and agent-specific rules. `settings/base.css` owns shared `.pivi-sp-*` structures.
- `src/styles/accessibility.css`: shared focus-visible behavior; intentionally loaded last.
- `src/styles/index.css`: build manifest only; do not place normal rules here.

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
- A new CSS file that is not imported does not remain silently unused—the build fails until it is listed in `src/styles/index.css`.
- Use `!important` only to defeat known host/theme `!important` rules. Current intentional cases are compact tab-title input normalization in `components/tabs.css` and inline-diff button resets against `.cm-content button` theme rules in `features/inline-edit.css`.
- Obsidian themes and CodeMirror use high-specificity selectors. Prefer tighter Pivi scoping before introducing new `!important` declarations, and document the host rule being overridden.
- Toolbar dropdowns rely on coordinated positioning, hover/focus states, and high `z-index` values; changing overflow or stacking contexts in the composer can hide them.
- Inline-edit styles target CodeMirror 6 decorations and `.pivi-inline-edit-modal.cm-editor`; broad selectors can leak into normal editors.
- Some small modules are intentionally shared or placeholders, such as `settings/agent-settings.css`; keep them imported so the manifest remains a complete inventory.
