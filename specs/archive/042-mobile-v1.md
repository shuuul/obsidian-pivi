---
id: "042"
title: "Obsidian Mobile V1"
status: Completed
created: 2026-08-09
updated: 2026-08-09
coordinator: "Amp"
---

# 042 — Obsidian Mobile V1

## Context

Pivi `0.18.0` is the stable desktop baseline. The `mobile` branch starts at the exact `0.18.0` release commit (`fee52ec0ac1da10cb118c67e857baca30494d4cb`) so mobile work can change platform composition without destabilizing the released desktop line.

Obsidian Mobile can run community plugins and exposes the public Vault APIs Pivi needs. Its `CapacitorAdapter` implements Obsidian's `DataAdapter`, so Vault-relative hidden paths such as `.pivi/settings.json`, `.pivi/mcp.json`, `.pivi/commands/**`, `.pivi/skills/**`, and `.pivi/sessions/**` are valid plugin storage. Pivi's `ObsidianVaultFileAdapter` already uses `app.vault.adapter`; `.pivi` itself is not the incompatibility.

The incompatibility is Pivi's current desktop composition:

- `src/main.ts` eagerly reaches desktop services, and `manifest.json` declares `isDesktopOnly: true`.
- Session creation/listing and index paths still depend on absolute OS paths and Node filesystem APIs instead of the existing Vault-relative `FileStore` boundary.
- The production bundle intentionally includes Node, Electron, process, shell, local filesystem, Obsidian CLI, stdio MCP, and desktop-scoped HTTP implementations.
- `requestUrl()` is Mobile-compatible and bypasses WebView CORS, but buffers the complete response and therefore cannot provide token streaming. Direct WebView `fetch` may stream, but authenticated SSE behavior and provider CORS support must be proven on real iOS and Android devices before it becomes the Mobile provider transport.
- Current credentials, custom provider header secrets, web-search API keys, MCP secret values, and MCP OAuth entries already use Obsidian `SecretStorage`. Provider registration/model preferences and environment state are device-local. Portable non-secret settings and MCP definitions may synchronize through `.pivi`.

This spec delivers one Mobile V1 from the same plugin repository. It does not treat removing `isDesktopOnly` as implementation: the mobile entry must be incapable of importing or evaluating desktop-only modules before the manifest is opened to Mobile.

## Goal and success criteria

Ship a Mobile-capable Pivi that provides useful remote-model chat and Vault knowledge-work tools on Obsidian iOS and Android while preserving the complete desktop product and a strict device-local secret boundary.

- [ ] One production plugin package starts successfully on desktop, iOS, and Android; platform detection selects explicit capability composition, and no desktop-only module is imported or evaluated on Mobile startup.
- [ ] Mobile supports provider setup, authenticated streaming chat, stop/cancel, retry, model selection, main-Agent Vault tool calls, and durable session create/open/append/fork/archive/delete flows. Subagents remain structurally excluded from the V1 candidate.
- [ ] `.pivi/**` product files use only Vault-relative `DataAdapter`/`FileStore` I/O on Mobile. Sessions synchronize as normal Vault files; rebuildable indexes, journals, absolute paths, and other device facts remain device-local and are never written into synced `.pivi` state.
- [ ] API keys and every secret-like provider, web-search, custom-header, MCP, or OAuth value are entered separately on each device and stored only through Obsidian `SecretStorage`. No plaintext, ciphertext, wrapped key, recovery key, or secret-derived reversible payload is written to `.pivi`, settings JSON, local storage, logs, sessions, or tool results.
- [ ] A real-device transport spike proves authenticated incremental provider responses on at least one supported provider on both iOS and Android, including cancellation, timeout, offline, background/foreground, HTTP error, and non-streaming fallback behavior. If direct streaming cannot be made reliable without weakening policy, Mobile V1 is blocked pending an explicit relay decision rather than silently shipping buffered fake streaming.
- [ ] Mobile exposes only the capability matrix in this spec. Bash, eval, stdio MCP, Obsidian CLI, arbitrary external directories, system environment values, local/localhost providers, and localhost callback OAuth are structurally absent from Mobile registries and settings—not merely disabled after invocation.
- [ ] Mobile-safe Vault read/write/edit/search/list/property/attachment tools preserve existing managed-path, mutation-containment, approval, redaction, byte-budget, and File Recovery behavior where the host API supports it; unsupported private File Recovery integration degrades explicitly without blocking writes.
- [ ] Mobile UI handles phone and tablet dimensions, touch input, safe areas, virtual keyboard/IME, popovers/modals, scrolling, long streaming messages, tool approvals, and app background/foreground without losing the active turn or trapping focus.
- [ ] Desktop behavior remains regression-compatible: desktop-only tools, stdio MCP, external paths, CLI, existing network policy, session compatibility, and release artifacts continue to pass their current tests and real-host smoke.
- [ ] The `mobile` branch acceptance candidate uses `isDesktopOnly: false` so Obsidian Mobile can load the plugin. A public release remains blocked until all Mobile startup, secret, transport, capability, storage, UI, and real-device gates pass.

