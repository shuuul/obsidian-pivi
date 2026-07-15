# Session compatibility fixtures

These files are frozen synthetic contract samples, not captured user sessions.

- `pre-change-v3-compaction.jsonl` represents the Pivi/Pi compaction shape before structured checkpoint details.
- `mixed-checkpoint-chain-v3.jsonl` combines a legacy compaction and a version-1 checkpoint in the same append chain.
- `legacy-v1-compaction-shape.jsonl` exercises the installed Pi runtime's v1-to-v3 migration, including `firstKeptEntryIndex` conversion.

The repository does not contain provenance-verifiable session bytes from Pivi 0.7.0. Do not relabel the v1 migration fixture as a captured 0.7.0 session. Compatibility tests copy these immutable samples to a temporary directory before opening or migrating them.
