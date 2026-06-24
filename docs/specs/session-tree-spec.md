# Session tree (JSONL-only persistence)

## Problem

Chat history should persist and branch as a tree, with JSONL as the single source of truth. Earlier pre-release prototypes split metadata and turns; current storage is consolidated under `.obsius/`.

## Goals

- **JSONL-only SSOT** — all session data in tree-structured `.jsonl` files.
- **Restart recovery** — tabs and history reload messages and agent context from disk.
- **Tree semantics** — fork → new file; rewind → switch leaf in same file.
- **History UX** — pick session file, then pick leaf/checkpoint when branches exist.
- **Unified vault layout** — everything under `.obsius/`.
- **Hexagonal seam** — `core/` defines ports; `pi/` implements tree I/O and agent hydration.

## Non-goals

- pi-coding-agent TUI, `/resume` keybindings, or `pi install`.
- Guaranteed round-trip with `pi --fork` (best-effort read of pi-shaped entries only).
- Cross-vault session merge.
- Renaming CSS `obsius2-*` classes (orthogonal).
- Built-in public sharing service for session files.

## Future work

- **Session branch export/share:** optional export of a selected branch as pi-compatible JSONL. Define privacy redaction, attachment handling, and whether exported branches are importable before implementation.

## Related

- Architecture: [context-management.md](../architecture/context-management.md)
- Supersedes in part: [context-layers-spec.md](./context-layers-spec.md) § Session format

---

## Vault layout

```text
.obsius/
  settings.json
  mcp.json
  mcp-oauth/
  skills/
  SYSTEM.md
  sessions/
    --<encoded-vault-path>--/
      <timestamp>_<uuid>.jsonl
```

**Encoding:** reuse `encodeSessionCwd(vaultPath)` → `--path-with-dashes--` (see `src/pi/session/obsiusSessionPaths.ts`).

**Plugin data** (`loadData` / `saveData`, not vault files): tab layout only. Runtime-facing tab state uses `sessionFile` and `leafId`; rendering may keep a rebuildable in-memory projection, but durable identity remains the Pi session file plus active leaf.

```typescript
interface PersistedTabState {
  tabId: string;
  sessionFile: string | null;   // vault-relative path to .jsonl
  leafId: string | null;        // active tree position; null = default leaf
  draftModel?: string | null;
}
```

No feature-layer in-memory id in persisted plugin tab state after migration.

---

## Session identity

| Concept | Identity |
|---------|------------|
| Session | One `.jsonl` file path (vault-relative) |
| Tree node | Entry `id` (8-char hex) |
| Active position | `leafId` (entry id of current branch tip) |
| Tab binding | `(sessionFile, leafId)` |

Remove the parallel **UI id** ↔ **`.meta.json`** model from persisted storage. In-memory UI projections are loaded from JSONL for open tabs only; persisted restore state is always `sessionFile` + `leafId`.

---

## JSONL format

### Base (pi-inspired v3)

Follow pi-coding-agent tree rules unless noted:

- First line: `SessionHeader` (`type: "session"`, `version: 3`, `id`, `timestamp`, `cwd`).
- Subsequent lines: entries with `id`, `parentId`, `timestamp`.
- **`message`** entries: `AgentMessage` (`user`, `assistant`, `toolResult`, …).
- Context for agent: walk **leaf → root**, apply compaction/branch_summary rules (same as pi `buildSessionContext`).

Reference: pi [session-format.md](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/session-format.md).

### Obsius extensions

Use **`custom`** entries (do not enter LLM context) for UI-only state. Latest entry of a given `customType` on the **leaf → root** path wins.

| `customType` | Purpose |
|--------------|---------|
| `obsius/session-meta` | `{ title, titleGenerationStatus, createdAt, lastResponseAt, usage? }` |
| `obsius/ui-context` | `{ currentNote?, externalContextPaths?, enabledMcpServers? }` |
| `obsius/message-ui` | `{ targetEntryId, displayContent?, contentBlocks?, durationSeconds?, … }` per message |

Use pi **`session_info`** for display title when set (optional; `obsius/session-meta.title` is authoritative for Obsius UI).