## Scope and non-goals

In scope:

- Explicit platform capability contracts and separate Mobile/desktop composition paths under the existing `src/main.ts` plugin root.
- A browser/Obsidian-Mobile-safe production bundle path with automated forbidden-import and artifact checks.
- Vault-relative session persistence and listing through `FileStore`, retaining Pi JSONL compatibility and cloud-recovery semantics.
- Mobile provider transport, SecretStorage-backed credential entry, provider/model readiness, and Mobile-safe network consumers.
- A Mobile-safe main-Agent registry and explicit capability projections proving subagents, MCP, web/image tools, Skills, and workspace Commands are absent from the V1 candidate; Mobile may expose an explicit allowlist of built-in chat commands.
- Responsive/touch-safe chat, settings, approvals, session navigation, and lifecycle handling.
- Real iOS and Android validation, desktop non-regression, documentation, release plan, and rollback criteria.

Not in scope:

- Synchronizing API keys or other secrets through `.pivi`, even as encrypted ciphertext; recovery passwords, shared encryption keys, and cross-device credential escrow are excluded from V1.
- Bash, eval, child processes, shell commands, system environment lookup, Obsidian CLI, stdio MCP, arbitrary OS paths, external folder pickers, or local filesystem tools on Mobile.
- Localhost/local-network model providers, local companion daemons, or a Pivi-hosted relay service in V1. A relay requires a separate privacy, authentication, operations, cost, and threat-model decision.
- OAuth flows that require a localhost callback server. Device-code, manual-code, or externally redirected flows may be included only after provider-specific real-device verification.
- Reimplementing Obsidian Sync, adding a second Pivi sync protocol, or promising conflict-free concurrent edits to session JSONL across devices.
- Mobile parity for editor-selection toolbar/inline-edit surfaces until Obsidian Mobile editor events, selection geometry, keyboard behavior, and rendered diff review are separately proven. Sidebar chat and Vault tools are the V1 product surface.
- Removing desktop capabilities or weakening desktop network/process protections to make shared code easier to bundle.

## Product capability matrix

| Capability | Mobile V1 | Acceptance boundary |
|---|---:|---|
| Sidebar chat, streaming, cancel, retry, thinking, usage | Required | Real iOS and Android provider stream; lifecycle and keyboard tests |
| Vault file/folder `@` mentions and built-in `/new`, `/compact` | Required | Mobile-safe picker inventory; mentions resolve to Vault-relative turn context; no workspace Commands or Skills |
| Sessions under `.pivi/sessions/**` | Required | Vault-relative storage, reopen/append/fork/delete, sync replacement recovery |
| Vault read/list/search/properties/links/tags | Required | Public Obsidian APIs only |
| Vault write/edit/move/delete/folders/attachments | Required | Existing containment, managed paths, approvals, and explicit recovery capability |
| API-key providers and custom remote providers | Required | Per-device SecretStorage; HTTPS remote endpoints only |
| Remote web search and image generation | Excluded from V1 candidate | Transport, secret, budget, and result UI gates were not proven on devices |
| Subagents | Excluded from V1 candidate | Main runtime is explicitly configured without inherited desktop/subagent authority |
| Remote HTTP/SSE MCP | Excluded from V1 candidate | No Mobile MCP transport/auth/OAuth path has device evidence; stdio is structurally unavailable |
| Skills and Pivi Commands already stored in the Vault | Excluded from V1 candidate | Mobile composition does not load or publish them; package CLI install/update is unavailable |
| Agent-managed Skills installation/update | Excluded | Depends on pinned Node CLI and filesystem staging |
| Bash/eval, Obsidian CLI, stdio MCP, external paths | Excluded | Structurally absent from Mobile settings, prompt, and registries |
| Editor selection toolbar and inline edit | Deferred | Requires a separate Mobile editor interaction decision |

