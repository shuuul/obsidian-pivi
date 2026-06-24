# `src/pi/shims/` — Pi/Electron compatibility shims

Runtime shims that adapt Pi packages for the Obsidian Electron renderer environment.

## Rules

- Keep shim side effects explicit and invoked from known runtime/bootstrap paths.
- Prefer the smallest compatibility patch needed for packaged Obsidian.
- Do not add general application logic here.
