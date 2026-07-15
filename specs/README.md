# Pivi specs

Specs are the repository's tracked execution records for long-running work. They capture decisions, work breakdown, multi-agent coordination, handoffs, and acceptance evidence while a task is in progress.

Specs do not replace stable documentation. Code, tests, schemas, the [developer handbook](../docs/README.md), and the nearest layered `AGENTS.md` files remain the durable sources of truth. Before a spec is completed, move every lasting behavior, interface, boundary, workflow, or maintenance decision into the owning documentation.

Copy [000-template.md](000-template.md) to start a spec.

## Active specs

| Spec | Status | Summary |
|---|---|---|
| [003-granular-projection-subscriptions.md](003-granular-projection-subscriptions.md) | Draft | Move streaming text blocks, tools, and Agent runs onto per-entity store subscriptions so one update stops re-rendering the whole row. |
| [004-sequenced-ui-events-and-visibility-cadence.md](004-sequenced-ui-events-and-visibility-cadence.md) | Draft | Converge on one sequenced Chat UI event plane with ownership metadata and a visibility-aware publish cadence. |
| [005-checkpoint-and-agent-report-schemas.md](005-checkpoint-and-agent-report-schemas.md) | Draft | Versioned hierarchical checkpoint and structured Agent report schemas with old-JSONL compatibility tests. |
| [006-activity-and-memory-visual-language.md](006-activity-and-memory-visual-language.md) | Draft | Shared status vocabulary, Activity row/capsule primitive, and Memory boundary chip with full i18n and a11y. |
| [007-context-inspector-and-checkpoint-presentation.md](007-context-inspector-and-checkpoint-presentation.md) | Draft | Conservative context envelope, estimate-labeled Context Inspector on the usage ring, and expandable checkpoint boundary. |
| [008-agent-runs-groups-and-work-shelf.md](008-agent-runs-groups-and-work-shelf.md) | Draft | First-class AgentRun projection, Agent Groups, timeline/inspector, and the optional default-off Active Work Shelf. |

## Archived specs

| Spec | Completed | Outcome |
|---|---|---|
| [001-chat-performance-observability.md](archive/001-chat-performance-observability.md) | 2026-07-15 | Development-only real-Obsidian traces, fixed fixtures/workloads, baseline matrix, and enforced chat regression budgets. |
| [002-indexed-jsonl-range-reads.md](archive/002-indexed-jsonl-range-reads.md) | 2026-07-16 | True append, rebuildable indexed JSONL range reads, bounded recent-first UI hydration, and isolated before/after performance evidence. |

## Numbering and files

- Reserve `000-template.md` for the template. Formal specs use `NNN-kebab-case.md`, beginning with `001`.
- Allocate one more than the highest ID found in both this directory and `archive/`. IDs are permanent: never reuse, renumber, or delete one to close a gap.
- A coordinating agent must create the file and add it to the Active specs index before spawning parallel work. This reserves the ID and gives every agent one shared execution contract.
- Keep `Draft` and `Active` specs in this directory. Once a spec meets its success criteria and completes its documentation sync, set it to `Completed`, move the unchanged filename to `archive/`, and move its index entry to Archived specs in the same change.
- Keep both index tables in ascending numeric order. Every formal spec must appear exactly once in the matching table.

## Lifecycle

| Status | Meaning |
|---|---|
| `Draft` | Intent, scope, or work breakdown is still being made decision-complete. |
| `Active` | The spec is ready and one or more workstreams are being executed. |
| `Completed` | Acceptance and documentation sync are complete; the file belongs in `archive/`. |

Blocking does not add another top-level status. Mark the affected workstream `Blocked` and record the evidence, required decision, and next action in Progress and handoff.

## Multi-agent workflow

- The coordinator owns frontmatter, scope, cross-workstream decisions, the index entry, and final closeout.
- Give each workstream a stable ID. An agent claims a workstream before editing and records its agent/task name in the table.
- Agents should edit only their claimed sections or append-only progress entries. Avoid concurrent edits to the same prose or table row.
- Record decisions before dependent work proceeds. Record verification commands and evidence instead of unsupported completion claims.
- Every handoff states what changed, what remains, blockers, evidence, and the next safe action. The coordinator reconciles conflicting findings against repository facts and tests.

## Documentation sync and closeout

Before moving a spec to `archive/`:

1. Satisfy every success criterion or explicitly record why a criterion was removed through a decision entry.
2. Update the relevant numbered document under `docs/` for lasting behavior, flows, interfaces, configuration, boundaries, technology choices, commands, or roadmap changes.
3. Update the nearest `AGENTS.md` for every changed area, then walk upward until package, feature, and root guidance remain accurate.
4. Record the final verification evidence and completion summary in the spec.
5. Set `status: Completed`, update the date, move the file without renaming it, and move its README entry to Archived specs.

Run `npm run check:specs` before committing. The check validates filenames, numbering, flat frontmatter, required sections, lifecycle placement, and index coverage; it cannot prove that prose matches the implementation.