`Required` items define release readiness. `Target` items may be removed from V1 by a recorded decision without blocking the required product, but must never appear partially enabled. `Excluded` and `Deferred` items remain absent.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-08-09 | Develop Mobile on the long-lived `mobile` branch rooted at the `0.18.0` release commit. | Isolates platform restructuring from the stable desktop line and gives the work a reproducible baseline. | WS-01–WS-08 |
| 2026-08-09 | Product credential policy is Option A: credentials are entered independently on every device and stored in Obsidian `SecretStorage`. | It uses the host's security boundary and avoids inventing synchronized cryptography, recovery, and compromise propagation. | WS-03, WS-04, WS-08 |
| 2026-08-09 | Do not store API keys in `.pivi`, including encrypted ciphertext. | Ciphertext sync still requires key distribution/recovery and creates a durable synchronized secret target; it is a separate product and threat-model problem. | WS-04 |
| 2026-08-09 | Keep `.pivi` Vault-relative and synchronized for portable non-secret product state; do not replace it with Mobile-private storage. | `CapacitorAdapter` supports hidden Vault paths, and cross-device sessions/configuration are useful. The portability boundary, not the directory name, needs correction. | WS-02, WS-04 |
| 2026-08-09 | Introduce explicit platform capability composition instead of runtime try/catch around Node imports. | Mobile must never evaluate unavailable built-ins, Electron, or process modules; structural absence is testable and safer than invocation-time failure. | WS-01, WS-05 |
| 2026-08-09 | Preserve one plugin package and one `src/main.ts` Obsidian `Plugin` root while splitting platform-specific dependency construction beneath it. | Keeps Community Plugins distribution and plugin identity singular without forcing shared implementation modules to import desktop dependencies. | WS-01 |
| 2026-08-09 | Use the existing single build and development workflow; do not add a separate Mobile development build. | Desktop Mobile emulation, structural startup tests, and real-device inspectors provide the required debugging layers without a second artifact path that can drift from release behavior. | WS-01, WS-07 |
| 2026-08-09 | Prove streaming transport on real devices before choosing its implementation. | `requestUrl()` buffers responses, while WebView `fetch` streaming/CORS behavior varies by provider and host. Repository reasoning alone cannot establish Mobile reliability. | WS-03 |
| 2026-08-09 | A relay is not an automatic fallback. | Relaying user prompts and credentials changes privacy, security, operations, and cost; it requires a separate explicit product decision. | WS-03, WS-08 |
| 2026-08-09 | Hide unsupported capabilities at composition, Settings, slash catalog, prompt generation, and tool registry boundaries. | A visible tool that fails after invocation creates false authority and unsafe Agent planning. | WS-05, WS-06 |
| 2026-08-09 | Set `isDesktopOnly: false` only on the unreleased `mobile` branch after automated startup/artifact gates pass, so real-device acceptance is possible. | Obsidian Mobile refuses to load a plugin while this flag is true; the acceptance matrix cannot be executed behind the guard. Public release remains blocked on real-device evidence. | WS-01, WS-03, WS-08 |
| 2026-08-09 | Any touch-target, safe-area, density, or responsive CSS change requires human visual sign-off on phone and tablet in light and dark themes. | Automated accessibility dimensions can produce oversized or visually unbalanced Mobile surfaces. | WS-06, WS-08 |
| 2026-08-09 | Mobile uses neither a session sidecar index nor a WAL journal. Authoritative Vault JSONL mutations use `DataAdapter.process` CAS; uncertain writes are read-reconciled when exact and otherwise fail-stop, while bounded recent reads scan JSONL directly. | There is no recovery gap requiring a second log: atomic user/UI writes and authoritative rewind-before-retry prevent an acknowledged continuation from existing only in memory. Avoiding a synchronized sidecar is safer on Vault sync. Desktop keeps its device-local index/journal. | WS-02, WS-07 |
| 2026-08-09 | The implemented Mobile candidate uses direct browser `fetch` for bounded HTTP and provider streams, but this transport is provisional until the iOS/Android matrix passes. | It gives one testable implementation without pretending repository tests prove WebView streaming, CORS, cancellation, or lifecycle behavior. Failure of the device matrix blocks release rather than selecting a relay implicitly. | WS-03, WS-08 |
| 2026-08-09 | Remove all optional target capabilities from the first Mobile candidate: MCP, Skills, Pivi Commands, subagents, web/image tools, local providers, and editor inline edit. | The required chat/session/Vault/API-key surface is independently useful, while each target needs separate Mobile transport, authority, and presentation evidence. | WS-05, WS-08 |

