# Roadmap, release, and maintenance

[Back to the developer handbook](README.md)

This page records verified technical work and release/documentation routes. It is not a product promise. Items come from current code, tests, and the root quality review; speculative features, dates, and commitments do not belong here.

Keep roadmap entries at the priority/outcome level. When an item becomes long-running or needs multiple agents, link it to a tracked [spec](../specs/README.md) for detailed decisions, workstreams, handoffs, and acceptance evidence instead of expanding the roadmap into an execution log.

## Technical roadmap

### Now

- Complete the two environment-dependent live release-candidate rows: Hover Editor in a vault where that community plugin is installed, and MCP OAuth against a configured test server.
- Keep typecheck, zero-warning lint, boundaries, coverage, production build, and bundle-size gates green.

### Next

- Add direct focused coverage for `ExternalContextSelector` validation: duplicates, parent/child overlap, unavailable roots, pinning, and removal.
- Expand settings hotkey/port-wiring and imperative mention-controller interaction coverage.
- Add keyboard access to archived-tab reveal; the current switcher reveals archived rows through downward wheel progress.
- Continue focused accessibility and owner-realm tests for model/thinking selectors, context indicators, and pop-out interaction.

### Later

- Evolve long-session paging, Agent-run projection, context checkpoints, and the Narrative / Activity / Memory visual language according to [Chat UI evolution](11-chat-ui-evolution.md), promoting only measured and accepted slices into Now or Next.
- Re-measure bundle composition before changing provider dependencies; keep Google provider/auth code bundled unless a tested replacement shim exists.
- Split large modules only when the affected behavior is next changed and the extracted boundary has domain meaning.
- Keep `PiChatService`, `ChatPorts`, React presentation ports, and host ports narrow as capabilities evolve.
- Periodically reconcile the root quality snapshot and this roadmap, moving completed items out rather than retaining stale history.

## 2026-07-16 release-candidate evidence

This matrix distinguishes reproducible repository evidence from live host checks and from integrations that the configured vault cannot exercise. It does not describe tag-generated synthetic data as captured user data.

| Scenario | Status | Evidence |
|---|---|---|
| 0.7.0 session provenance and external-path migration | Complete | `scripts/generate-pivi-070-session-fixture.mjs` checks out the immutable `0.7.0` writer at `f27ca3be149ecf4497f8d2e6ab8a236d14308c59`, verifies the three Pi dependencies at `0.80.6`, and deterministically reproduces `tag-generated-pivi-0.7.0-v3.jsonl` (1,957 bytes; SHA-256 `3c191e3440fc1a95859ddb6a07687a74a2b5cc383062c0fab3b0c53e357ef67b`). The fixture uses synthetic inputs. `piSessionTagGeneratedCompatibility.test.ts` proves HEAD migrates its absolute external paths into the device-local overlay, restores messages/title/MCP data, writes the sidecar marker, and is byte-idempotent on a second open. |
| Main window, pop-out window, and multi-view ownership | Complete | A live three-view layout spanned two owner realms and three React roots. Plugin reload, vault reload, and full app quit/relaunch each restored all three views without captured errors; the two temporary leaves were detached afterward. |
| Inline edit | Complete | The live command mounted exactly one inline-edit modal and React root in an existing note; dispatching Escape through the owner window removed both, with no captured errors. |
| Stored Agent runs / rich execution presentation | Complete | The development-only isolated 20-Agent fixture command exported a main-window trace with the expected two projected transcript messages, two mounted virtual rows, terminal Markdown renders, and no captured errors. Its disposable session was restored/cleaned by the workload contract; the fixed source fixture remained intact. |
| Near-limit Context Inspector | Complete, deterministic | A focused `ChatShell` run injects a 98% authoritative context envelope and verifies the warning state, current total, system/tools estimate, compaction trigger, approximation note, single gauge, and Escape dismissal. Separate owner-realm tests cover pop-out focus/dismissal. No provider-backed turn was fabricated for this check. |
| Hover Editor | Environment-limited | The community plugin is not installed in the configured vault. Pivi's owner-realm and view-lifecycle tests remain green, but the named third-party live integration still requires a vault with Hover Editor installed. |
| MCP OAuth | Environment-limited | The configured vault has no MCP servers or OAuth flow to authorize. Vault/store/service/UI OAuth success and unhappy-path tests pass, but a live redirect/login round trip still requires a configured test server and credentials. |

