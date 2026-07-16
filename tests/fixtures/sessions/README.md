# Session compatibility fixtures

These files are immutable compatibility inputs. Tests copy them to a temporary
directory before opening or migrating them; no test mutates a frozen source.

## Synthetic contract shapes

These fixtures are hand-authored synthetic shapes, not captured user sessions:

- `pre-change-v3-compaction.jsonl` represents the Pivi/Pi compaction shape before structured checkpoint details.
- `mixed-checkpoint-chain-v3.jsonl` combines a legacy compaction and a version-1 checkpoint in the same append chain.
- `legacy-v1-compaction-shape.jsonl` exercises the installed Pi runtime's v1-to-v3 migration, including `firstKeptEntryIndex` conversion.

The v1 fixture is not Pivi 0.7.0 data. Pivi 0.7.0 already locked Pi 0.80.6,
whose writer emitted session version 3.

## Pivi 0.7.0 tag-generated writer output

`tag-generated-pivi-0.7.0-v3.jsonl` contains unmodified bytes emitted by
`PiSessionStore` from immutable tag `0.7.0`, commit
`f27ca3be149ecf4497f8d2e6ab8a236d14308c59`. It is authentic writer output over
synthetic non-sensitive content; it is not a captured user vault or a claim about
all historical sessions.

Generation provenance:

- Tag lock versions: `@earendil-works/pi-agent-core@0.80.6`,
  `@earendil-works/pi-ai@0.80.6`, and
  `@earendil-works/pi-coding-agent@0.80.6`.
- Frozen source SHA-256:
  `3c191e3440fc1a95859ddb6a07687a74a2b5cc383062c0fab3b0c53e357ef67b`.
- The deterministic recipe fixes time and random sources before loading the tag
  writer, then calls `PiSessionStore.create()`, `writeSessionMeta()`,
  `writeUiContext()`, `appendUserTurn()`, and `appendAgentTurn()`. It does not
  post-process or normalize the resulting JSONL.
- The only absolute paths in the fixture are fixed synthetic roots:
  `/tmp/pivi-0.7.0-tag-generated-vault` and `/synthetic/pivi-0.7.0/*`.
  The recipe rejects the repository, temporary worktree, and home paths if they
  appear in the output.

Reproduce the exact bytes from the local immutable tag only when this checkout's
installed Pi packages match the three 0.80.6 tag locks:

```bash
node scripts/generate-pivi-070-session-fixture.mjs /tmp/tag-generated-pivi-0.7.0-v3.jsonl
```

The normal current dependency install may be newer and will intentionally fail
this provenance guard; use a disposable checkout/install when regeneration is
actually required. The generator verifies the tag commit, the tag lock and
installed versions, and the frozen SHA before writing its requested output. The
HEAD compatibility test then opens a temporary copy through `PiSessionStore` and
`OpenSessionManager`, proving device-local-path migration, semantic restoration,
sidecar marking, and idempotent reopen behavior.