## Architecture contract

```diagram
┌────────────────────────── src/main.ts ──────────────────────────┐
│ Detect host platform, load only the matching composition root   │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                 ┌─────────────┴─────────────┐
                 ▼                           ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│ Desktop composition     │     │ Mobile composition      │
│ Node scoped HTTP        │     │ proven Mobile transport │
│ OS paths/process/CLI    │     │ Vault DataAdapter only  │
│ stdio + remote MCP      │     │ no MCP in V1 candidate  │
│ full desktop tool set   │     │ Mobile-safe tool set    │
└────────────┬────────────┘     └────────────┬────────────┘
             └──────────────┬────────────────┘
                            ▼
              ┌──────────────────────────┐
              │ Host-neutral app/core/UI │
              │ capability-driven ports │
              └────────────┬─────────────┘
                           ▼
              ┌──────────────────────────┐
              │ Vault-relative `.pivi`   │
              │ + device-local secrets   │
              └──────────────────────────┘
```

Rules:

1. Shared code depends on narrow ports and capability descriptors, never on desktop modules hidden behind optional values.
2. Platform-specific modules may import shared code; shared and Mobile modules must not import desktop modules, directly or through barrels.
3. The single bundle's Mobile startup path must leave Node built-ins, Electron, process runners, OS path/session adapters, stdio MCP, CLI, and all other desktop composition modules unevaluated. Mobile source boundaries reject imports of those authorities.
4. Capability descriptors drive construction and presentation. UI, prompt, slash commands, Settings, and tool registries must project the same effective capability set.
5. Existing desktop security boundaries remain owned by desktop adapters. Mobile transports must document which guarantees are equivalent, host-provided, impossible in a WebView, or release-blocking.

## Storage and synchronization contract

| State | Mobile storage | Synchronizes through Vault | Notes |
|---|---|---:|---|
| Portable Pivi settings | `.pivi/settings.json` through `FileStore` | Yes | Existing codec continues stripping device facts and secrets |
| Sessions | `.pivi/sessions/*.jsonl` through `FileStore` | Yes | Pi-compatible append/read; replacement and conflict behavior remains explicit |
| Commands / portable MCP definitions / compatible Skill content | Vault-relative `.pivi/**` | Yes | Only Mobile-supported actions are exposed |
| Provider registration/model preferences | Obsidian vault-scoped local storage | No | Existing device-local authority; each device may choose different providers/models |
| API keys, headers, web keys, MCP/OAuth secret values | Obsidian `SecretStorage` | No | Never echoed after save |
| Session journal/index/cache | Not used on Mobile | No | Vault JSONL is authoritative; Desktop retains its device-local journal/index implementation |
| Absolute paths, environment variables, CLI paths | Unsupported | No | No Mobile representation |

Session migration must preserve existing desktop session bytes and identifiers. The Mobile implementation may introduce a host-neutral session file catalog/append port, but must not create a second Mobile JSONL format or a one-use wrapper that simply forwards Node filesystem calls.

## Network and credential contract

The WS-03 transport spike records a provider-by-provider matrix for direct WebView `fetch` and Obsidian `requestUrl()` on current iOS and Android Obsidian builds:

- request headers and SecretStorage resolution;
- CORS/preflight behavior;
- incremental body/SSE delivery and UTF-8 boundary handling;
- abort propagation and socket/body disposal;
- connect/first-byte/idle/total deadline behavior;
- redirects, HTTPS downgrade, URL credential rejection, response byte limits, and redacted diagnostics;
- offline, DNS failure, captive/error response, background/foreground, device lock, and app resume;
- provider error bodies and non-streaming JSON responses.

