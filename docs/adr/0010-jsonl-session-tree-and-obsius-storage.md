# ADR-0010: JSONL session tree and unified `.obsius/` vault storage

## Status

Accepted

## Context

Obsius currently persists chat in two incomplete layers:

1. **`.obsius2/sessions/{id}.meta.json`** — UI metadata (`title`, `agentState`, MCP selection, etc.) without messages.
2. **`.obsius/sessions/--<vault>--/*.jsonl`** — partially wired via `PiSessionBridge`; only user turns are appended; assistant/tool turns and hydrate on restart are missing.

In-memory **`Conversation`** uses a linear `ChatMessage[]`. Fork deep-clones that array instead of using tree semantics. Restart loses message history even when meta files exist.

Product direction (2026-05-24):

- **Single store:** JSONL only — no parallel `.meta.json` index.
- **Tree semantics:** fork → new JSONL file; rewind → switch leaf within a file; history lists JSONL files, then branch/leaf within a file.
- **Vault layout:** consolidate runtime data under **`.obsius/`**; retire **`.obsius2/`** paths (settings, sessions, legacy MCP).
- **Pi CLI compatibility:** desirable but **not required**; adopt pi-style tree design without blocking on 1:1 `SessionManager` parity.

Related: [context-layers-spec.md](../specs/context-layers-spec.md) (session section), [ADR-0004](./0004-vault-local-mcp-config.md), [ADR-0009](./0009-obsidian-native-tools.md).

## Decision

1. **JSONL is the sole session persistence format.** One file = one session identity. No `.meta.json` sidecar files.
2. **Tree model** (inspired by pi-coding-agent v3): entries linked by `id` / `parentId`; active position = **leaf**; context built by walking leaf → root.
3. **Fork** creates a **new JSONL file** (with `parentSession` header when branched from an existing file). **Rewind** switches **leaf** in the **same** file without deleting historical branches.
4. **History UX:** list session files under `.obsius/sessions/--<encoded-vault>--/`; after picking a file, pick **leaf / checkpoint** when multiple branches exist.
5. **Vault storage root:** `.obsius/` for settings, MCP, skills, and sessions. Migrate reads from `.obsius2/` once, then stop writing there.
6. **Implementation spec:** [session-tree-spec.md](../specs/session-tree-spec.md) defines schema extensions, ports, UI flows, and migration.

## Rationale

- **One SSOT** removes dual-write bugs (meta saved, messages lost on restart).
- **Tree + leaf** matches pi mental model and supports fork/rewind without truncating history.
- **`.obsius/`** aligns with MCP/skills layout (ADR-0004) and user-facing vault-local config story.
- **Obsius-owned format extensions** (`custom` / `session_info` entries) store UI-only state without a second database.
- **Optional pi CLI compatibility:** reuse pi JSONL entry shapes where convenient; diverge on fork-as-new-file and Obsius-specific `customType` values.

## Alternatives

1. **Keep dual storage (meta + JSONL)** — rejected; current failure mode (empty messages after restart) is structural.
2. **Linear JSONL append-only (no tree)** — rejected; fork/rewind would require file copying or destructive truncation.
3. **Store UI messages in Obsidian `plugin.data.json`** — rejected; unbounded, not vault-browsable, poor sync story.
4. **Strict 1:1 pi-coding-agent + `SessionManager` only** — rejected as a hard requirement; still allowed as an internal library if bundle cost is acceptable.
5. **Rename plugin ID / CSS only** — insufficient; storage path unification is the goal.

## Consequences

### Positive

- Restart restores full chat from disk.
- Fork and rewind become first-class tree operations.
- Session files are inspectable in the vault; optional future export/share.
- Single `.obsius/` story for users and docs.

### Negative / trade-offs

- Large refactor: `Conversation` / tab binding / history UI (`SessionStorage` removed; JSONL SSOT).
- Pre-release: no `.obsius2/` auto-migration; vault layout is `.obsius/` only.
- UI-rich fields (content blocks, subagent cards) need explicit JSONL encoding via `custom` entries.
- Fork-as-new-file differs from pi TUI in-place branching (documented divergence).

### Technical debt

- Update [context-layers-spec.md](../specs/context-layers-spec.md) session section after ADR acceptance (point to session-tree-spec).
- Revise [ADR-0009](./0009-obsidian-native-tools.md) item 5 (1:1 JSONL) to reference this ADR.
- `PI_RUNTIME_CAPABILITIES` must reflect real rewind/fork/history once shipped.
- CSS class prefix `obsius2-*` unchanged in this ADR (cosmetic; separate cleanup optional).

## Review date

2026-08-24 — Re-evaluate pi CLI import/export and whether to vend `SessionManager` vs minimal in-repo tree store.
