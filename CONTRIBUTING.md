# Contributing to Pivi

Thanks for helping improve Pivi. By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up

Pivi requires Node.js 24.x. Fork and clone the repository, then run:

```bash
npm ci
npm run build
```

For live testing, set `OBSIDIAN_VAULT` in `.env.local`, build, enable Pivi once, and reload it with `obsidian plugin:reload id=pivi`. See the [development handbook](docs/09-development-debugging-and-validation.md) for the complete workflow.

## Choose and discuss work

- Ask usage and design questions in [Discussions](https://github.com/shuuul/obsidian-pivi/discussions).
- Use the bug or feature issue form for actionable repository work. Search existing issues first.
- For a larger change, wait for scope agreement before investing in an implementation.
- Never disclose a vulnerability publicly; follow [SECURITY.md](SECURITY.md).

## Make a focused change

Read the root and nearest nested `AGENTS.md`, the [architecture overview](docs/02-architecture-and-technology.md), and the handbook page that owns the behavior. Preserve package dependency direction and add focused behavior tests. Update the relevant numbered handbook page and nearest `AGENTS.md` when architecture, behavior, or an enforceable boundary changes.

Use a short branch and keep the pull request to one concern. Do not include release/version changes unless the change is specifically a release preparation.

### Bounded documentation-checker contribution

A focused contribution to Markdown link validation belongs in `scripts/check-docs-contracts.mjs`, with fixtures in `tests/unit/scripts/checkDocsContracts.test.ts`. The checker scans root and `.github` community Markdown, `docs/` handbook and recipes, package README/guidance files, and active specs. `CHANGELOG.md` and `specs/archive/` are excluded as historical source text, but links from active documents into archived specs must still resolve.

Start behavior changes with a failing fixture. For the archive boundary, create an active document linking to a nonexistent `specs/archive/NNN-*.md` target and require exit status 1 plus a `link target does not exist` diagnostic containing the active source path and line. Preserve inline, reference, and image links; fragments and URL-encoded paths; and fenced/inline code exclusions. Verify with:

```bash
npm run test -- --runInBand tests/unit/scripts/checkDocsContracts.test.ts
npm run check:docs-contracts
```

## Validate

Run the narrowest relevant test while iterating, for example:

```bash
npm run test -- tests/unit/path/to/test.ts
```

Do not open a pull request until the complete CI-equivalent suite is green locally. GitHub Actions confirms that suite; it is not the first place to discover a failure:

```bash
npm run check:dependencies
npm run typecheck
npm run lint
npm run check:boundaries
npm run test:coverage
npm run build
npm run check:bundle-size
```

UI or runtime changes also need testing in Obsidian. Record the Obsidian version, Pivi version, and operating system. Rendered CSS changes require human visual review in a reloaded Obsidian window.

## Open a pull request

Open the pull request only after the CI-equivalent suite above is green. Complete the pull request template, link the issue, describe user-visible and architectural effects, and list exact validation performed. Add screenshots for visual changes. Review feedback may request a smaller scope or documentation/test updates before merge.