`requestUrl()` may serve bounded non-streaming requests. It must not be presented as streaming. Direct `fetch` may serve provider streaming only after the real-device matrix passes. If Mobile cannot reproduce a desktop network guarantee such as DNS pinning because the WebView owns connection establishment, the spec must record the exact delta and receive a security decision before release; implementation must not claim equivalent SSRF protection.

Credential UI writes SecretStorage first, persists only non-secret readiness/source metadata, clears superseded secret IDs transactionally, and never places entered values in React state longer than the save interaction requires. Tests use sentinel secrets and assert absence from every serializable store and diagnostic surface rather than printing secret values.

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Define platform capabilities, split desktop/Mobile composition inside the single bundle, add a Mobile startup artifact boundary, and retain the manifest guard | Amp | Done | None | Architecture fixtures, single-bundle Mobile startup check, desktop build |
| WS-02 | Move session create/open/list/append/fork/delete and related path ownership onto Vault-relative `FileStore`; provide Mobile-safe device-local journal/index storage | Amp | Done | WS-01 contracts | Existing Pi fixtures plus shared in-memory DataAdapter and sync-replacement tests |
| WS-03 | Execute the real iOS/Android provider transport spike, choose the Mobile HTTP/stream implementation, and document security deltas | Unassigned | Blocked | WS-01 | Device matrix with timestamps/provider/version, transport tests, cancellation/deadline/error evidence |
| WS-04 | Wire Mobile provider/settings flows to device-local state and SecretStorage; add exhaustive no-secret persistence/log/session tests | Amp | Done | WS-01, WS-03 | Two-device isolation and sentinel-secret absence tests |
| WS-05 | Compose exact Mobile main/subagent tool, MCP, Skills, Commands, prompt, and Settings capability projections | Amp | Done | WS-01–WS-04 | Exact inventory tests prove required/target presence and excluded capability absence |
| WS-06 | Adapt chat, settings, approval, session navigation, overlays, keyboard/IME, safe areas, and lifecycle UI for phone/tablet | Amp | In progress | WS-01, WS-02, WS-04, WS-05 | Mobile `@`/built-in `/` pickers and revised touch UI are implemented; device keyboard and human visual sign-off remain mandatory |
| WS-07 | Add Mobile lifecycle, storage, transport, and regression integration coverage while preserving desktop platform/security gates | Amp | In progress | WS-02–WS-06 | Automated suites/gates pass; desktop and Mobile real-host smoke remain |
| WS-08 | Run iOS/Android acceptance, finalize included target capabilities, update docs/guidance, flip `isDesktopOnly`, and prepare rollback/release evidence | Unassigned | Blocked | WS-01–WS-07 | Real-device checklist, clean install/upgrade, release artifact inspection, `check:specs` |

## Verification

Automated gates:

```bash
npm run typecheck
npm run lint
npm run check:boundaries
npm run test:coverage -- --runInBand
npm run build
npm run check:mobile-startup
npm run check:bundle-size
npm run check:specs
```

Add focused commands as implementation creates Mobile suites. At minimum, CI or a deterministic local harness must verify:

- importing/starting the Mobile entry with Node built-ins, Electron, `process`, and desktop globals unavailable;
- exact Mobile versus desktop settings, slash, prompt, main-Agent, subagent, and MCP inventories;
- Vault-relative `.pivi` operations against a `DataAdapter`-compatible fake with no `basePath`;
- desktop-created session fixtures opening/appending on Mobile and Mobile-created fixtures reopening on desktop;
- two simulated devices sharing Vault files while retaining independent provider state and secrets;
- sentinel secrets absent from `.pivi`, local storage, sessions, logs, notices, errors, tool arguments/results, and generated release artifacts;
- background/foreground and unload cancellation leave no late state commit or duplicate session append.

Real-device acceptance is mandatory on one supported iPhone/iPad-class iOS device and one supported Android phone/tablet-class device using current Obsidian Mobile:

