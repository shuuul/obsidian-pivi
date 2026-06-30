# Glossary

Use this glossary as the source of truth when naming docs, UI concepts, types, and persistence fields. Prefer the canonical term for new code.

## Architecture and runtime terms

| Term | Meaning | Use in code/docs | Avoid / legacy wording |
|------|---------|------------------|------------------------|
| **Port** | Interface in `src/core/` that features depend on (`ChatRuntime`, `AppMcpOAuth`, settings/workspace services). | Core contracts, feature-to-runtime boundaries, architecture docs. | Do not make feature code depend on adaptor classes directly. |
| **Adaptor** | `src/pi/` implementation that maps core ports to Pi SDK concepts such as `Agent` and `pi-ai` model providers. | Runtime implementation docs, `src/pi/**` module descriptions. | Avoid using “provider” when referring to the whole Pi integration layer. |
| **Hexagonal seam** | Boundary rule: `features/` must not import `pi/`; `main.ts` / bootstrap wires adaptors to core ports. | Architecture docs, AGENTS boundary rules, reviews. | Avoid one-off feature imports from `src/pi/**`. |
| **Workspace services** | `AgentWorkspace` + `PiWorkspaceServices`: MCP storage, OAuth, skills, slash catalog, and settings tab renderer. | Settings/workspace integration code. | Do not put chat turn streaming responsibilities here. |
| **Auxiliary query** | Short Pi `Agent` run for refine, inline edit, or title generation, without a full chat session lifecycle. | Inline edit, title generation, refine flows. | Do not call it a session or chat turn unless it persists into session history. |
| **Runtime state** | In-memory Pi `Agent` / `ChatRuntime` state for an active tab. Rebuildable from session data. | `src/pi/runtime/`, runtime sync/hydration. | Do not treat runtime state as the source of truth. |

## Session and message terms

| Term | Meaning | Use in code/docs | Avoid / legacy wording |
|------|---------|------------------|------------------------|
| **Session** | Durable chat tree persisted as JSONL under `.pivi/sessions/`. The session file is the durable identity. | User-facing history/resume/fork docs, storage specs, persisted state. | Do not use old chat-thread wording for durable identity. |
| **Session file** | Vault-relative `.jsonl` path for one persisted session tree. | Persisted tab state, session stores, history list. | Avoid hiding it inside opaque `agentState`. |
| **Leaf** / **leafId** | Active node/tip inside a session tree. Rewind changes the active leaf; fork creates a new session file from a checkpoint. | Session tree APIs, tab binding, rewind/fork logic. | Avoid old chat-id wording for tree position. |
| **Tab binding** | The UI tab’s durable binding to `(sessionFile, leafId)` plus draft UI state such as selected model. | Plugin `loadData` / `saveData` state and tab restore logic. | Do not persist deprecated chat-id fields as durable tab identity. |
| **Open session state** / **OpenSessionState** | In-memory UI projection of a session leaf used while rendering and streaming an open tab. Rebuildable from JSONL. | Feature/controller types and transient UI state. | Do not treat it as durable identity; durable identity is `sessionFile` + `leafId`. |
| **openSessionId** | In-memory identifier for open session state. It mirrors `OpenSessionState.id`, normally the JSONL session id. | Feature-layer tab/state lookup only. | Do not persist it as tab restore identity. |
| **Turn** | One user submission plus resulting assistant/tool stream and persisted updates. | Runtime, prompt, streaming, tests. | Avoid mixing with “message” when referring to the whole request/response cycle. |
| **Message** | A user/assistant/tool content item inside a turn/session. | Rendering, JSONL message entries, chat state. | Do not use “message” for the whole session or turn lifecycle. |

## Prompt, MCP, and tool terms

| Term | Meaning | Use in code/docs | Avoid / legacy wording |
|------|---------|------------------|------------------------|
| **System prompt** | Long-lived agent instructions assembled from Pi/runtime prompt code and core prompt fragments (`buildPiSystemPrompt`, `mainAgent`). | Runtime configuration, prompt architecture docs. | Do not mix with per-message context payloads. |
| **Turn prompt** | Per-message payload built by `buildTurnPrompt`; may include context files XML and MCP mention transforms. | Turn preparation, prompt/context specs. | Do not store API-transformed prompt text as user-visible history. |
| **MCP mention** | User-facing `@server` token that becomes `@server MCP` in the API prompt via turn finalization. | Composer mentions, MCP context-saving semantics. | Do not expose transformed API wording in the visible user message. |
| **Proxy MCP tool** | Single Pi tool `mcp` that searches/calls vault MCP servers instead of exposing one Pi tool per MCP tool. | Pi tool registry, MCP bridge docs. | Do not describe vault MCP tools as top-level Pi tools. |
| **Vault-local MCP** | `.pivi/mcp.json` plus `.pivi/mcp-oauth/`; Pivi does not read or write host-global MCP configs. | MCP settings, OAuth, storage docs. | Avoid global paths such as `~/.config/mcp` or IDE host MCP configs. |
