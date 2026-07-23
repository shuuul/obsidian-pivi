# Security

Pivi is an Obsidian community plugin that runs inside the desktop renderer with vault, network, and optional process integrations. This document records durable trust boundaries, disclosure routes, and what Pivi does **not** claim. It is not a guarantee of invulnerability.

## Supported versions

Security fixes are applied to the current published Obsidian community-plugin release line and to `main`. Older Git tags and privately rebuilt forks are not separately maintained.

Report issues against a concrete Pivi version (`manifest.json` / GitHub Release tag) and Obsidian version so maintainers can reproduce on a supported desktop build (minimum Obsidian `1.12.0`).

## Reporting a vulnerability

Report suspected vulnerabilities through [GitHub Security Advisories](https://github.com/shuuul/obsidian-pivi/security/advisories/new) for this repository. Include Obsidian and Pivi versions, reproduction steps, and the smallest example that demonstrates impact. Do not open a public issue for unfixed vulnerabilities that expose credentials, vault data, or remote code execution.

Maintainers triage advisory reports and coordinate disclosure. There is no separate bug-bounty program.

## Trust boundaries

| Boundary | Trust assumption | Failure stance |
|---|---|---|
| Obsidian desktop host | The vault and Electron renderer are already trusted for the signed-in user | Pivi cannot protect a compromised Obsidian install or a malicious vault plugin that already has host privileges |
| Synced `.pivi/` JSON | May sync across devices; treat as non-secret configuration and session history | Secrets, absolute host paths, and environment values must not be written here |
| Device-local storage / `SecretStorage` | Per-device; secrets and path caches stay off synced JSON | Loss of device storage loses those secrets/paths; cloud sync of the vault does not restore them |
| Model providers / MCP remotes | Third-party services receive prompts, tool results, and configured headers | Prompt injection and malicious tool output are expected adversarial inputs |
| Skills / stdio MCP | User-installed code and executables run with the Obsidian process privileges | Installation and first launch require explicit confirmation; Pivi does not sandbox third-party skill or MCP code |

Pivi reduces accidental foot-guns (SSRF, path escape, unbounded process output, silent secret sync). It does **not** claim to stop a determined local attacker who already controls the Obsidian process, the vault filesystem, or the user's OS account.

## Capability and credential matrix

| Capability | Default | Storage / authority | Notes |
|---|---|---|---|
| Provider API keys / OAuth | Off until configured | Obsidian `SecretStorage` (`pivi-*` ids); device-local provider registry | Synced settings never store credentials or custom header values |
| Environment variables | Empty registry | Device-local `pivi.environment.v1`; secrets in `SecretStorage` (`pivi-env-*`) | Synced `.pivi/settings.json` must not persist environment maps |
| MCP remote headers / stdio env | Structured `ConfigValueRef` | Secret values in `SecretStorage` (`pivi-mcp-v-*`); config in `.pivi/mcp.json` | Names may appear in config; secret values do not |
| External absolute-path reads | Off (`allowExternalRead`) | Device-local allowed directories / turn folders | Absolute paths never enter synced settings or session JSONL |
| Bash tool | Off (`allowBash`) | Allowlisted executable + argument schema | No login shell; turn-scoped high-risk confirmation |
| MCP stdio servers | Inactive until confirmed | Vault-local `.pivi/mcp.json` | First process launch in a turn also requires confirmation |
| High-risk vault mutations | Confirm per turn when File Recovery is unavailable | Session/turn/kind/resource-bound grants | Enabled File Recovery bypasses approval in favor of snapshots; otherwise fail closed |
| Subagents | Inherit parent grants only | No hidden approval UI | Cannot escalate beyond parent turn grants |

## Network flows

All Pivi-initiated HTTP(S) traffic uses **purpose-scoped clients** created at composition time (`createPiviNetworkClients` in `@pivi/obsidian-host`). Each client carries an egress policy from `@pivi/pivi-agent-core/network` (URL normalization/redaction, IP classification, DNS pinning, redirect limits, deadlines, streaming byte limits, and content-type gates).

Default policy:

- Only `http:` and `https:` URLs reach transports; URL credentials are rejected.
- Loopback, private, link-local, multicast, unspecified, and cloud-metadata destinations are denied for IPv4 and IPv6, including alternate IP representations.
- Hostnames are resolved and checked before connect; the connected address is pinned against the approved resolution to resist DNS rebinding.
- Redirects are normalized, rechecked, and bounded.
- Logs, errors, and UI surfaces redact URL credentials and sensitive query values.

Configured MCP remote servers and custom OpenAI-compatible providers may target private origins. Those destinations receive **short-lived origin grants** for the active turn or settings operation—not a permanent global bypass. Prompt injection must not become durable network authority.

Provider SDKs, MCP/OAuth, WebSearch/WebFetch, image generation, skills distribution, and connectivity probes each receive an explicit injected client; there is no renderer-wide HTTP shim.

### No global `window.fetch` patch

Pivi does **not** assign `window.fetch`. Plugin load and unload leave Obsidian's and other plugins' fetch identity unchanged.

Production bundles resolve free `fetch` identifiers through esbuild `inject` of `packages/obsidian-host/src/bundledFetch.ts`, which forwards to the scoped provider client without mutating globals.

### WebFetch disclosure

`WebFetch` tries enabled third-party extractors (Tavily, Exa, AnySearch) in the user-configured provider order before the direct HTTP terminal fallback. Extraction shares the full target URL—including paths and query data—with the configured provider.

Terminal WebFetch errors redact the target URL.

## Prompt-injection stance

Model and tool outputs are untrusted. Pivi treats prompt injection as an expected condition:

- Network authority comes from composition-time clients and short-lived origin grants, not from model-suggested URLs alone.
- High-risk filesystem, process, and MCP launch operations require turn-scoped confirmation bound to normalized resources.
- MCP result budgets and artifact fallbacks limit how much untrusted tool output enters context or session JSONL.
- Skills and MCP servers installed by the user can still follow malicious instructions once approved; confirmation is not a sandbox.

Pivi does not claim reliable automatic detection or neutralization of all prompt-injection content.

## Third-party Skills and MCP responsibility

Installing a Skill or enabling an MCP server is an explicit trust decision:

- The Skills CLI is the exact installed `skills` package invoked as `node <cli.mjs>` with `shell: forbidden`. Staged trees reject symlinks/path escapes and enforce size/`SKILL.md` limits before atomic publish. Failures leave the previous version unchanged.
- MCP stdio executables run as child processes of Obsidian with the configured args, cwd, and resolved environment. Remote MCP servers receive prompts and tool arguments over the network.
- Pivi validates packaging bounds and requires confirmation for high-risk first launches; it does **not** audit Skill or MCP server source code for malice and does **not** isolate their filesystem or network beyond the shared host policies above.
- Users remain responsible for reviewing Skill and MCP provenance before enablement.

## Local process execution

One-shot process work (CLI, Bash, Skills tooling) uses the host `ProcessRunner` as a **bounded execution primitive**, not a shell convenience wrapper:

- Requests require explicit stdout/stderr byte limits, timeout, cwd policy (vault or approved root), shell policy, and may carry an `AbortSignal`.
- Shell execution is forbidden by default. A reviewed adapter may opt in only with an explicit reason (for example Windows `.cmd` for `npx`).
- Output is truncated while streaming; retained memory does not grow with unbounded child output.
- Timeout and abort terminate the owned process tree (POSIX process group or Windows `taskkill /T`), escalate to forced kill when needed, wait for close, and never double-resolve.
- Results distinguish exit, signal, timeout, abort, spawn error, and forced-kill escalation.

Bash allowlists match canonical executable paths plus argument schemas. Commands do not load login-shell startup files. MCP stdio uses a structured executable/args pair with vault cwd and rejects shell-control characters in the executable field. New stdio definitions remain inactive until Settings confirms executable, arguments, cwd, and environment variable **names**; the first process launch in a chat turn also requires turn-scoped confirmation.

Cross-platform process and path behavior is covered by focused Ubuntu, macOS, and Windows CI jobs for the security-sensitive suites. That coverage does **not** certify full product support on every OS; support claims follow tested behavior only.

## High-risk operations

A fixed table covers delete, overwrite of an existing file, bulk mutation above the documented threshold, Bash/eval, first stdio MCP launch, and oversized MCP artifact writes. Vault mutation entries bypass confirmation while Obsidian File Recovery is enabled so snapshots provide the recovery path; if it is disabled or unavailable, they require turn-scoped confirmation. The remaining operation kinds always require confirmation bound to the current session, turn, operation kind, and normalized resource summary. Denial, timeout, cancellation, session switch, view disposal, and unload fail closed. Subagents inherit only parent grants and cannot open hidden approval UI. Previews show normalized paths, executable/args, MCP server/tool, and origin metadata without secrets or document bodies. A size-bounded diagnostics audit under `.pivi/diagnostics/` records decision/outcome metadata only.

## Skills and MCP extension bounds

MCP tool results enforce fixed budgets (block count, encoded bytes, text characters, JSON depth, resource count) before entering model context or session persistence. Oversized results fail explicitly or, after write confirmation, produce a bounded Vault-local reference under `.pivi/artifacts/mcp/`; full oversized payloads never enter JSONL or context.

## Vault mutation containment

Read/display path helpers (`normalizePathForVault`) must not be used as mutation authority. Mutating vault operations call `requireVaultRelativeMutationPath`, which requires a non-empty canonical vault-relative path and rejects absolute, drive/UNC, traversal, NUL, invalid separators, and symlink-parent escape (including nonexistent targets beneath a symlinked parent via nearest-existing-ancestor realpath). Eligible note overwrites still capture Obsidian File Recovery before the first write.

## Pi dependency compatibility

The three `@earendil-works/pi-*` packages are pinned to one exact synchronized version. Private SessionManager members used for eager header flush and truncate/rewind are isolated behind a single adapter with startup/use assertions that fail with an actionable compatibility error before session mutation. Upgrade the three packages as one unit only after `npm run test:pi-compat` passes.

## Related guidance

- Architecture: [docs/02-architecture-and-technology.md](docs/02-architecture-and-technology.md)
- Web tools and MCP: [docs/07-tools-skills-mcp-and-integrations.md](docs/07-tools-skills-mcp-and-integrations.md)
- Development and validation: [docs/09-development-debugging-and-validation.md](docs/09-development-debugging-and-validation.md)
- Release route: [docs/10-roadmap-release-and-maintenance.md](docs/10-roadmap-release-and-maintenance.md)
- Network egress implementation: [specs/archive/032-network-egress-and-http-client.md](specs/archive/032-network-egress-and-http-client.md)
- Local execution and vault mutation: [specs/archive/033-local-execution-and-vault-mutation.md](specs/archive/033-local-execution-and-vault-mutation.md)
- High-risk operations and extensions: [specs/archive/034-high-risk-operations-and-extensions.md](specs/archive/034-high-risk-operations-and-extensions.md)
- Security and release assurance: [specs/archive/036-security-release-assurance.md](specs/archive/036-security-release-assurance.md)