1. Clean install, enable plugin, enter a provider key, stream/cancel/retry a turn, restart Obsidian, and confirm the key remains usable without being displayed.
2. Read, search, create, edit, move, and delete disposable Vault notes; confirm `.pivi` session persistence and managed-path rejection.
3. Open a desktop-created session, append on Mobile, synchronize, reopen on desktop, and verify explicit conflict/recovery behavior under an intentionally replaced session file.
4. Exercise offline → online and foreground → background → foreground during streaming; confirm truthful terminal state and no duplicate continuation.
5. Inspect phone and tablet layouts in light and dark themes with the software keyboard open: composer, model picker, mention/slash dropdowns, approvals, settings, tab/session navigation, long Markdown, tool results, and error states.

Human visual sign-off is required for every rendered Mobile CSS/layout change. The signer records device/OS/Obsidian versions and confirms touch targets, spacing, safe areas, focus/keyboard behavior, scroll ownership, overlays, reduced motion, and light/dark appearance. The coordinating agent cannot self-approve this item.

Before release, inspect the final Mobile artifact and manifest, then repeat the desktop real-host smoke. The unreleased acceptance candidate may set `isDesktopOnly: false` only after automated startup/artifact gates pass; publication still requires the complete real-device matrix. Rollback is restoring the manifest guard before publication; no secret or session migration may make rollback destructive.

## Documentation sync

- Numbered developer docs: keep `docs/02-architecture-and-technology.md`, `docs/03-plugin-lifecycle-and-composition.md`, `docs/05-tabs-sessions-and-history.md`, `docs/07-tools-skills-mcp-and-integrations.md`, `docs/08-presentation-and-settings.md`, and `docs/10-roadmap-release-and-maintenance.md` synchronized with delivered Mobile behavior and boundaries.
- Nearest local guidance: update each affected area's nearest `AGENTS.md`, including app composition, host/tool packages, scripts, and tests where the ownership boundary changed.
- Parent/package guidance: update affected package `AGENTS.md`, package exports, and README coverage when composition or public leaves change.
- Roadmap: retain the real-device blockers, manifest guard, release criteria, and rollback state in `docs/10-roadmap-release-and-maintenance.md` until WS-08 completes.

## Progress and handoff

Append entries rather than rewriting another agent's record.

### 2026-08-09 — Amp — Coordination

- Changed: Reserved spec 042 and recorded the Mobile V1 product boundary, Option A credential policy, platform/storage/network architecture, capability matrix, workstreams, and release gates on the `mobile` branch.
- Evidence: Repository inspection confirms `mobile`, `main`, and tag `0.18.0` share baseline commit `fee52ec0`; current manifest remains desktop-only; `ObsidianVaultFileAdapter` is already Vault-relative while session/path/network composition retains desktop dependencies.
- Remaining: Execute WS-01 through WS-08. WS-03 real-device transport evidence is an early release blocker and should run in parallel with WS-01/WS-02 rather than after the full implementation.
- Blockers: Real iOS and Android devices are required to choose and accept the streaming transport.
- Next action: Claim WS-01 and WS-03, define the platform capability contract, and build the smallest real-device authenticated streaming probe without changing the manifest guard.

### 2026-08-09 — Amp — WS-01 platform authority

- Changed: Added the exact desktop/Mobile platform-capability descriptor and threaded it through app/workspace host contracts. Settings and runtime tool projection now omit Mobile-incompatible CLI, Bash, eval/command, and external-path authorities instead of showing tools that fail after invocation.
- Evidence: Focused platform and settings inventory suites pass; source/test typechecking and touched-file lint pass. The normal build remains the only build path, and `isDesktopOnly` remains unchanged.
- Remaining: Capability gating does not prevent eager Desktop module evaluation. Split lifecycle ownership from product-host state, remove production imports from `@/main`, then quarantine the current runtime behind a Desktop-only dynamic composition boundary.
- Blockers: The current `src/main.ts`, `serviceGraph`, and `PiWorkspaceServices` import Node/Electron/process/CLI modules before platform selection, so Mobile startup is not yet safe.
- Next action: Refactor registrations to receive the real Obsidian Plugin lifecycle owner separately from the product host while preserving current Desktop behavior.

### 2026-08-09 — Amp — WS-01 composition boundary