Use **`label`** entries for user-visible checkpoints (rewind/fork picker).

### Fork header

New file created on fork:

```json
{"type":"session","version":3,"id":"<new-uuid>","timestamp":"…","cwd":"<vault-path>","parentSession":".obsius/sessions/--…--/<source>.jsonl","forkedFromEntryId":"<entry-id>"}
```

Replay prefix entries (copy or reference — see Algorithm § Fork) then attach new branch at checkpoint.

### Divergence from pi-coding-agent

| Topic | pi TUI | Obsius |
|-------|--------|--------|
| Fork default | Often in-place branch in same file | **Always new `.jsonl` file** |
| Session list | `~/.pi/agent/sessions/` | `<vault>/.obsius/sessions/` |
| UI metadata | `session_info`, extensions | `obsius/*` custom entries |
| Strict compatibility | — | **Not required** |

---

## Data flow

```mermaid
flowchart TB
  subgraph ui [Features layer]
    Tab[Tab / ChatState]
    Hist[History / Resume UI]
  end
  subgraph core [Core ports]
    SS[SessionStore]
    CH[SessionHistoryService]
  end
  subgraph pi [Pi adaptor]
    Bridge[SessionTreeStore]
    Map[MessageMapper]
    Runtime[PiChatRuntime]
  end
  subgraph disk [Vault]
    JSONL[".obsius/sessions/*.jsonl"]
  end

  Tab --> SS
  Hist --> SS
  SS --> Bridge
  Bridge --> JSONL
  Bridge --> Map
  Map --> Tab
  Runtime --> Bridge
  CH --> Bridge
```

### Turn lifecycle

1. **Send:** append `message` (user) to JSONL at current leaf; extend leaf pointer.
2. **Stream:** UI renders from `ChatState` (unchanged).
3. **Turn end:** append assistant + toolResult messages; append/update `obsius/message-ui` customs; append `obsius/ui-context` if changed; update `obsius/session-meta.lastResponseAt`.
4. **Agent sync:** rebuild agent messages from leaf via tree walk (same path as pi `buildSessionContext`).

### Load / restart

1. Tab restore reads `(sessionFile, leafId)` from plugin data.
2. `SessionStore.open(sessionFile, leafId)` parses JSONL, resolves leaf.
3. `MessageMapper.toChatMessages(entries)` → UI message list.
4. `PiChatRuntime.syncSession(sessionFile, leafId)` → agent `initialState.messages`.

---

## User experience

### History / resume

1. **Session list:** scan `.obsius/sessions/--<vault>--/*.jsonl`; sort by `lastResponseAt` or file mtime; show title from `obsius/session-meta` or `session_info` or first user message.
2. **Branch picker:** if file has multiple leaves (or labeled checkpoints), show secondary UI to pick leaf; default = latest leaf by timestamp.
3. **Open:** bind tab to `(sessionFile, leafId)`; render messages; lazy-init runtime on send.

### Fork

- User selects checkpoint (user message with prior assistant response).
- System creates **new JSONL** with `parentSession` + prefix up to checkpoint.
- Open in new tab (or current tab per existing fork modal).
- Source file unchanged; branches preserved.

### Rewind

- User selects earlier checkpoint in **current** session file.
- Set `leafId` to corresponding entry (ancestor of previous leaf).
- Re-render UI from truncated path; agent context rebuilt at new leaf.
- No entry deletion.

### New chat

- Create new JSONL via `SessionStore.create(vaultPath)`.
- Blank tab binds to new file with single root leaf.

---

## API / interfaces (core ports)

### `SessionStore` (replaces `SessionStorage`)

Location: `src/core/session/` (new).

