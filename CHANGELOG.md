# Changelog

## [0.11.2](https://github.com/shuuul/obsidian-pivi/compare/0.11.1...0.11.2) (2026-07-17)


### Bug Fixes

* **release:** bind attestations to release tags ([e9e60e6](https://github.com/shuuul/obsidian-pivi/commit/e9e60e6a777404048c2d18db54cf2ee0f8e63233))

## [0.11.1](https://github.com/shuuul/obsidian-pivi/compare/0.11.0...0.11.1) (2026-07-17)


### Bug Fixes

* **models:** follow upstream xAI catalog for Grok Build ([7195066](https://github.com/shuuul/obsidian-pivi/commit/719506672cd3f79de9c91163d7cec676f79cb0db))

## [0.11.0](https://github.com/shuuul/obsidian-pivi/compare/0.10.0...0.11.0) (2026-07-16)


### Features

* **settings:** add Anthropic Pro/Max browser OAuth ([0146195](https://github.com/shuuul/obsidian-pivi/commit/0146195849ad0345019de5fcd5d1ecbcc7139cf8))
* **settings:** add xAI provider with OAuth ([ff4e20c](https://github.com/shuuul/obsidian-pivi/commit/ff4e20c607026e63bb3122d073291c234978eb33))
* **settings:** split subscription provider identities ([db59740](https://github.com/shuuul/obsidian-pivi/commit/db597400b55c4c28d17d2aef92f8dfa7b4434ddc))


### Bug Fixes

* **obsidian:** address community review feedback ([1cc9d31](https://github.com/shuuul/obsidian-pivi/commit/1cc9d319652efa16804137ff82718e6dc2eb1a14))

**Upgrade note:** Installations that never saved an Obsidian CLI preference now keep the integration disabled. Re-enable it in Pivi settings to restore CLI-backed history, tasks, daily-note, Base-query, command, and evaluation features.

## [0.10.0](https://github.com/shuuul/obsidian-pivi/compare/0.9.0...0.10.0) (2026-07-16)


### Features

* **activity:** add shared activity rows ([6d80461](https://github.com/shuuul/obsidian-pivi/commit/6d8046189c0c6812f1ab5016e9074a8fdc830293))
* **activity:** add shared lifecycle statuses ([2582444](https://github.com/shuuul/obsidian-pivi/commit/2582444d24790268bcf65f68b794d4e84bc97052))
* **activity:** localize status presentation ([41dd15f](https://github.com/shuuul/obsidian-pivi/commit/41dd15ffe4db4d77f1c3fe2903bf948b4818fe26))
* **agents:** add active work shelf ([c63134e](https://github.com/shuuul/obsidian-pivi/commit/c63134e2311dc9523757a1fe89c2eaadfff1e9e1))
* **agents:** add run timeline inspector ([a590fa6](https://github.com/shuuul/obsidian-pivi/commit/a590fa6e33f9bb7b6aa67eecde0113ffaaa49d89))
* **agents:** add stable AgentRun projection ([624a2ea](https://github.com/shuuul/obsidian-pivi/commit/624a2eaa6cf9f0d30ca6ea94efc0b15d924f2181))
* **agents:** group related Agent runs ([625cc94](https://github.com/shuuul/obsidian-pivi/commit/625cc94593c9e5ef7c6654f123faac941e233df0))
* **agents:** promote structured conclusions ([4f28758](https://github.com/shuuul/obsidian-pivi/commit/4f287581546fa87dafec2a0bb60e0febbb45759b))
* **chat:** add nested disclosure sticky stack for subagent tool cards ([e72dc90](https://github.com/shuuul/obsidian-pivi/commit/e72dc906624093e219e3d799172b57c9c858172c))
* **chat:** expose session range pages ([15d6b70](https://github.com/shuuul/obsidian-pivi/commit/15d6b70f74acaf4bea23e6517211d959d021776a))
* **chat:** sequence projection events ([0a03770](https://github.com/shuuul/obsidian-pivi/commit/0a0377009b328669c7dcbac4a1c544321b0cf376))
* **commands:** add expandable command cards ([a29943d](https://github.com/shuuul/obsidian-pivi/commit/a29943d126f4fbf32bdf568cbd57c2811190f231))
* **context:** add conservative envelope model ([c905f74](https://github.com/shuuul/obsidian-pivi/commit/c905f74381e52c8dd9cc78fa81a15a4db995c9cc))
* **context:** add context inspector ([4cd0527](https://github.com/shuuul/obsidian-pivi/commit/4cd05271dd5395f47689f946e3ab79365cfbb68c))
* **context:** apply envelope compaction headroom ([e3cffbc](https://github.com/shuuul/obsidian-pivi/commit/e3cffbc7fc725ad5870dcb9411431c09f38ff5dd))
* **memory:** expand checkpoint details ([45cea11](https://github.com/shuuul/obsidian-pivi/commit/45cea116a26f67e23abbd733a305c3365deed69e))
* **memory:** show compaction and history boundaries ([032a9f3](https://github.com/shuuul/obsidian-pivi/commit/032a9f349c70aef60ce549bf09daa1a7ef03af8b))
* **perf:** add chat instrumentation seams ([bf4d50b](https://github.com/shuuul/obsidian-pivi/commit/bf4d50b918072cd82e0a556c1834941aec621448))
* **perf:** add deterministic Markdown stream driver ([d948a74](https://github.com/shuuul/obsidian-pivi/commit/d948a74ab704a69e045a91f8a3af7245103bc188))
* **perf:** add development chat trace recorder ([b356927](https://github.com/shuuul/obsidian-pivi/commit/b35692714303a4518ce363d544cd6961888b2a03))
* **perf:** isolate tab switching workload ([0674879](https://github.com/shuuul/obsidian-pivi/commit/0674879818164004e0e0c54aed287840fbb134f7))
* **session:** add append-safe JSONL index ([58da99f](https://github.com/shuuul/obsidian-pivi/commit/58da99f27fe47bf720a8397658f1f348f3511855))
* **session:** add continuation schemas ([81e04c7](https://github.com/shuuul/obsidian-pivi/commit/81e04c7ada855ebae76f15863f1dce5a7f7306c2))
* **session:** add indexed message range reads ([78897cc](https://github.com/shuuul/obsidian-pivi/commit/78897cca1bd7e70e9143a12902928051a7100080))
* **session:** hydrate chat history by indexed pages ([0fd67bd](https://github.com/shuuul/obsidian-pivi/commit/0fd67bdd48fd131b3dae3deb1ea173bfb0c4384b))
* **session:** persist compaction checkpoints ([d991e8c](https://github.com/shuuul/obsidian-pivi/commit/d991e8c58dddcb01294806218de1d182f3ae3de6))
* **settings:** add sortable provider fallback ([443bdd9](https://github.com/shuuul/obsidian-pivi/commit/443bdd96f87889b38cf85bb6d042611adf6faab0))
* **settings:** redesign layout system and unify tools page ([ef24060](https://github.com/shuuul/obsidian-pivi/commit/ef24060cb7d36f9030b213e28ebf5ffe90d9f399))
* **settings:** refine command and collection workflows ([a79a66b](https://github.com/shuuul/obsidian-pivi/commit/a79a66bc530f5a29c96bb8a8b02e722c9692e871))
* **settings:** streamline command and MCP workflows ([9436ef7](https://github.com/shuuul/obsidian-pivi/commit/9436ef758ceb21cddccb2bf3e6663c7c2fd64d1e))
* **skills:** support featured bundle updates ([64446ed](https://github.com/shuuul/obsidian-pivi/commit/64446edb8bfa32076717a6fea2a0f966fa3e049e))
* **subagents:** consume structured reports ([2c48a0d](https://github.com/shuuul/obsidian-pivi/commit/2c48a0d0e2b3e898cebbd8ba1dd60bddbced8520))


### Bug Fixes

* **activity:** constrain status motion ([2971f1f](https://github.com/shuuul/obsidian-pivi/commit/2971f1f3f44b3393cbad476a7955c090d5eed433))
* **build:** bound node import postprocessing ([530bf10](https://github.com/shuuul/obsidian-pivi/commit/530bf104aa5af44abde892086d55bcc9d12f3715))
* **chat:** defer virtual row resize measurements ([e6c535c](https://github.com/shuuul/obsidian-pivi/commit/e6c535cdcc428c660955daeeec829c6a0545b833))
* **chat:** drop disclosure shrink chain and double subagent height ([514a8e3](https://github.com/shuuul/obsidian-pivi/commit/514a8e31501885924c0ebe458a9bd6e97e37d45c))
* **chat:** harden projection event boundaries ([18e8378](https://github.com/shuuul/obsidian-pivi/commit/18e83782b018ff315e5035d399ff835ce8281138))
* **chat:** report complete context usage ([54029b4](https://github.com/shuuul/obsidian-pivi/commit/54029b4b870d957e7ab375e267b79b595ccbe6bb))
* **chat:** restore session and subagent presentation ([fbfad95](https://github.com/shuuul/obsidian-pivi/commit/fbfad9515295a2fb4f2494cd32b4a2aedb797c7d))
* **chat:** show MCP server tool names ([74209a8](https://github.com/shuuul/obsidian-pivi/commit/74209a8a52bf4749bb6607071b9a1c82ee0d9b2e))
* **context:** honor reduced motion ([716c0cc](https://github.com/shuuul/obsidian-pivi/commit/716c0cc0383cf31772036901ba26e67a5edbffe3))
* **context:** preserve context authority semantics ([a45472e](https://github.com/shuuul/obsidian-pivi/commit/a45472e84517c0b606f1bb82bd8e465d0697b5d2))
* **perf:** drive indexed paging through scroll ([8326945](https://github.com/shuuul/obsidian-pivi/commit/8326945afa183722019b23da505b764e1f243ecf))
* **perf:** isolate Agent-run trace boundary ([8b56684](https://github.com/shuuul/obsidian-pivi/commit/8b56684f4a136b61ef6067304ed9ac3877c0b0c2))
* **perf:** isolate indexed paging fixture writes ([0356645](https://github.com/shuuul/obsidian-pivi/commit/0356645c3af71d00c33cf52bf6da2ca8f7a84574))
* **perf:** isolate markdown workload tab ([f84c42d](https://github.com/shuuul/obsidian-pivi/commit/f84c42d927c5d1a6f219bd08abc2b6a2567c43b2))
* **session:** preserve partial hydration semantics ([2b79aba](https://github.com/shuuul/obsidian-pivi/commit/2b79aba623fc53bebcf5fc2475a9edf930c25105))
* **session:** run external context migration once ([b1732bb](https://github.com/shuuul/obsidian-pivi/commit/b1732bbb3f0baf6a3cf64e663cffb6f11dcad59f))
* **settings:** align collection add controls ([9c5ead1](https://github.com/shuuul/obsidian-pivi/commit/9c5ead1f3567841eaa0438299fb313955184d742))
* **settings:** refresh locale and normalize selectors ([87382bb](https://github.com/shuuul/obsidian-pivi/commit/87382bbcd55610f30705ade5c9e9e6c8950ac1d2))
* **settings:** route feedback through Obsidian notices ([4322677](https://github.com/shuuul/obsidian-pivi/commit/43226778f5e2dd918435e4dd00206ea34ea2a12f))


### Performance Improvements

* **chat:** isolate projection agent runs ([619c077](https://github.com/shuuul/obsidian-pivi/commit/619c077db2c136efd3b9aef6183e95d38b95f841))
* **chat:** narrow projection row subscriptions ([97615b3](https://github.com/shuuul/obsidian-pivi/commit/97615b357a27f0b2dea15a8e3d3201d8c2c53cec))
* **chat:** reconcile projection entities ([2b03c7a](https://github.com/shuuul/obsidian-pivi/commit/2b03c7a6157060a4dea259714057d64eb50bd450))
* **chat:** subscribe to projection blocks ([f4ddb40](https://github.com/shuuul/obsidian-pivi/commit/f4ddb404a6599d3b1d9dc5fa8a7771c16fccc9b5))
* **chat:** subscribe to projection tools ([edb8628](https://github.com/shuuul/obsidian-pivi/commit/edb86286b6bc55f98dcc52dee5ba34f2cb30b801))
* **chat:** throttle hidden projections ([d9a42f2](https://github.com/shuuul/obsidian-pivi/commit/d9a42f2ffae4f43c1b4b493569c9b1cf46629eab))
* **chat:** virtualize transcripts and optimize streaming ([638b2be](https://github.com/shuuul/obsidian-pivi/commit/638b2be5f764268f6875020d3b1b66fcf7e46182))
* **session:** add isolated indexed paging benchmark ([b730b7f](https://github.com/shuuul/obsidian-pivi/commit/b730b7f34c1ff386955479025347d0774b0897bd))
* **session:** preserve JSONL bytes on append ([fd6d8af](https://github.com/shuuul/obsidian-pivi/commit/fd6d8afe898e2e476257e4b952cf40fcf746dc14))

## [0.9.0](https://github.com/shuuul/obsidian-pivi/compare/0.8.0...0.9.0) (2026-07-14)


### Features

* **commands:** add customizable Note Toolbar commands ([c32e435](https://github.com/shuuul/obsidian-pivi/commit/c32e43575f74d589e7417ed8785eb3dae688a41b))
* **obsidian-ui:** unify product style system ([c955d5c](https://github.com/shuuul/obsidian-pivi/commit/c955d5c0248a8bdb5d40e9b95ad7f146b80335ff))
* **settings:** refine configuration and MCP tool inventory ([434ef89](https://github.com/shuuul/obsidian-pivi/commit/434ef899f9e1029574cff5eb5c6fa4f63b4d4b72))


### Bug Fixes

* **audit:** satisfy Obsidian community review ([24149d3](https://github.com/shuuul/obsidian-pivi/commit/24149d3623a499d8636cfbd2769c7d67decdbfa0))

## [0.8.0](https://github.com/shuuul/obsidian-pivi/compare/0.7.0...0.8.0) (2026-07-14)


### Features

* **chat:** add welcome quote background ([2f5d32d](https://github.com/shuuul/obsidian-pivi/commit/2f5d32d4c9fc2d5b5865991c2714c073282f3311))
* **chat:** expand subagent writer profiles ([eb613fb](https://github.com/shuuul/obsidian-pivi/commit/eb613fb90b1517b99d2a81213a60056470fa456c))
* **chat:** redesign external context handling ([95057a4](https://github.com/shuuul/obsidian-pivi/commit/95057a439052b34bf1d413e20822669ecc8a35e1))
* **chat:** refine agent workflows and presentation ([b629687](https://github.com/shuuul/obsidian-pivi/commit/b6296879c1d5fd2bd8286b15ae3756e863d78461))
* **obsidian-ui:** migrate chat surfaces to React with HEAD parity ([e97eb20](https://github.com/shuuul/obsidian-pivi/commit/e97eb202ed76ca12fc8581b84578dc775bfccf51))
* **settings:** add Style Settings and Note Toolbar integrations ([29b4402](https://github.com/shuuul/obsidian-pivi/commit/29b440253e3341e7029caf66dba1f72a3cc337ca))
* **welcome:** independent card cycling for quote background ([38abb93](https://github.com/shuuul/obsidian-pivi/commit/38abb93c77c9f72df1afa9c594da35e041ac9196))


### Bug Fixes

* **chat:** cap tab switcher at ten visible rows ([8b896b2](https://github.com/shuuul/obsidian-pivi/commit/8b896b2cff9bf64a15c89f00150dec4c6448709d))
* **chat:** harden tools, sessions, and UI lifecycle ([5e47cf9](https://github.com/shuuul/obsidian-pivi/commit/5e47cf9edf06b4e96dcea2089c9662131b790580))
* **chat:** keep long tab title cursor visible ([dc6169f](https://github.com/shuuul/obsidian-pivi/commit/dc6169ffd5433d47d095e05a14b3d13b8ab4dcd5))
* **chat:** keep turn capabilities current ([3618915](https://github.com/shuuul/obsidian-pivi/commit/3618915a08a721a36e3e4f728362ab1ea4bb4312))
* **chat:** merge Write and Obsidian edit tool calls into contiguous step groups ([1889437](https://github.com/shuuul/obsidian-pivi/commit/18894371945c4aca9b032b50c8473a2bb1e7eab3))
* **chat:** parallelize and streamline subagent updates ([d8d76d9](https://github.com/shuuul/obsidian-pivi/commit/d8d76d99b686bb0a17b150dd456dabb089a27e9f))
* **chat:** skip frontmatter code enhancement ([038a737](https://github.com/shuuul/obsidian-pivi/commit/038a73785a29e17a1a7cc44f3f17d64b108ef1ea))
* **chat:** stabilize subagents, tool previews, and note links ([0b30cd7](https://github.com/shuuul/obsidian-pivi/commit/0b30cd712d277987f1f5fc01810c090dbfe6d0dc))
* **chat:** stabilize tab switcher updates ([c70f53c](https://github.com/shuuul/obsidian-pivi/commit/c70f53c6b194b2965f324484c41cb1c31b2f3653))
* **prompt:** add math delimiter rules to Obsidian Markdown Hygiene section ([f7436cd](https://github.com/shuuul/obsidian-pivi/commit/f7436cdc17fb85a249224c69b6e8958a9b068374))
* **providers:** harden custom model metadata refresh ([ab396e4](https://github.com/shuuul/obsidian-pivi/commit/ab396e4813cd9635d73595fc24065e09add32aed))
* **providers:** refresh local model context metadata ([e55f933](https://github.com/shuuul/obsidian-pivi/commit/e55f933a9192c1f446153ef05fab4e4eb652c961))
* **settings:** migrate legacy external context pins ([07e510c](https://github.com/shuuul/obsidian-pivi/commit/07e510ca023287af3ad2376da6edce262f49572a))
* **settings:** standardize context limit labels ([4bff7e0](https://github.com/shuuul/obsidian-pivi/commit/4bff7e0d9e81e9f9c213d1c4abf0da7b4f5bad7c))
* **toolbar:** use theme colors for selectors ([d3a2043](https://github.com/shuuul/obsidian-pivi/commit/d3a204396ab06d2972eccd889ceae0d4b9a1f9cf))
* **welcome:** prevent replacement quote overlap ([d900e48](https://github.com/shuuul/obsidian-pivi/commit/d900e48191185399ef6ef25e086517ae843e199b))

## [0.7.0](https://github.com/shuuul/obsidian-pivi/compare/0.6.0...0.7.0) (2026-07-10)


### Features

* **providers:** add custom/local provider support ([7ec5fa8](https://github.com/shuuul/obsidian-pivi/commit/7ec5fa82fa031c00da0f9b49ac9075c5873e7776))


### Bug Fixes

* **chat:** smooth tab switcher transitions ([fade49c](https://github.com/shuuul/obsidian-pivi/commit/fade49c6c4f54b994ca8f30a9899263c87ae71d4))
* **providers:** restore Zed llama.cpp logo ([6a9181e](https://github.com/shuuul/obsidian-pivi/commit/6a9181e53c09683fabd7d47f01f3404ca0376c6f))

## [0.6.0](https://github.com/shuuul/obsidian-pivi/compare/0.5.0...0.6.0) (2026-07-10)


### Features

* **ai:** support max thinking level ([1ad2895](https://github.com/shuuul/obsidian-pivi/commit/1ad2895ff42947577aa25cbdccf457e1815e8b41))
* **chat:** add editable synced tab titles ([46d30e6](https://github.com/shuuul/obsidian-pivi/commit/46d30e67c7b853f07e5f472cef4d5f191044af11)), closes [#36](https://github.com/shuuul/obsidian-pivi/issues/36)
* prepare next Pivi release ([d029e64](https://github.com/shuuul/obsidian-pivi/commit/d029e6461fada75509d8e064e150c3703fe39e03))

## [0.5.0](https://github.com/shuuul/obsidian-pivi/compare/0.4.0...0.5.0) (2026-07-09)


### Features

* **chat:** constrain Mermaid diagrams in messages ([8248d42](https://github.com/shuuul/obsidian-pivi/commit/8248d423d449ff5635fb073e12bbb233113484d4))
* **chat:** support redo for agent turns ([0603544](https://github.com/shuuul/obsidian-pivi/commit/0603544e7ed77ce04a2787b30b83494a14ab7e14))
* **mention:** support aliased vault file mentions ([345f34d](https://github.com/shuuul/obsidian-pivi/commit/345f34d16ca34c7ec2d158d6b68c2a84384b0b63))
* **obsidian:** add vault analysis tools ([67fb752](https://github.com/shuuul/obsidian-pivi/commit/67fb752d90fddb0507791ae1601407a51dbd8b52))
* **styles:** support Style Settings typography controls ([5c1ae5b](https://github.com/shuuul/obsidian-pivi/commit/5c1ae5be0de4be7131e96bdf6338cd42ffbc1038))


### Bug Fixes

* **prompt:** avoid accidental Obsidian markdown syntax ([4531ab8](https://github.com/shuuul/obsidian-pivi/commit/4531ab884644837270c36121abaa7948e7cd0a70))


### Performance Improvements

* **typecheck:** use TypeScript 7 for faster checks ([805af27](https://github.com/shuuul/obsidian-pivi/commit/805af271ba950e9bb75b640083338c4f5571ab23))

## [0.4.0](https://github.com/shuuul/obsidian-pivi/compare/0.3.12...0.4.0) (2026-07-09)


### Features

* **i18n:** localize full UI and match agent reply language ([fdc9af1](https://github.com/shuuul/obsidian-pivi/commit/fdc9af1551399d6ae397103e73079547cdd9d110))
* **settings:** browse folders for external-read allowlist ([b107c03](https://github.com/shuuul/obsidian-pivi/commit/b107c03ee036ee45f05d037245d2fa2cdb7b0074))

## [0.3.12](https://github.com/shuuul/obsidian-pivi/compare/0.3.11...0.3.12) (2026-07-09)


### Bug Fixes

* **skills:** keep disabled vault skills out of runtime after updates
* **tabs:** preserve active-tab removal and image-only drafts
* **tools:** gate Bash and external filesystem access


### Documentation

* **readme:** document gated Bash and external filesystem access
* **repo:** ignore superpowers execution artifacts

## [0.3.11](https://github.com/shuuul/obsidian-pivi/compare/0.3.10...0.3.11) (2026-07-08)


### Features

* **credentials:** separate web search API keys from Pi provider credentials ([031aa6a](https://github.com/shuuul/obsidian-pivi/commit/031aa6a))
* **models:** support additional Pi providers ([761daf0](https://github.com/shuuul/obsidian-pivi/commit/761daf0))


### Documentation

* **readme:** acknowledge lobe-icons ([c35708e](https://github.com/shuuul/obsidian-pivi/commit/c35708e))

## [0.3.10](https://github.com/shuuul/obsidian-pivi/compare/0.3.9...0.3.10) (2026-07-08)


### Bug Fixes

* **chat:** replace innerHTML with DOMParser for subagent animated icons ([989cd8d](https://github.com/shuuul/obsidian-pivi/commit/989cd8d4094eaecef252bf63cbd2f54c53ae87a0))

## [0.3.9](https://github.com/shuuul/obsidian-pivi/compare/0.3.8...0.3.9) (2026-07-08)


### Features

* add new animated icons and fixed mapping for subagents ([73b2c74](https://github.com/shuuul/obsidian-pivi/commit/73b2c74564e3dac19f379fe40d35bd515d0e47c1))


### Bug Fixes

* **chat:** bound tool step groups to content segments ([aafaaaa](https://github.com/shuuul/obsidian-pivi/commit/aafaaaa1754445554d6ddb1c7ed0c50720852fcc))
* **chat:** clean up tool classification, segment boundaries, tab archive, and inline code path filtering ([8aefee4](https://github.com/shuuul/obsidian-pivi/commit/8aefee422e7b6dbc148e26a714d2c0b64895de7d))
* **chat:** polish subagent indicators and context badges ([35ed9ab](https://github.com/shuuul/obsidian-pivi/commit/35ed9abad67599447862cb14414a441773789d1a))
* **chat:** polish tool activity and markdown rendering ([aaadb44](https://github.com/shuuul/obsidian-pivi/commit/aaadb442bd1240b845ea2d5ddb260269bd2202c7))
* **chat:** render inline code vault paths as wikilinks and enforce alias format ([6b5df53](https://github.com/shuuul/obsidian-pivi/commit/6b5df532a3fd8ed44f060ed29ed60d4a81face87))
* **chat:** support multi-word writer names with suffix in subagent icon resolution ([2339b9b](https://github.com/shuuul/obsidian-pivi/commit/2339b9ba6ad4921f480b7c721925928c8dda514c))
* **chat:** unify subagent markdown rendering with main chat ([834faf4](https://github.com/shuuul/obsidian-pivi/commit/834faf4a6fe3a8f8edf737f7fb8b106a82c4e534))
* **chat:** update subagent status animations ([b366f84](https://github.com/shuuul/obsidian-pivi/commit/b366f84b27cc4276323ee5e18187123880576f1f))

## [0.3.8](https://github.com/shuuul/obsidian-pivi/compare/0.3.7...0.3.8) (2026-07-07)


### Bug Fixes

* comply with Obsidian community review lint feedback

## [0.3.7](https://github.com/shuuul/obsidian-pivi/compare/0.3.6...0.3.7) (2026-07-07)


### Features

* **tools:** allowlist external filesystem access ([4496c62](https://github.com/shuuul/obsidian-pivi/commit/4496c623328b2574a13c631fd96715176bb2fffb))


### Bug Fixes

* **app:** replace deprecated getView/getAllViews/setWarning/detach, and clean unused variables ([f4e103b](https://github.com/shuuul/obsidian-pivi/commit/f4e103baa37f3f7c1eaf6c8985088c620bb35939))
* **core:** resolve unsafe typescript-eslint member access and typecast warnings ([f3d652c](https://github.com/shuuul/obsidian-pivi/commit/f3d652c14ee59b1a6b380601e7fe0422d3d54ce2))
* **host:** avoid globalThis and bind auth context methods safely ([9983b99](https://github.com/shuuul/obsidian-pivi/commit/9983b99fd4a50f13c8f56cdfa7168ed3be73323b))
* **mcp:** declare resolve and reject as function properties to allow safe destructuring ([dd7bb34](https://github.com/shuuul/obsidian-pivi/commit/dd7bb3407cea520fe5e8dfde6333ddd36665a9e0))

## [0.3.6](https://github.com/shuuul/obsidian-pivi/compare/0.3.5...0.3.6) (2026-07-07)


### Features

* **chat:** add async subagent workflow ([e3b9128](https://github.com/shuuul/obsidian-pivi/commit/e3b912802c254c18b550c153e62bf1d48cf8c1d2))
* **chat:** add automatic session compaction ([079dc1e](https://github.com/shuuul/obsidian-pivi/commit/079dc1ee59d8f05e868a853901072b62658d2374))
* **chat:** show token usage beside send button ([a2e74c4](https://github.com/shuuul/obsidian-pivi/commit/a2e74c403eac6e90ea1c4590a09046470ba4191c))
* **obsidian-tools:** add safe markdown reading tools ([7b01ed6](https://github.com/shuuul/obsidian-pivi/commit/7b01ed601906e293d85451d9bd2b1f48ba77e6ae))


### Bug Fixes

* **chat:** preserve pasted absolute paths in mentions ([cce5c0f](https://github.com/shuuul/obsidian-pivi/commit/cce5c0fca6f300c7534548e71aca8684853f36ea))
* **chat:** stabilize subagent activity lifecycle ([fef2b30](https://github.com/shuuul/obsidian-pivi/commit/fef2b300b853f71cbaaf506aef683922254d32e7))
* **chat:** tighten compaction context handling ([91e6e9f](https://github.com/shuuul/obsidian-pivi/commit/91e6e9f08ea5676ce158ad3ef47b9989acafee2c))
* **prompt:** guide safe markdown reading workflow ([5dcd226](https://github.com/shuuul/obsidian-pivi/commit/5dcd226004b429d68f84cffc234045c3629be656))

## [0.3.5](https://github.com/shuuul/obsidian-pivi/compare/0.3.4...0.3.5) (2026-07-05)


### Features

* **web:** add web search and fetch tools ([df02c60](https://github.com/shuuul/obsidian-pivi/commit/df02c601d077f8c9236ef5233ce431c751f56934))


### Bug Fixes

* **build:** remove bundled localStorage access ([1b4c319](https://github.com/shuuul/obsidian-pivi/commit/1b4c31973935768385e2c1c136536caa97f73629))
* **chat:** align web tool call headers ([4168408](https://github.com/shuuul/obsidian-pivi/commit/4168408078a34fad11a0c365fcd3c3ab030bf40d))
* **chat:** show skill descriptions in tool previews ([c0d00ce](https://github.com/shuuul/obsidian-pivi/commit/c0d00ce00f7f5e2b112248f524cc1232580fc010))
* **chat:** standardize tool call icon alignment ([60fe339](https://github.com/shuuul/obsidian-pivi/commit/60fe339ef29c31e0eef54241220bf9fb2bb97043))
* **prompt:** clarify Obsidian search casing ([27ffbc0](https://github.com/shuuul/obsidian-pivi/commit/27ffbc04427876e7d09ef69b1063d4f121e0cf71))

## [0.3.4](https://github.com/shuuul/obsidian-pivi/compare/0.3.3...0.3.4) (2026-07-03)


### Bug Fixes

* **lint:** resolve source and CSS lint warnings ([f5e8d89](https://github.com/shuuul/obsidian-pivi/commit/f5e8d89f8af378405b17dc8f109187cb51d9e09d))

## [0.3.3](https://github.com/shuuul/obsidian-pivi/compare/0.3.2...0.3.3) (2026-07-03)


### Bug Fixes

* **release:** normalize GitHub release titles ([6e47cdf](https://github.com/shuuul/obsidian-pivi/commit/6e47cdfd74b5cdc73afe7b98e705c222d0bbb401))
* **ui:** type private settings pane access ([609954c](https://github.com/shuuul/obsidian-pivi/commit/609954c4f54089747b8cdfd43ff5ef1a5d810f6b))

## [0.3.2](https://github.com/shuuul/obsidian-pivi/compare/0.3.1...0.3.2) (2026-07-03)


### Features

* **chat:** add compact session switcher ([13ce81d](https://github.com/shuuul/obsidian-pivi/commit/13ce81d1f912dc76e337c93f6509747608ceb99f))
* **chat:** add generate-image slash command and tool result preview ([4d3d4f9](https://github.com/shuuul/obsidian-pivi/commit/4d3d4f93e68b56d887f864df31237989ea510d9c))
* **chat:** add Obsidian tool previews ([4822f09](https://github.com/shuuul/obsidian-pivi/commit/4822f09c25c577f16eaf55b72908882abbf3d8ff))
* **chat:** align response action buttons with Zed ([04c92d8](https://github.com/shuuul/obsidian-pivi/commit/04c92d84de0a4bb4382574b8dc4e5cd87acb2de3))
* **chat:** improve Pi sessions and message actions ([b6c13b4](https://github.com/shuuul/obsidian-pivi/commit/b6c13b4eb319733e3498a61c2176c896c38b3d22))
* **chat:** persist archived tabs and simplify settings ([a5fe0b3](https://github.com/shuuul/obsidian-pivi/commit/a5fe0b3e563782d2228394ed2a5677f2909749bf))
* **chat:** simplify session restore and message actions ([a1b4523](https://github.com/shuuul/obsidian-pivi/commit/a1b452324b5f77fe1258f93d905e2a5aa3391090))
* **plugin:** add Codex image generation and per-tool toggle settings ([6c275e1](https://github.com/shuuul/obsidian-pivi/commit/6c275e12e2cd5086325f6fa690868914c420df5a))
* **settings:** add Skills settings tab and i18n tab labels ([0cf28fb](https://github.com/shuuul/obsidian-pivi/commit/0cf28fbd3a409ab6e7d51f8fdafad4ebd9d43081))


### Bug Fixes

* **auth:** consolidate provider credential storage ([1b8b5bb](https://github.com/shuuul/obsidian-pivi/commit/1b8b5bbfb9e8b0a3d0ca448b57b9a24f2b2bea5a))
* **chat:** align Obsidian tool display ([c2724fe](https://github.com/shuuul/obsidian-pivi/commit/c2724fe8ea1aa4f60d98d31a65834130bde6897c))
* **chat:** align Obsidian tool display ([9d99070](https://github.com/shuuul/obsidian-pivi/commit/9d990700eae848927fd851811d27a501b55d2cda))
* **chat:** improve tab switcher close flow ([332387d](https://github.com/shuuul/obsidian-pivi/commit/332387ddf134afeb76837276694c39d71fa0ee45))
* **chat:** remove active tab checkmark ([7715ce1](https://github.com/shuuul/obsidian-pivi/commit/7715ce133974e8bf4828699ba7b813345f622f81))
* **chat:** streamline fork creation flow ([733f5ad](https://github.com/shuuul/obsidian-pivi/commit/733f5ade2c51965587876259c368b1b51b830b81))
* **plugin:** polish chat blocks and bundle loading ([b5ab045](https://github.com/shuuul/obsidian-pivi/commit/b5ab045218442e7d7ef4417facfa4cd8d1ad2786))

## [0.3.1](https://github.com/shuuul/obsidian-pivi/compare/0.3.0...0.3.1) (2026-06-30)


### Features

* **settings:** add command management and reorganize tabs ([00b89a7](https://github.com/shuuul/obsidian-pivi/commit/00b89a72aafaf3649fc72dd581faee424cac7088))


### Bug Fixes

* **core:** harden storage errors and diff previews ([e3dae5c](https://github.com/shuuul/obsidian-pivi/commit/e3dae5cef91c71d212ae9f22a96c3aee7eed292b))

## [0.3.0](https://github.com/shuuul/obsidian-pivi/compare/v0.2.4...0.3.0) (2026-06-30)


### Features

* **plugin:** rename Obsius to Pivi ([2d94230](https://github.com/shuuul/obsidian-pivi/commit/2d9423034e8b424c3619588b6c8fd5d3b38940b2))


### Bug Fixes

* **plugin:** comply with Obsidian review guidelines ([53583fe](https://github.com/shuuul/obsidian-pivi/commit/53583fe39c01b7c09a7d0bd76fc67889bb702835))


### BREAKING CHANGES

* **plugin:** the plugin id and package metadata are now Pivi (`pivi`) instead of Obsius.

## [0.2.4](https://github.com/shuuul/obsidian-pivi/compare/v0.2.3...v0.2.4) (2026-06-25)


### Bug Fixes

* **chat:** rank slash commands by query ([f4b9353](https://github.com/shuuul/obsidian-pivi/commit/f4b9353de9f0ba61404e297d1b2a7374204849b8))
* **skills:** parse decorated remote skill lists ([e41d57f](https://github.com/shuuul/obsidian-pivi/commit/e41d57f57b577f095bbfc3b76134507a4abd3a5b))

## [0.2.3](https://github.com/shuuul/obsidian-pivi/compare/v0.2.2...v0.2.3) (2026-06-25)


### Features

* **chat:** add detailed slash command selector ([608ff60](https://github.com/shuuul/obsidian-pivi/commit/608ff6040def7b8396d37bf3e0c8dc920f58649d))


### Bug Fixes

* **auth:** align Codex OAuth browser login ([72c7c3e](https://github.com/shuuul/obsidian-pivi/commit/72c7c3e4e3d713cd0f56570aeb0d331d5f98c216))
* **auth:** preserve Codex OAuth browser flow ([780951a](https://github.com/shuuul/obsidian-pivi/commit/780951a4a375b39cdb0a2d4581a9d0bb8cc06cf0))
* **chat:** polish tool UI and Obsidian links ([9687848](https://github.com/shuuul/obsidian-pivi/commit/9687848309e49859948d78f7aab1e5ee6958193e))
* **chat:** render tool calls while waiting for results ([9ef53b1](https://github.com/shuuul/obsidian-pivi/commit/9ef53b1bb59d91960b9e68e77173bf6400cae887))
* **chat:** tighten slash selector layout ([8e1fbd5](https://github.com/shuuul/obsidian-pivi/commit/8e1fbd529947b156bd19715222f0ef43af1c740e))
* **chat:** use Obsidian image embed resolution ([91955c4](https://github.com/shuuul/obsidian-pivi/commit/91955c4a9109bc7604c0b63db094ddb1a9d48631))
* **settings:** show Codex models after OAuth ([b078d26](https://github.com/shuuul/obsidian-pivi/commit/b078d26e003889d7abd9568fcd1d3a5e0786cbfe))
* **settings:** simplify model readiness controls ([47c4629](https://github.com/shuuul/obsidian-pivi/commit/47c46290309a203b561842d3b91fcff5048390e1))
* **skills:** keep CLI metadata under .pivi ([54e41e7](https://github.com/shuuul/obsidian-pivi/commit/54e41e7ea525f1254bc495d0fd027da95c6a4d94))

## [0.2.2](https://github.com/shuuul/obsidian-pivi/compare/v0.2.1...v0.2.2) (2026-06-24)


### Features

* **skills:** add remote selection and updates ([6e02bf8](https://github.com/shuuul/obsidian-pivi/commit/6e02bf863169d6cd24a429686b5ec6d8bd913e34))
* **tools:** expand Obsidian native tool surface ([5677f2e](https://github.com/shuuul/obsidian-pivi/commit/5677f2e))


### Bug Fixes

* **chat:** tighten status panel layout ([9ef66f0](https://github.com/shuuul/obsidian-pivi/commit/9ef66f0))
* **session:** preserve tool call history on restore ([10e833a](https://github.com/shuuul/obsidian-pivi/commit/10e833a))
* **session:** restore tool calls in chat history ([1cb86bb](https://github.com/shuuul/obsidian-pivi/commit/1cb86bb))
* **session:** summarize branches by visible turns ([1153dae](https://github.com/shuuul/obsidian-pivi/commit/1153dae))
* **ui:** render Obsidian list results structurally ([07dff99](https://github.com/shuuul/obsidian-pivi/commit/07dff99))

## [0.2.1](https://github.com/shuuul/obsidian-pivi/compare/v0.2.0...v0.2.1) (2026-06-23)


### Bug Fixes

* **release:** prepare automated 0.2.1 release ([710af94](https://github.com/shuuul/obsidian-pivi/commit/710af9443f1bd193f6db4cf4d5f8ad8572be3399))