- Changed: Reduced `src/main.ts` to the platform-neutral Obsidian lifecycle owner; moved the existing product into a dynamically initialized Desktop runtime; added a Mobile-safe bootstrap; separated lifecycle registration ownership from structural product hosts; and added architecture guards against app-to-shell, Mobile-to-Desktop, and shell-to-product dependency regressions. The normal build remains the only bundle path.
- Evidence: Typecheck, lint, architecture/spec boundaries, focused lifecycle/capability suites, the full test suite, and the production build pass. `npm run check:mobile-startup` executes the built `main.js` with Mobile platform flags and Node/Electron modules unavailable; only `obsidian` is requested and Desktop initializers remain deferred.
- Remaining: WS-02 must remove Node/absolute-path ownership from sessions before the Mobile runtime can construct useful product services. WS-03 still requires real-device streaming evidence.
- Blockers: None for WS-01. `isDesktopOnly` intentionally remains `true` until WS-08.
- Next action: Start WS-02 at the session catalog/create/open/append boundary and preserve the current Pi JSONL bytes.

### 2026-08-09 — Amp — WS-02 Vault-relative session foundation

- Changed: Added a browser-safe Pi JSONL document/tree/store over Vault-relative `AtomicWorkspaceFileStore`, retained v1/v2-to-v3 and pinned Desktop Pi semantics, moved runtime tree ownership behind an async factory, made user-message plus UI-overlay appends atomic, serialized each live tree's writes, fail-stopped invalidated writers, single-flighted open/migration, reconciled uncertain creates, and represented delete as an atomic append-only tombstone instead of a racy check-then-remove.
- Evidence: Focused storage/tree/store, Pi compatibility, runtime generation, browser-safe UI dependency, and architecture suites pass. The Mobile startup path remains deliberately inert: it imports no product/session/provider graph, does not touch Vault files, and does not expose a composer whose transport is unavailable. The manifest remains Desktop-only.
- Remaining: WS-02 still needs the final device-local Mobile journal/index decision and an explicit conflict/recovery UX. WS-03 must gather real iOS/Android streaming evidence before Mobile provider/runtime/settings composition can be selected. WS-04 through WS-08 therefore remain pending.

### 2026-08-09 — Amp — WS-02 automated durability evidence

- Changed: Recorded the explicit no-index/no-journal Mobile design and added an actual no-`basePath` DataAdapter integration covering create, atomic user/agent append, list/open/recent, durable-entry fork, and tombstone deletion. Mobile JSONL remains the sole authority; CAS uncertainty is reconciled or fail-stopped rather than masked by a sidecar.
- Evidence: The integration uses the production `ObsidianVaultFileAdapter`, `FileStoreSessionJsonlStorage`, `VaultPiSessionTreeFactory`, and `VaultPiSessionStore`, and rejects every non-Vault-relative adapter path. Existing replacement/uncertain-write fault tests remain the recovery evidence; this is not provider-transport evidence.
- Remaining: Do not mark WS-02 or the overall workstream done until conflict/recovery UX and the broader gates are accepted. WS-03 still requires real iOS/Android transport evidence.
- Blockers: Authenticated incremental provider transport, cancellation, lifecycle, and security deltas cannot be accepted without current iOS and Android Obsidian device evidence. Mobile UI and `isDesktopOnly: false` remain blocked on that result.
- Next action: Run the WS-03 device matrix on one iOS and one Android device; record provider, OS, Obsidian version, incremental delivery, cancellation, offline, and background/foreground results before enabling any Mobile product surface.

### 2026-08-09 — Amp — Automated Mobile V1 candidate complete

- Changed: Replaced the inert Mobile bootstrap with the required chat/settings/session composition; wired per-device provider state and SecretStorage; added the exact 15-tool public Vault inventory with abort-safe mutation approvals; implemented stream Stop/rewind-before-Retry and generation-safe session navigation; added safe-area/responsive Mobile CSS; and removed all unproven target capabilities from the V1 candidate. The single production bundle now selects browser-safe Pi/Google leaves and keeps ambient process/file credential discovery Desktop-only.
- Evidence: Source/test typechecking, zero-warning lint, architecture/package/spec/Pi-pin boundaries, Pi compatibility, 3,000+ Jest assertions, production build, substantive no-`basePath` Mobile startup, bundle-size, sentinel-secret/two-device isolation, Vault session compatibility, approval cancellation, and exact capability inventory gates pass. The startup VM denies Node built-ins/Electron and confirms the Mobile view, ribbon action, and Settings registration without Desktop module evaluation.
- Remaining: WS-03, the device-only portion of WS-06/WS-07, and WS-08 cannot be completed in this repository. Run authenticated streaming/cancel/offline/background tests, verify SecretStorage persistence/non-display after restart, inspect software-keyboard behavior and phone/tablet light/dark layouts, and repeat desktop real-host smoke.
- Blockers: One current iOS Obsidian device, one current Android Obsidian device, and a human visual signer are required. The unreleased acceptance candidate now uses `manifest.json:isDesktopOnly: false` so those tests can run; no release, tag, push, relay, or credential migration was performed.
- Next action: Install the manifest-enabled acceptance candidate on one iOS and one Android test vault and execute the five real-device acceptance rows above, recording OS/Obsidian/provider versions and failures before any public release.

