# `src/features/shared/components/` — Reusable UI widgets

Provider-agnostic dropdowns, slash-command dropdown, and selection highlight helpers shared across features.

## Rules

- Expose typed callbacks and cleanup/destroy hooks for components that register DOM events.
- Preserve keyboard navigation, visible focus, and ARIA labels.
- Do not import `src/pi/**` or feature-specific controllers.
