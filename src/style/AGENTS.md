# `src/style/` — CSS source modules

All plugin CSS is built into root `styles.css` by `npm run build:css`. The build is manifest-driven: every CSS module must be imported from `index.css` in the intended order.

## CSS build graph

```mermaid
flowchart TD
  Index["index.css<br/>ordered imports"] --> Base["base/<br/>variables + foundations"]
  Index --> Components["components/<br/>chat primitives"]
  Index --> Toolbar["toolbar/<br/>model/MCP/context controls"]
  Index --> Features["features/<br/>diff, inline edit, plan, images"]
  Index --> Modals["modals/<br/>dialog surfaces"]
  Index --> Settings["settings/<br/>settings tab panels"]
  Index --> A11y["accessibility.css<br/>focus-visible"]
  Index -- "scripts/build-css.mjs" --> Output["../../styles.css"]
```

## Rules

- Use `.pivi-*` scoped selectors; avoid broad Obsidian/global selectors.
- Prefer Obsidian CSS variables and `--pivi-*` tokens over hardcoded colors.
- Keep focus-visible and keyboard accessibility visible; do not remove outlines without replacement.
- When adding a CSS file, add it to `index.css` or `npm run build:css` will fail.
