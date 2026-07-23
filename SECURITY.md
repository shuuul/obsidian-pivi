# Security

Pivi is an Obsidian community plugin that runs inside the desktop renderer with vault, network, and optional process integrations. This page records durable trust boundaries for network egress. Broader disclosure, credential, and release-assurance guidance may expand here as later hardening work lands.

## Reporting

Report suspected vulnerabilities through [GitHub Security Advisories](https://github.com/shuuul/obsidian-pivi/security/advisories/new) for this repository. Include Obsidian and Pivi versions, reproduction steps, and the smallest example that demonstrates impact.

## Network egress and SSRF

All Pivi-initiated HTTP(S) traffic uses **purpose-scoped clients** created at composition time (`createPiviNetworkClients` in `@pivi/obsidian-host`). Each client carries an egress policy from `@pivi/pivi-agent-core/network` (URL normalization/redaction, IP classification, DNS pinning, redirect limits, deadlines, streaming byte limits, and content-type gates).

Default policy:

- Only `http:` and `https:` URLs reach transports; URL credentials are rejected.
- Loopback, private, link-local, multicast, unspecified, and cloud-metadata destinations are denied for IPv4 and IPv6, including alternate IP representations.
- Hostnames are resolved and checked before connect; the connected address is pinned against the approved resolution to resist DNS rebinding.
- Redirects are normalized, rechecked, and bounded.
- Logs, errors, and UI surfaces redact URL credentials and sensitive query values.

Configured MCP remote servers and custom OpenAI-compatible providers may target private origins. Those destinations receive **short-lived origin grants** for the active turn or settings operation—not a permanent global bypass. Prompt injection must not become durable network authority.

Provider SDKs, MCP/OAuth, WebSearch/WebFetch, image generation, skills distribution, and connectivity probes each receive an explicit injected client; there is no renderer-wide HTTP shim.

## No global `window.fetch` patch

Pivi does **not** assign `window.fetch`. Plugin load and unload leave Obsidian's and other plugins' fetch identity unchanged.

Production bundles resolve free `fetch` identifiers through esbuild `inject` of `packages/obsidian-host/src/bundledFetch.ts`, which forwards to the scoped provider client without mutating globals.

## WebFetch disclosure

`WebFetch` defaults to `fetchMode: 'direct-only'`, which fetches the target URL directly and never sends it to Tavily, Exa, AnySearch, or another third-party extractor.

`fetchMode: 'allow-extractors'` permits the ordered provider chain before the direct HTTP terminal fallback. Settings expose this mode with explicit disclosure because extraction shares the full target URL—including paths and query data—with the configured provider.

Terminal WebFetch errors redact the target URL.

## Related guidance

- Architecture: [docs/02-architecture-and-technology.md](docs/02-architecture-and-technology.md)
- Web tools and MCP: [docs/07-tools-skills-mcp-and-integrations.md](docs/07-tools-skills-mcp-and-integrations.md)
- Implementation spec: [specs/032-network-egress-and-http-client.md](specs/032-network-egress-and-http-client.md)
