# Core boundary governance spec

## Status

**Superseded.** `src/core/` has been eliminated in the Pi-only architecture refactoring. All former core modules moved to `src/pi/` or `src/utils/`.

## Historical context

This spec originally governed the hexagonal boundary of `src/core/` (the inner layer used before Pivi became Pi-only). The remaining durable rules are:

- `src/pi/**` must not import `src/features/**`
- Low-level SDK imports (`@earendil-works/pi-*`, MCP SDK) stay in `src/pi/**`
- Feature code may use Pivi-owned `src/pi/**` product modules directly

See [../architecture/system-architecture.md](../architecture/system-architecture.md) for the current architecture.
