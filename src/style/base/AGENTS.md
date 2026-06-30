# `src/style/base/` — CSS foundations

Foundational CSS variables, container layout, and animations imported before component/feature styles.

## Rules

- Define reusable `--pivi-*` tokens here before consuming them elsewhere.
- Keep base selectors scoped or foundational; avoid styling unrelated Obsidian UI globally.
- Import new base files through `src/style/index.css`.