```typescript
interface SessionRef {
  sessionFile: string;  // vault-relative
  leafId: string;
  sessionId: string;  // header uuid
}

interface SessionSummary {
  sessionFile: string;
  sessionId: string;
  title: string;
  updatedAt: number;
  leafCount: number;
  messagePreview: string;
}

interface SessionStore {
  listSessions(vaultPath: string): Promise<SessionSummary[]>;
  create(vaultPath: string): Promise<SessionRef>;
  open(sessionFile: string, leafId?: string): Promise<SessionRef>;
  listLeaves(sessionFile: string): Promise<LeafSummary[]>;
  getMessages(ref: SessionRef): Promise<ChatMessage[]>;
  appendUserTurn(ref: SessionRef, prompt: string, ui?: UserTurnUi): Promise<SessionRef>;
  appendAgentTurn(ref: SessionRef, messages: AgentMessage[], ui?: MessageUi[]): Promise<SessionRef>;
  setLeaf(ref: SessionRef, leafId: string): Promise<SessionRef>;
  fork(ref: SessionRef, atEntryId: string): Promise<SessionRef>;
  deleteSession(sessionFile: string): Promise<void>;
  readUiContext(ref: SessionRef): Promise<SessionUiContext>;
  writeUiContext(ref: SessionRef, patch: Partial<SessionUiContext>): Promise<void>;
  writeSessionMeta(meta: SessionMeta): void;
}
```

### `SessionHistoryService` (narrowed)

Becomes a facade over `SessionStore` for bootstrap:

- `hydrateSessionHistory` → load JSONL into `OpenSessionState.messages`
- `deleteSessionFile` → delete JSONL file
- Remove `buildPersistedAgentState` / `agentState.piSessionFile` — **`sessionFile` lives on tab/session ref**, not opaque agent blob.

### `ChatRuntime` implementation status

- Current core contract still exposes a UI-projection sync call (`syncOpenSessionState(...)`) and `buildSessionUpdates(...)`.
- The Pi adaptor maps those calls onto JSONL session files/leaf state through `src/pi/session/`.
- A future rename to explicit `syncSession(sessionFile, leafId)` remains possible, but the current API is an implemented compatibility layer over Pi sessions.

---

## Implementation status

| Area | Status | Notes |
|------|--------|-------|
| `.obsius/` storage paths | Done | Settings, MCP, OAuth, skills, and sessions are vault-local. |
| `SessionTreeStore` / JSONL tree I/O | Done | Implemented in `src/pi/session/`; parses, appends, forks, and applies leaves. |
| `MessageMapper` | Done | Maps Pi agent messages and Obsius UI metadata to/from chat messages. |
| `PiChatRuntime` persistence | Done | Appends turn messages and hydrates runtime state from JSONL session data. |
| Session list / history | Done | Scans JSONL-backed sessions and exposes leaves for branch selection. |
| Tab binding | Done | Plugin data persists `sessionFile`, `leafId`, and draft model; `openSessionId` remains rebuildable in-memory state. |
| Fork / rewind | Done | Fork creates a new JSONL file; rewind switches the active leaf without deleting entries. |
| Opaque `agentState` compatibility | Partial cleanup | Compatibility helpers still read/write Pi session file hints for older state and runtime boundary compatibility; do not introduce new durable identity there. |
| Core runtime API naming | Future cleanup | `syncOpenSessionState(...)` and `buildSessionUpdates(...)` still act as compatibility-layer names over `(sessionFile, leafId)`. A future rename to explicit `syncSession(sessionFile, leafId)` can clarify the contract. |
| Tests | Partial | Session tree basics exist; broader golden JSONL/restart/fork/leaf regression coverage remains valuable. |

## Current storage state

Vault layout is `.obsius/` only; tabs persist `sessionFile` + `leafId` (no in-memory UI id in `data.json`).

---

## Evaluation

### Automated

- Parse/write golden JSONL (tree, fork header, custom entries).
- `MessageMapper` round-trip UI fields.
- Leaf walk matches agent message list for fixture sessions.

### Manual

1. Chat several turns → restart Obsidian → messages and MCP context restore.
2. Fork at message → new file appears under `.obsius/sessions/` → both branches intact.
3. Rewind → earlier leaf active; send continues branch from that point.
4. History lists files; branch picker appears for forked session.

---


## Resolved (from product review 2026-05-24)

| Question | Decision |
|----------|----------|
| SSOT | JSONL only |
| Meta sidecar | Remove |
| Fork | New JSONL file |
| Rewind | Switch leaf, same file |
| History | File list → leaf picker |
| Vault dir | `.obsius/` only |
| pi CLI 1:1 | Not required |
| Delivery | Single release (this spec) |
