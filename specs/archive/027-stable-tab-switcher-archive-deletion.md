---
id: "027"
title: "Stable tab switcher archive deletion"
status: Completed
created: 2026-07-22
updated: 2026-07-22
coordinator: "Amp"
---

# 027 — Stable tab switcher archive deletion

## Context

`ChatTabBar` keeps the tab switcher mounted while a tab row plays its exit animation, then calls `closeTab()`. The tabs store publishes a new immutable snapshot after the archived tab is destroyed. React can remove that keyed row in place, but the switcher's active-tab centering effect currently depends on the reconstructed `openItems` array. Because that array receives a new identity on every tab snapshot, deleting an archived tab reruns the opening-time centering logic and writes `menu.scrollTop` again.

The visible result looks like the entire switcher refreshed: the viewport jumps back around the active open tab instead of remaining where the user was managing archived tabs. This is presentation behavior, not a `TabManager` lifecycle problem. Closing must still destroy the archived tab and publish the tabs snapshot; the React switcher should treat that snapshot as an in-place keyed list mutation.

“Do not refresh” therefore means all of the following: preserve the same open menu DOM instance, keep archived rows revealed, do not replay menu entry state, do not recenter or explicitly reset `scrollTop`, and let the surviving ordered rows fill the removed row's space. In input-position mode the menu remains bottom-anchored to its trigger, so content above the removed archived row naturally extends downward; in header mode the equivalent top-anchored list compaction is accepted. Native browser scroll-range clamping when total content becomes shorter is not considered a refresh.

## Goal and success criteria

Deleting an archived tab from an open tab switcher removes only that row and leaves the switcher viewport spatially stable.

- [x] Closing a visible archived tab keeps the switcher open and preserves the same `.pivi-tab-switcher-menu` element.
- [x] The archived section remains revealed after the tabs-store snapshot removes the closed tab.
- [x] Archived-tab deletion does not rerun active-tab centering and does not assign a new opening-window `scrollTop`; the browser may only clamp the existing value to its new valid maximum.
- [x] The deleted row exits once, disappears after the existing exit duration, and surviving rows retain their relative order while filling the vacated space without a second list/menu animation.
- [x] Input-position mode remains bottom-anchored, so the upper content moves downward naturally as the menu becomes shorter rather than the whole menu jumping to the active tab.
- [x] Header-position mode receives the same no-recenter behavior while retaining its existing top anchor.
- [x] If keyboard focus was inside the deleted row, focus moves to the nearest surviving visible tab row (or the trigger when none remains) without closing the switcher.
- [x] Opening a previously closed switcher still performs the existing one-time ten-row active-tab centering behavior.
- [x] Archiving an open tab, restoring an archived tab by activation, reordering, closing a normal tab, switching the active tab, and opening/closing the menu retain their existing semantics.
- [x] Restoring an archived tab by clicking its row or restore action keeps the same switcher menu mounted, preserves archive reveal and user-owned scroll position, and does not replay active-tab centering.
- [x] Restore stability holds in header and input placement; the restored row moves into the open section through normal keyed reconciliation without closing/reopening the switcher.

## Scope and non-goals

In scope:

- Separation of one-time menu-open viewport initialization from updates to the tabs snapshot.
- In-place keyed archived-row removal using the existing exit animation and tabs-store publication.
- Scroll, reveal, menu-instance, ordering, and keyboard-focus regression tests in both tab-bar positions.
- Reduced-motion verification for the same spatial semantics without relying on animation timing.
- Documentation/guidance synchronization and live Obsidian verification.

Not in scope:

- Preventing React from rendering after a store update; a render is required to remove the row.
- Changing `TabManager.closeTab()` destruction, persistence, active fallback, or archived/open lifecycle rules.
- Virtualizing the tab switcher or changing its ten-row cap.
- Changing the archived reveal gesture, archive/restore semantics, row order, sorting boundary, menu placement, or exit duration.
- Persisting tab-switcher `scrollTop` across menu close, plugin reload, view recreation, or Obsidian restart.
- Animating every surviving row with FLIP/layout transitions; natural layout compaction is sufficient.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-22 | Treat active-tab centering as a closed→open initialization only, not as a reaction to `snapshot.items` or reconstructed `openItems`. | Current dependency identity causes the apparent refresh. Once open, the user's scroll position owns the viewport. | WS-01, WS-02 |
| 2026-07-22 | Preserve the menu node, `isArchivedRevealed`, and current scroll position across archived-row deletion; rely on native scroll clamping if content shrink makes the old offset invalid. | Avoids synthetic scroll compensation and preserves the trigger-side spatial anchor in both header and input placement. | WS-01, WS-02 |
| 2026-07-22 | Keep stable tab IDs as React keys and remove only the committed archived row after its existing exit animation. | React can reconcile the list locally; remounting or regenerating keys would replay menu/row state and break focus. | WS-01 |
| 2026-07-22 | Transfer focus to the nearest surviving visible row after deleting the focused row, falling back to the switcher trigger. | A stable visual viewport must not leave keyboard focus on a detached element. | WS-01, WS-02 |
| 2026-07-22 | Do not add a special tabs-store event type solely for deletion. | The owning React component can distinguish menu opening from ordinary immutable snapshot updates; the store contract already carries stable IDs. | WS-01 |
| 2026-07-22 | Keep the switcher open when an archived row is restored; ordinary open-tab activation may retain its existing close behavior. | Closing the menu discards viewport/reveal state and makes restore look like a refresh. The existing open-only centering rule already makes immutable restore snapshots stable when the menu stays mounted. | WS-04 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Refine `ChatTabBar` viewport initialization and deletion/focus handling so archived-row removal reconciles in place without recentering or remounting. | Amp | Done | None | Focused `ChatShell` tab-switcher tests |
| WS-02 | Add deterministic header/input tests for menu identity, reveal state, scroll ownership/native clamping, row order/fill, focus transfer, one-time open centering, and reduced motion. | Amp | Done | WS-01 | `npm run test -- --runInBand tests/pivi-react/ChatShell.test.tsx` |
| WS-03 | Run cross-tab lifecycle/reorder regressions, synchronize durable guidance, build/deploy, and verify the archived deletion interaction in Obsidian. | Amp | Done | WS-01–WS-02 | Focused/full gates, build/deploy, and Obsidian CLI reload evidence |
| WS-04 | Preserve the open switcher across archived-tab row/action restore, add header/input viewport regressions, update guidance, and redeploy. | Amp | Done | WS-01–WS-03 | Focused `ChatShell` tests, lifecycle regression, and live-vault inspection |

## Verification

Automated:

- Extend `tests/pivi-react/ChatShell.test.tsx` with more than ten open tabs plus multiple archived tabs. Open around a late active tab, reveal archives, record the menu element and scroll offset, close an archived row, publish a store snapshot without that ID, and assert:
  - the menu node is referentially identical and remains open/revealed;
  - no code-driven recenter occurs after deletion (allow native max-range clamping);
  - the deleted row is gone and surviving row IDs remain ordered;
  - focus transfers from the removed row to the nearest survivor;
  - closing/reopening still centers once around the active tab.
- Run the same behavioral matrix for `position: 'header'` and `position: 'input'` and under reduced motion.
- `npm run test -- --runInBand tests/pivi-react/ChatShell.test.tsx`
- `npm run test -- --runInBand tests/unit/features/chat/tabManagerLifecycle.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm run check:boundaries`
- `npm run test -- --runInBand`
- `npm run build`
- `npm run check:bundle-size`
- `npm run check:specs`

Manual live-vault protocol:

1. Prepare more than ten tabs and at least three archived tabs, with the active open tab outside the first ten-row window.
2. Run `npm run build && obsidian plugin:reload id=pivi`.
3. Test header position: open the switcher, reveal/scroll to archived tabs, delete the middle archived tab, and verify the menu stays open at the same viewport while adjacent rows fill the gap.
4. Repeat in input position and verify the menu remains attached above the trigger while upper content extends downward as the archived row disappears.
5. Delete the archived row currently holding keyboard focus and verify focus moves to a neighboring row without closing the menu.
6. Close and reopen the switcher and verify it still centers around the active tab at open time.
7. Restore an archived tab once by clicking its row and once through its restore action; verify the menu, archive reveal, and scroll position remain stable while each restored row moves into the open section.
8. Verify archive, normal close, active switch, pointer reorder, and keyboard reorder still work.
9. Run `obsidian dev:errors` and expect `No errors captured.`

## Documentation sync