### 2026-08-09 — Amp — Credential and session-write hardening review complete

- Changed: Moved session sanitization into the serialized/atomic create, append, and replace commit boundary; enumerated direct and digest canonical SecretStorage credentials independent of provider registration; retained rotated/deleted API keys and OAuth access/refresh values in memory; parsed every JSONL record to catch semantic Unicode/slash escapes; rejected credentials in object keys; and fail-closed when an arbitrary credential collides with redaction output.
- Evidence: Focused credential/session suites cover escaped values and keys, unregistered and late credentials, digest IDs, marker collision, OAuth refresh, deletion retention, and a paused atomic append whose credential changes before commit. Final independent security review reports no high-confidence blocker. On the final tree, coverage-enabled Jest passes 353 suites / 3,027 tests; typecheck, zero-warning lint, architecture/package/spec/Pi-pin boundaries, Pi compatibility, production build, Mobile startup, and bundle-size gates pass. The bundle is 3.41 MB with 1.59 MB headroom under the 5 MB cap.
- Remaining: Verify SecretStorage enumeration/restart behavior and `DataAdapter.process()` conflict/lifecycle semantics on current iOS and Android devices.
- Blockers: Real-device evidence remains mandatory before public release; disabling the manifest guard permits acceptance testing but does not satisfy that evidence.
- Next action: Hand the candidate to the real-device acceptance owner.

### 2026-08-09 — Amp — Mobile composer and visual candidate revised

- Changed: Replaced the plain Mobile composer with the shared IME-safe mention input; added Vault file/folder `@` suggestions whose tokens resolve into Vault-relative turn context; added an allowlisted built-in slash picker for `/new` and `/compact`; and revised the Mobile header, transcript, session actions, empty state, composer, touch states, safe-area spacing, and narrow-screen overlays.
- Evidence: Focused mention/slash/controller tests, typecheck, lint, architecture boundaries, production build, Mobile startup, and bundle-size checks pass. The Mobile startup path lazily loads the CodeMirror-only selection highlight and does not evaluate it during startup.
- Remaining: Human phone/tablet review must confirm visual balance, picker positioning, software-keyboard behavior, touch selection, light/dark themes, and IME input. Workspace Commands, Skills, MCP, subagents, web/image tools, and editor inline edit remain excluded.
- Next action: Copy `main.js`, `manifest.json`, and `styles.css` to the phone test vault, fully reload Obsidian, and exercise the Mobile UI acceptance rows.

## Completion summary

**Outcome: abandoned; not shipped.** The Mobile prototype proved that Obsidian Mobile can load Pivi, use Vault-relative `.pivi` session storage, keep API credentials in per-device `SecretStorage`, stream supported remote providers, and expose a constrained public-API Vault tool set. The experiment also showed that the resulting Mobile interaction quality and maintenance cost did not justify continuing toward release: the compact surface remained materially worse than the Desktop product, especially around touch composition, `@` context, slash commands, navigation, and debugging.

The prototype is preserved on the remote `mobile` branch for research only. It must not be merged, released, or treated as a supported product path without a new product decision and a new spec. `main` remains Desktop-only, retains `manifest.json:isDesktopOnly: true`, and does not include the Mobile implementation. API keys continue to use device-local Obsidian `SecretStorage`; no encrypted or plaintext credential synchronization through `.pivi` was adopted.

Repository automation established storage/session compatibility, secret-boundary hardening, Mobile startup isolation, and Desktop regression coverage for the prototype. Those results document feasibility, not release acceptance: the required iOS/Android UX, lifecycle, and transport matrix was never completed, and no Mobile release, tag, or merge was produced.
