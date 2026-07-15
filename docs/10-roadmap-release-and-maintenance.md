# Roadmap, release, and maintenance

[Back to the developer handbook](README.md)

This page records verified technical work and release/documentation routes. It is not a product promise. Items come from current code, tests, and the root quality review; speculative features, dates, and commitments do not belong here.

## Technical roadmap

### Now

- Complete release-candidate validation against a known pre-upgrade 0.7.0 vault copy.
- Stress real app quit and vault close while multi-view tab persistence and workspace disposal are active.
- Exercise main window, pop-out windows, Hover Editor, inline edit, stored rich tools, MCP OAuth, and multi-view tabs as one release-candidate matrix.
- Keep typecheck, zero-warning lint, boundaries, coverage, production build, and bundle-size gates green.

### Next

- Add direct focused coverage for `ExternalContextSelector` validation: duplicates, parent/child overlap, unavailable roots, pinning, and removal.
- Expand settings hotkey/port-wiring and imperative mention-controller interaction coverage.
- Add keyboard access to archived-tab reveal; the current switcher reveals archived rows through downward wheel progress.
- Continue focused accessibility and owner-realm tests for model/thinking selectors, context indicators, and pop-out interaction.

### Later

- Re-measure bundle composition before changing provider dependencies; keep Google provider/auth code bundled unless a tested replacement shim exists.
- Split large modules only when the affected behavior is next changed and the extracted boundary has domain meaning.
- Keep `PiChatService`, `ChatPorts`, React presentation ports, and host ports narrow as capabilities evolve.
- Periodically reconcile the root quality snapshot and this roadmap, moving completed items out rather than retaining stale history.

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

Documentation freshness is a review responsibility. Structural checks can find broken links, invalid numbering, and missing files, but they cannot prove that prose matches behavior.

## Documentation review checklist

- `docs/README.md` links every numbered page once, in numeric order.
- Every content page is named `NN-kebab-case.md` and links back to the index.
- Deleted/renamed pages have no remaining repository references.
- Commands, settings, file paths, public types, and persisted fields exist in the current tree.
- Mermaid nodes and edges correspond to verified ownership or data flow.
- README, docs, root guidance, and nested guidance do not contradict each other.
- Completed roadmap items are removed or moved; exact metrics are refreshed only from a current validation run.