The same validation run passed 243 suites / 1,859 tests, typecheck, lint, architecture/spec/boundary and i18n dead-key checks, production build, bundle analysis, and the bundle-size gate. The production artifact was 3,071,059 bytes; the concrete development recorder had zero production metafile contribution.

## Standard release route

Pivi uses Conventional Commits and Release Please:

1. Merge conventional changes to `main`.
2. Let `.github/workflows/release-please.yaml` open or update the release PR.
3. Review generated version and `CHANGELOG.md` changes and the Obsidian metadata synchronized by `node scripts/sync-version.js`.
4. Merge the release PR.
5. Release Please creates the GitHub Release; the artifact job builds, attests, and uploads `main.js`, `manifest.json`, and `styles.css`.

While Pivi is pre-1.0, `fix` normally produces a patch and `feat` a minor release. README badge updates come from `scripts/sync-version.js`; do not add generic Release Please README markers.

The Git tag and GitHub Release tag must equal `manifest.json.version` exactly and must not have a leading `v`.

## Manual hotfix route

Use this path only when explicitly requested:

1. Run `npm version patch|minor|major --no-git-tag-version` as appropriate.
2. Run `node scripts/sync-version.js`.
3. Update `.release-please-manifest.json` and `CHANGELOG.md`.
4. Commit `chore(release): prepare x.y.z`.
5. Push `main`, create/push tag `x.y.z` without `v`, and run `.github/workflows/release.yaml` with that tag.

Do not mix standard and manual routes for one version. The manual workflow verifies the tag/manifest invariant, extracts matching changelog notes, generates artifact attestations, and creates or updates the GitHub Release.

## Release artifact invariant

The Obsidian plugin directory and release contain only:

```text
main.js
manifest.json
styles.css
```

Obsidian may create `data.json` at runtime. Do not publish `node_modules`, CLI entrypoints, source caches, credentials, or other Pi artifacts. Both publishing routes retain `id-token: write` and `attestations: write` so release assets have provenance attestations.

## Documentation ownership

| Source | Owns |
|---|---|
| Root `README.md` | User-facing product overview, installation, capability summary, and links |
| `docs/` | New-developer architecture, technology choices, end-to-end flows, development/release routes, and roadmap |
| `specs/` | Long-running execution decisions, workstreams, handoffs, verification evidence, and completion records |
| Root `AGENTS.md` | Repo-wide commands, cross-cutting constraints, commit discipline, release invariants, and current quality snapshot |
| Nested `AGENTS.md` | Package/feature ownership, local seams, gotchas, and focused verification |
| Code/tests/schemas | Executable source of truth |

Avoid copying rapidly changing metrics or exhaustive local symbol lists across multiple layers. Link to the owning source and explain the stable concept.

## Before every commit

Review the staged diff, not only the working tree. Update the relevant numbered document in the same commit when a change affects:

- user-visible behavior or an end-to-end flow;
- a public interface, type, command, tool, or integration contract;
- configuration, credentials, persistence, privacy, or migration semantics;
- package boundaries, ownership, or a technology choice;
- development, validation, build, deployment, or release commands;
- roadmap status or a known limitation described here.

Update the nearest nested `AGENTS.md` when its module map, seam rule, invariant, or gotcha becomes inaccurate. Behavior-preserving internal refactors and test-only changes do not require documentation churn unless they invalidate a path, verification command, or documented maintenance rule.

When work has an active spec, update its decisions, workstreams, evidence, and handoff in the same change. A spec may move to `specs/archive/` only after its success criteria pass, durable conclusions are reflected in the relevant numbered docs, and the nearest affected `AGENTS.md` files remain accurate up through their parent guidance.

Documentation freshness is a review responsibility. Structural checks can find broken links, invalid numbering, and missing files, but they cannot prove that prose matches behavior.

## Documentation review checklist

- `docs/README.md` links every numbered page once, in numeric order.
- Every content page is named `NN-kebab-case.md` and links back to the index.
- Deleted/renamed pages have no remaining repository references.
- Commands, settings, file paths, public types, and persisted fields exist in the current tree.
- Mermaid nodes and edges correspond to verified ownership or data flow.
- README, docs, root guidance, and nested guidance do not contradict each other.
- Completed roadmap items are removed or moved; exact metrics are refreshed only from a current validation run.
- Every active or archived spec passes `npm run check:specs`; archived specs record their final verification and documentation sync.