- Numbered developer docs: update `docs/11-chat-ui-evolution.md` with the open-time centering versus in-menu spatial-stability rule.
- Nearest local guidance: update `packages/pivi-react/AGENTS.md` with the tab-switcher viewport invariant.
- Parent/package guidance: no `src/ui/chat/AGENTS.md` change unless implementation alters the runtime/store seam; this should remain React presentation-only.
- Root guidance and roadmap: none unless implementation changes a root architecture statement or tracked roadmap item.

## Progress and handoff

Append entries rather than rewriting another agent's record.

### 2026-07-22 — Amp — specification and repository analysis

- Changed: Defined archived-tab deletion as an in-place list mutation, separated opening-time centering from live snapshot updates, and specified menu/scroll/reveal/focus invariants for header and input placement.
- Evidence: `ChatTabBar` currently keys rows by stable tab ID and keeps the menu mounted, but its centering effect depends on `openItems`, which is reconstructed after every tabs snapshot and writes `menu.scrollTop` again. Existing `ChatShell` tests cover ten-row opening centering and action delegation but not deletion stability.
- Remaining: Implement and verify WS-01–WS-03 after approval.
- Blockers: None.
- Next action: Approve the Draft, set it to `Active`, and claim WS-01.

### 2026-07-22 — Amp — activation

- Changed: Activated the approved viewport-stability decisions and claimed WS-01–WS-03 after completing spec 026 implementation and automated gates.
- Evidence: The root cause remains the opening-centering effect's dependency on reconstructed `openItems` identity.
- Remaining: Implement one-time opening centering, focus fallback, tests, docs, and deployment.
- Blockers: None.
- Next action: Refine `ChatTabBar` without changing tab-manager lifecycle semantics.

### 2026-07-22 — Amp — completion

- Changed: Limited active-tab centering to the closed-to-open transition, kept the open menu and archived reveal state stable during deletion, and transferred focus after a focused row exits.
- Evidence: Header/input and reduced-motion regression coverage passes alongside tab lifecycle tests; `npm run typecheck`, `npm run lint`, `npm run check:boundaries`, `npm run build`, `npm run check:bundle-size`, and the full 286-suite/2,233-test run pass.
- Remaining: User visual acceptance of archived-row deletion in the deployed switcher.
- Blockers: None.
- Next action: Reveal archived tabs in the reloaded vault, scroll the switcher, and delete a row to confirm spatial stability.

### 2026-07-22 — Amp — archive-restore follow-up

- Changed: Reopened the spec after review clarified that unarchiving must preserve the switcher viewport just like deletion; added restore-specific criteria and claimed WS-04.
- Evidence: Both archived-row activation and its restore action currently call `closeMenu()` before `switchTab()`, discarding the mounted menu, archive reveal state, and user scroll even though the underlying tabs snapshot can reconcile in place.
- Remaining: Keep archived activation open, cover both placements and activation paths, synchronize guidance, build, deploy, and reload.
- Blockers: None.
- Next action: Make menu closing conditional on activating an already-open tab.

### 2026-07-22 — Amp — archive-restore completion

- Changed: Kept the mounted switcher open for both archived-row activation and its restore action. Restored rows now reconcile from the archived section into the open section without discarding archive reveal state or the user-owned viewport; already-open tab activation retains its existing menu-close behavior.
- Evidence: Header/input parameterized `ChatShell` regressions verify menu-node identity, archive reveal, scroll preservation, and row migration for both restore paths. The focused lifecycle suite passes; `npm run typecheck`, `npm run lint -- --no-cache`, `npm run check:boundaries`, `npm run build`, and the full `npm run test -- --runInBand` pass. The final full run reports 286 suites and 2,238 tests passing. Built and deployed artifacts match, Pivi reload reports loaded version 0.14.1, and `obsidian dev:errors` reports no captured errors.
- Remaining: User visual acceptance of delete and restore stability in both switcher placements.
- Blockers: None.
- Next action: Reveal archived tabs in the deployed switcher, set a nonzero scroll position, then delete and restore rows through both restore paths.

## Completion summary

The open tab switcher now treats archived-tab deletion and restoration as in-place keyed list mutations. Both operations preserve the menu node, archive reveal state, and user-owned scroll position in header and input placement, while opening a previously closed switcher still performs one-time active-tab centering. Automated gates, production build, deployment, reload, and runtime error checks pass; only user visual acceptance remains.
