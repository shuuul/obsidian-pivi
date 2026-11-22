---
id: "059"
title: "Repository maintenance and Pi 1.6 evaluation"
status: Completed
created: 2026-11-22
updated: 2026-11-22
coordinator: "Codex"
---

# 059 — Repository maintenance and Pi 1.6 evaluation

## Context

Pivi 0.32.2 pins Pi 1.4.0. The dependency audit has new findings, and the existing roadmap calls for evaluating Code Mode in Obsidian.

## Goal and success criteria

- [x] Restore the dependency audit gate and verify the maintenance changes with the local quality gates.
- [x] Verify the synchronized Pi 1.6.0 upgrade against the existing compatibility suites and production build.
- [x] Evaluate the standalone Code Mode package and document an Obsidian integration surface, deployment requirements, and supporting evidence.

## Scope and non-goals

The work covers dependency maintenance, a compatible upgrade of the existing Pi SDK integration, and a Code Mode feasibility study using synthetic tools. Shipping a user-facing Code Mode tool and publishing a release are outside this evaluation.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-11-22 | Use the existing synchronized pin and compatibility manifest workflow. | Pivi already tracks Pi API adaptations and verifies their installed symbols. | WS-01 |
| 2026-11-22 | Continue with a browser Web Worker prototype and an explicit set of vault-local read operations. | Obsidian's Electron renderer rejected Node worker construction and passed the portable Web Worker probe. Per-call dispatch lets Pivi apply its existing validation, read budget, and permission checks. | WS-02 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Dependency audit, Pi upgrade, and validation | Codex | Done | None | Audit, typecheck, lint, boundaries, coverage, compatibility suite, production build |
| WS-02 | Standalone Code Mode packaging experiment and integration design | Pi SWE-2 high | Done | None | Synthetic worker and WASM probe, package-size evidence |
| WS-03 | Review upstream Pi changes for Pivi compatibility and upgrade opportunities | Pi SWE-2 high | Done | None | Compare upstream changes against Pivi integration and tests |

## Verification

Run `npm run check:specs`, `npm run test:pi-compat`, the local CI quality gates, and the production bundle size check. Record whether the configured Obsidian environment can exercise the new build.

## Documentation sync

- Document Code Mode feasibility and follow-up in `docs/10-roadmap-release-and-maintenance.md`.
- Update `docs/12-architecture-status.md` and local guidance if the upgrade changes integration contracts.

## Progress and handoff

### 2026-11-22 — Codex — WS-01

- Baseline typecheck, lint, boundaries, and production build passed. Dependency audit reported 21 unaccepted findings, including a stale allowlist entry. Three UI tests timed out and one smoke fixture child process failed to return an exit status in the initial concurrent coverage run.

### 2026-11-22 — Codex — WS-01

- Synchronized the four direct Pi pins at 1.6.0 and updated transitive audit overrides. Removed the stale `sprintf-js` exception. The Google wrapper now forwards the explicit scoped `fetch` to upstream after validating its identity.
- Verified a clean install, dependency audit, typecheck, lint, boundaries, all 49 Pi compatibility tests, and a 4,376,414-byte production build. The full coverage run with `--maxWorkers=3` passed all 3,357 tests. The four initial failures also passed a focused in-band rerun after clean install.
- The development vault setting was unset. Production build verification covered bundle output. The live Obsidian checks below loaded a temporary synthetic harness in the renderer and left the installed Pivi plugin alone.

### 2026-11-22 — Codex — WS-02

- Built a temporary esbuild CommonJS host and browser IIFE Web Worker around the published portable API. The renderer compiled QuickJS WASM, passed the `WebAssembly.Module` to the Blob worker, and routed `serveCodemodeRemote` exchanges to the host's `RemoteCodemodeSandbox`. Each execution owned its worker and terminated it in `finally`.
- Obsidian's macOS renderer (Electron 43.8.9) rejected a bundled default Node worker via `The V8 platform used by this instance of Node does not support creating Workers`. The portable probe ran two concurrent synthetic reads, had no guest `process`, `require`, or `fetch`, reported timeout and abort for CPU-bound runs, propagated abort into an in-flight host callback, and completed the next invocation. The minified probe used 28,825 bytes for host code, 64,817 bytes for worker code, and 637,405 bytes for raw WASM (287,659 bytes compressed with gzip). A 479,629-byte standalone CommonJS bundle with compressed WASM and inline worker source passed the same renderer checks. The production bundle has 866,466 bytes of headroom before a Code Mode integration. A temporary combined build through the production esbuild options and Node import postprocessing measured 4,855,122 bytes, leaving 387,758 bytes for further integration work.
- Recorded the Desktop integration direction and follow-up validation in the maintainer roadmap.

### 2026-11-22 — Pi SWE-2 high and Codex — WS-02

- The independent Node 24 probe confirmed that tool errors are catchable, an unsettled promise fails promptly, abandoned calls are recorded as cancelled, and exceeding the VM memory cap returns a script error. Its inline sandbox blocked the caller for about 4.5 seconds on a tight loop at the default interrupt budget.
- The live Electron probe selects the portable API in a browser Web Worker. Use Pi `runToolCall` for schema validation, argument preparation, and hooks instead of calling `ToolSpec.execute` directly. Use the portable result call records for transcript presentation.

### 2026-11-22 — Pi SWE-2 high and Codex — WS-03

- Reviewed the 1.4 and 1.6 tarballs. SessionManager v3 and its private adapter, the build facade, OAuth deep imports, MCP authorization, and Codex SSE dispatch remain compatible. New Pi model catalog entries are available through the existing registered providers.
- Pi 1.6 can retain provider-side session resources, including Anthropic message-thread state. Pivi now aborts a discarded Agent and releases resources by that Agent's session id. A regression verifies that repeated cleanup only releases the owned session once. Live provider streaming was not part of the synthetic compatibility run.

## Completion summary

The four synchronized Pi packages are at 1.6.0. The dependency audit, local quality gates, and Pi compatibility suite pass. The maintenance roadmap records the tested Mac Obsidian Web Worker path and bundle budget for a future Code Mode integration. Code Mode product activation and live provider checks remain separate follow-up work.
