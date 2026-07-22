# Pivi specs

Specs are the repository's tracked execution records for long-running work. They capture decisions, work breakdown, multi-agent coordination, handoffs, and acceptance evidence while a task is in progress.

Specs do not replace stable documentation. Code, tests, schemas, the [developer handbook](../docs/README.md), and the nearest layered `AGENTS.md` files remain the durable sources of truth. Before a spec is completed, move every lasting behavior, interface, boundary, workflow, or maintenance decision into the owning documentation.

Copy [000-template.md](000-template.md) to start a spec.

## Active specs

| Spec | Status | Outcome |
|---|---|---|
| *(none)* | — | — |

## Archived specs

| Spec | Completed | Outcome |
|---|---|---|
| [001-chat-performance-observability.md](archive/001-chat-performance-observability.md) | 2026-07-15 | Development-only real-Obsidian traces, fixed fixtures/workloads, baseline matrix, and enforced chat regression budgets. |
| [002-indexed-jsonl-range-reads.md](archive/002-indexed-jsonl-range-reads.md) | 2026-07-16 | True append, rebuildable indexed JSONL range reads, bounded recent-first UI hydration, and isolated before/after performance evidence. |
| [003-granular-projection-subscriptions.md](archive/003-granular-projection-subscriptions.md) | 2026-07-16 | Reconciled row-structure/block/tool/Agent-run subscriptions with deterministic render isolation and main/pop-out non-regression evidence. |
| [004-sequenced-ui-events-and-visibility-cadence.md](archive/004-sequenced-ui-events-and-visibility-cadence.md) | 2026-07-16 | Sequenced in-memory projection events with anomaly gates, cross-turn Agent ownership, and owner-realm hidden/inactive cadence. |
| [005-checkpoint-and-agent-report-schemas.md](archive/005-checkpoint-and-agent-report-schemas.md) | 2026-07-16 | Additive versioned checkpoints and compact structured Agent reports with terminal-text fallback and old-session compatibility. |
| [006-activity-and-memory-visual-language.md](archive/006-activity-and-memory-visual-language.md) | 2026-07-16 | Canonical localized Activity rows and statuses, truthful elapsed timing, and approximation-marked Memory boundaries for compaction and older history. |
| [007-context-inspector-and-checkpoint-presentation.md](archive/007-context-inspector-and-checkpoint-presentation.md) | 2026-07-16 | Conservative context envelope and compaction headroom, an estimate-labeled owner-realm Context Inspector, and expandable structured or legacy checkpoint Memory boundaries. |
| [008-agent-runs-groups-and-work-shelf.md](archive/008-agent-runs-groups-and-work-shelf.md) | 2026-07-16 | Stable AgentRun projections, grouped Activity/timeline presentation, structured Narrative conclusions, and a default-off cross-tab Active Work Shelf. |
| [009-review-followup-and-release-validation.md](archive/009-review-followup-and-release-validation.md) | 2026-07-16 | Dead-code cleanup, canonical Activity presentation, separated AgentRun derivation, dedicated Shelf coverage, tag-writer migration provenance, and scoped RC evidence. |
| [010-restore-individual-subagent-presentation.md](archive/010-restore-individual-subagent-presentation.md) | 2026-07-16 | Restored one individual subagent-card presentation, removed Agent Group and Active Work Shelf, sanitized report protocol output, and scoped motion to running only. |
| [011-complete-lazy-tool-disclosures.md](archive/011-complete-lazy-tool-disclosures.md) | 2026-07-16 | Complete snapshot-backed lazy tool/subagent bodies, viewport-capped disclosures with one scroll owner (later: tools/steps one third, subagents two thirds), and stable disclosure headers through virtual-row growth. |
| [012-split-subscription-model-identities.md](archive/012-split-subscription-model-identities.md) | 2026-07-17 | Independent OAuth-only Grok/Claude plan model namespaces, safe eager migration, and compact local-provider optional API-key layout. |
| [013-grok-build-subscription-provider.md](archive/013-grok-build-subscription-provider.md) | 2026-07-17 | Historical dedicated Composer catalog work; model-list ownership was later superseded by the upstream xAI catalog. |
| [014-obsidian-review-hardening.md](archive/014-obsidian-review-hardening.md) | 2026-07-17 | Public owner-realm DOM/settings APIs with default-off CLI, lazy stdio MCP, explicit JSON paste import, and reduced Vault enumeration. |
| [015-repository-markdown-refresh.md](archive/015-repository-markdown-refresh.md) | 2026-07-17 | Repository-wide Markdown audit aligned commands, paths, ownership, terminology, quality gates, and historical-document boundaries. |
| [016-release-attestation-hardening.md](archive/016-release-attestation-hardening.md) | 2026-07-17 | Version-unique, single-subject asset provenance plus uploaded-byte verification, validated by the 0.11.3 release. |
| [017-obsidian-attestation-policy-compatibility.md](archive/017-obsidian-attestation-policy-compatibility.md) | 2026-07-17 | Tag-push release publication with byte-for-byte asset verification and no incompatible attestations, validated by the completed 0.11.5 Community review. |
| [018-vault-context-compaction-redesign.md](archive/018-vault-context-compaction-redesign.md) | 2026-07-17 | Fixed-policy two-pass vault compaction over Pi-native context, cut-point, message, and session primitives. |
| [019-live-session-source-mutation-diagnostic.md](archive/019-live-session-source-mutation-diagnostic.md) | 2026-07-19 | Diagnosed an example-vault stale-write guard as a real JSONL inode/content rollback, with the replacing process left unproven. |
| [020-durable-ai-title-persistence.md](archive/020-durable-ai-title-persistence.md) | 2026-07-19 | Persistence-first model-generated titles with fallback preservation and visible write failures. |
| [021-device-local-provider-state.md](archive/021-device-local-provider-state.md) | 2026-07-20 | Device-local provider registry (`pivi.providers.v1`), single-phase cutover, SecretStorage-backed headers and MCP OAuth tokens, and stripped synced provider/model fields. |
| [022-editor-selection-toolbar-and-inline-edit.md](archive/022-editor-selection-toolbar-and-inline-edit.md) | 2026-07-21 | Notion-style selection toolbar and Cursor-style inline edit in the note editor, with provider mutual exclusion, Pivi/Obsidian command shortcuts, archived inline-edit sessions, and full-locale i18n. |
| [023-command-prompt-mentions.md](archive/023-command-prompt-mentions.md) | 2026-07-22 | Slash-command prompts support @file/@folder//skill//MCP mentions with dropdown completion. |
| [024-inline-edit-embedded-surface-and-diff-review.md](archive/024-inline-edit-embedded-surface-and-diff-review.md) | 2026-07-22 | Editor-embedded inline edit surface with full @// selectors, streaming reply, rendered-markdown diff review, and persistent multi-session decorations. |
| [025-pre-write-file-recovery-snapshots.md](archive/025-pre-write-file-recovery-snapshots.md) | 2026-07-22 | Pre-write Obsidian File Recovery snapshots via private `forceAdd()` before Pivi vault note mutations. |

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
