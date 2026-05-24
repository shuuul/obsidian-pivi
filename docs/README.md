# Obsius design documentation

Stable design knowledge for **obsius2** lives in this tree. Code tells you *what* runs today; these docs tell you *why* it was built that way and what to change when constraints shift.

## Four layers

| Layer | Path | Purpose | Update frequency |
|-------|------|---------|------------------|
| **Overview** | [overview.md](./overview.md), [glossary.md](./glossary.md), [roadmap.md](./roadmap.md) | Project identity, terms, direction | Rare |
| **Architecture** | [architecture/](./architecture/) | Per-module design (stable) | When a module’s contract changes |
| **ADR** | [adr/](./adr/) | Decision records (append-only) | Every significant architectural choice |
| **Specs** | [specs/](./specs/) | Feature-level PRD + technical spec | With the feature |
| **Notes** | [notes/](./notes/) | Experiments, gotchas, framework quirks | Anytime; promote when stable |

Diagrams: [diagrams/](./diagrams/).

## Where to start

- New contributor → [overview.md](./overview.md) → [architecture/system-architecture.md](./architecture/system-architecture.md)
- Changing MCP / OAuth / prompts → [architecture/tool-system.md](./architecture/tool-system.md), [specs/mcp-integration-spec.md](./specs/mcp-integration-spec.md)
- Replacing Pi or adding a runtime → [architecture/framework-adapters.md](./architecture/framework-adapters.md), ADRs under [adr/](./adr/)

## Workflow (repo is source of truth)

1. **Explore** in Obsidian / Heptabase (optional).
2. **Spec** in `docs/specs/` before medium+ features.
3. **ADR** in `docs/adr/` when choosing between frameworks or changing boundaries.
4. **Implement** in `src/`; PR links spec + ADR.
5. **Architecture** docs updated when the module’s public contract stabilizes.

## PR documentation checklist

```markdown
Related docs:
- Spec: docs/specs/…
- ADR: docs/adr/…
- Architecture: docs/architecture/… (if module contract changed)
```

**Minimum rule**

| Change size | Documentation |
|-------------|----------------|
| Small bug / copy | Code comment or `docs/notes/` |
| Medium feature | Update or add `docs/specs/` |
| Architecture / framework choice | New or superseded ADR |
| Stable module API | Update `docs/architecture/` |

## Templates

- ADR: [adr/_template.md](./adr/_template.md)
- Architecture module: [architecture/_template.md](./architecture/_template.md)
- Spec: [specs/_template.md](./specs/_template.md)
