# Implementation notes

Informal engineering log. **Not normative**—promote stable conclusions to `docs/architecture/` or `docs/specs/`.

## Current notes

| Note | Status | Purpose |
|------|--------|---------|
| [bundle-analysis.md](./bundle-analysis.md) | Historical baseline + refresh instructions | Bundle-size audit and known high-ROI levers. |
| [pi-ai-provider-selection.md](./pi-ai-provider-selection.md) | Implemented decision | Supported `pi-ai` provider set and why other providers are not bundled. |
| [pi-ai-credential-management.md](./pi-ai-credential-management.md) | Partial migration note | Current hybrid credential ownership and remaining migration direction. |
| [quality-backlog.md](./quality-backlog.md) | Historical remediation log | Completed/deferred items from the earlier quality audit. Current open work lives in [../quality-review.md](../quality-review.md). |

## Rules

When a note repeats in three+ PRs, extract an architecture section or spec update.

When a note is implemented or superseded, update its status line/table entry (`current`, `implemented`, `partial`, `historical`, `obsolete`, or `superseded by …`) so future agents do not treat old follow-up notes as current plans.
