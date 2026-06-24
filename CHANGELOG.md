# Changelog

## [0.2.1](https://github.com/shuuul/obsius2/compare/v0.2.2...v0.2.1) (2026-06-24)


### Features

* add inline context input panel and mention badge system ([57c441e](https://github.com/shuuul/obsius2/commit/57c441e5982bb278dff8a01c0ba59c1dae96f5f1))
* **chat:** add MCP recovery actions ([36b2347](https://github.com/shuuul/obsius2/commit/36b234739064e223614b0d5124c005a1b581c9e5))
* **chat:** clarify MCP context and session state ([40ef620](https://github.com/shuuul/obsius2/commit/40ef620415b4b87e178717397bb15324060fc59d))
* **chat:** show model readiness in selector ([be662e5](https://github.com/shuuul/obsius2/commit/be662e590afa4697d1998798543d79ffd2be5b6e))
* **chat:** wire session tree into tabs, runtime, and tool call UI ([23146cf](https://github.com/shuuul/obsius2/commit/23146cfdfc90a2898ed82182a6d005984c2b3ee5))
* completely remove instruction mode (# mode) and instruction refinement service ([37d4b0e](https://github.com/shuuul/obsius2/commit/37d4b0ebcf2812d27c62be8e3d05c96283d2ff80))
* **core:** align system prompt with Obsidian-native tools (Phase 0) ([fb85d4c](https://github.com/shuuul/obsius2/commit/fb85d4ccf470745fd3509939301e0da95cfa100f))
* implement default vault skills bundle installation and management ([82bc7b8](https://github.com/shuuul/obsius2/commit/82bc7b859b3e3eee10bf8c4a7b478286e1b2c462))
* implement prompt templates, custom slash command catalog & create-command modal ([c82a5c9](https://github.com/shuuul/obsius2/commit/c82a5c924be551893112199897652268778e6985))
* implement Session Tree UI Branch Picker (Option A) ([698a17d](https://github.com/shuuul/obsius2/commit/698a17d4d196833ae287970c66f6a165b7da8dca))
* initial commit with redesigned obsius2 UI, settings tabs, provider credentials, and candidate models pool ([aa7d175](https://github.com/shuuul/obsius2/commit/aa7d1759fde2bd0950b2f7e05f03f0ccac74aace))
* **mcp:** vault-local MCP, OAuth, proxy tool, and /mcp-auth ([56f9b6f](https://github.com/shuuul/obsius2/commit/56f9b6f27f983b05e609540fbaaa7871347b0967))
* **pi:** add hybrid Obsidian agent tools (Phase 1) ([de22a9f](https://github.com/shuuul/obsius2/commit/de22a9f9e66505a7a724cdeb0de2f9ea3dd75f30))
* **pi:** add vault skills settings UI with npx install ([a64fb48](https://github.com/shuuul/obsius2/commit/a64fb48a21b95ded1285b420207423b37e3baecd))
* **pi:** Codex OAuth in settings and wire agent runtime (Phase 4) ([d541994](https://github.com/shuuul/obsius2/commit/d5419947b35fc1699752c6f66f89319dfbc6bb6d))
* **pi:** expand Obsidian vault tools and CLI path resolution ([bfc9336](https://github.com/shuuul/obsius2/commit/bfc93369c047fbf9b41ced75815e0bd41e5e0b39))
* **pi:** JSONL session tree store and .obsius storage layout ([689dd5c](https://github.com/shuuul/obsius2/commit/689dd5cd804787cc99383f17db466833d8735c68))
* **pi:** migrate to selected pi-ai providers ([5e49518](https://github.com/shuuul/obsius2/commit/5e495183ccd5a71258e7377728fffb4e71fd7386))
* **pi:** pi-compatible JSONL sessions under .obsius/sessions (Phase 3) ([0a74f5c](https://github.com/shuuul/obsius2/commit/0a74f5cf6feae3e402610a561d654a28b8a37a97))
* **pi:** remove manual CLI path, support dynamic provider adding from pi-ai ([bd9c7c6](https://github.com/shuuul/obsius2/commit/bd9c7c60cbf54b50132acf0f389d8db91aaf1bd8))
* **pi:** store provider credentials in Obsidian keychain ([86f4457](https://github.com/shuuul/obsius2/commit/86f44574759572931f90cc78dee7a447354458a5))
* **pi:** use keychain-backed pi-ai credentials ([0f8a16a](https://github.com/shuuul/obsius2/commit/0f8a16a559f5f20832bf8614f0e96b6159d951ad))
* **pi:** vault context layers and skill tool (Phase 2) ([4887091](https://github.com/shuuul/obsius2/commit/488709128a1a2a960baab4fa8ca6816a41173627))
* **prompt:** add turn/system prompts and auxiliary query services ([55f198d](https://github.com/shuuul/obsius2/commit/55f198d58676b641816b9fcdda2e1783b10716ee))
* **session:** clarify branch leaf history ([b70ed5f](https://github.com/shuuul/obsius2/commit/b70ed5f22b7950d4db439af1ac6f777217dacf7e))
* **settings:** add provider readiness test action ([e98ba37](https://github.com/shuuul/obsius2/commit/e98ba37e96df64d1e045a305ce07486ce7846a83))
* **settings:** show provider readiness status ([6de2c5b](https://github.com/shuuul/obsius2/commit/6de2c5b7698710d048b85f3c4fee0f5c4a424b59))
* **settings:** streamline provider configuration ([33786a1](https://github.com/shuuul/obsius2/commit/33786a181435e952e8abeefc6f781583c0c21e51))
* **skills:** add remote selection and updates ([6e02bf8](https://github.com/shuuul/obsius2/commit/6e02bf8f4e9f209320d762c020ed890b9d4bd2ff))
* **tools:** add obsidian_edit with quote-aware errors and prompt guidance ([355a65a](https://github.com/shuuul/obsius2/commit/355a65a0fb04beed9a39d670240f732f34cbcb0f))
* **tools:** expand Obsidian native tool surface ([5677f2e](https://github.com/shuuul/obsius2/commit/5677f2e4724f03973346f17c2986c2ceffb0e332))
* **ui:** align sidebar brand icon with toolbar and enlarge title ([98fc28d](https://github.com/shuuul/obsius2/commit/98fc28dbc898ffc7f256ee5bd17dfd70e2aeb5ec))
* **ui:** inline mention badges, folder paths in context, and send/stop ([33458f5](https://github.com/shuuul/obsius2/commit/33458f5baa3804ed92b514f876fe145dee0c317e))
* **ui:** provider brand icons, thinking levels, and Obsidian build hardening ([d48f16d](https://github.com/shuuul/obsius2/commit/d48f16d2a0a7680fd7c3a86497910007d4312eb7))


### Bug Fixes

* **chat:** polish streaming text finalization and skill tool labels ([08597c9](https://github.com/shuuul/obsius2/commit/08597c95a73e5ccdc807e9999900feab2dfa1afb))
* **chat:** re-hydrate history sessions and hide persisted turn XML in UI ([d03e7eb](https://github.com/shuuul/obsius2/commit/d03e7ebdb0dc4cd3257cfab680817ea5f5936d03))
* **chat:** remove blank lines after tool use in streaming UI ([d6971f9](https://github.com/shuuul/obsius2/commit/d6971f9d96f3ae649cc6cf1fd8e1a1fa5db7e541))
* **chat:** sidebar header a11y and vault event lifecycle ([4dc9cd8](https://github.com/shuuul/obsius2/commit/4dc9cd8c27bdaa4c844793d24a904330061f47dd))
* **chat:** tighten status panel layout ([9ef66f0](https://github.com/shuuul/obsius2/commit/9ef66f0fd1c39fa683f3638a4ff0264c9126e878))
* **ci:** skip --localstorage-file on Node 20 ([50e3f61](https://github.com/shuuul/obsius2/commit/50e3f613acabcd411645c55e9f696f87dd88e5d7))
* **ci:** sort imports to satisfy ESLint quality gate ([042295e](https://github.com/shuuul/obsius2/commit/042295ed4b6b9395ff457b30216c23ac0b2158fa))
* **ci:** use legacy-peer-deps so npm ci succeeds on GitHub Actions ([0829aa3](https://github.com/shuuul/obsius2/commit/0829aa35288080c1bde1c4698134339a476f2541))
* **pi:** resolve API key lookup for hyphenated providers, validate visibleModels, improve error messages ([c1687c7](https://github.com/shuuul/obsius2/commit/c1687c77b3f58dc88e8ad14f5dc51f149213748c))
* **pi:** route provider auth through pi-ai ([a70a9d8](https://github.com/shuuul/obsius2/commit/a70a9d83a8e088d2f203df0872115d2326c43221))
* **pi:** use requestUrl for probes and drop unsafe casts ([d287f5a](https://github.com/shuuul/obsius2/commit/d287f5a9237fc56217bb42e2f6bd26df20dbb96d))
* **release:** prepare automated 0.2.1 release ([710af94](https://github.com/shuuul/obsius2/commit/710af9443f1bd193f6db4cf4d5f8ad8572be3399))
* **session:** persist session identity outside agent state ([5708563](https://github.com/shuuul/obsius2/commit/570856328c7368683854a1b17e82ffe9306dcde3))
* **session:** preserve tool call history on restore ([10e833a](https://github.com/shuuul/obsius2/commit/10e833a7527e524efd5f219aeffd4b237b108ea4))
* **session:** restore tool calls in chat history ([1cb86bb](https://github.com/shuuul/obsius2/commit/1cb86bbb335100075138fb8e839d36467729404c))
* **session:** summarize branches by visible turns ([1153dae](https://github.com/shuuul/obsius2/commit/1153dae7deafbd0469282bf505bd3457eb16886b))
* **test:** align Jest env with browser and in-memory sessions ([acf10c8](https://github.com/shuuul/obsius2/commit/acf10c8735d57c00d84a53f55fb59812cd040c17))
* **tools:** harden Obsidian tool input validation ([9629543](https://github.com/shuuul/obsius2/commit/962954355d44e99c01a2fccef74fa7cfaf0231a6))
* **ui:** render Obsidian list results structurally ([07dff99](https://github.com/shuuul/obsius2/commit/07dff993258d9938401999f0b7e30b6bb2eff93a))

## [0.2.2](https://github.com/shuuul/obsius2/compare/v0.2.1...v0.2.2) (2026-06-24)


### Features

* **skills:** add remote selection and updates ([6e02bf8](https://github.com/shuuul/obsius2/commit/6e02bf863169d6cd24a429686b5ec6d8bd913e34))
* **tools:** expand Obsidian native tool surface ([5677f2e](https://github.com/shuuul/obsius2/commit/5677f2e))


### Bug Fixes

* **chat:** tighten status panel layout ([9ef66f0](https://github.com/shuuul/obsius2/commit/9ef66f0))
* **session:** preserve tool call history on restore ([10e833a](https://github.com/shuuul/obsius2/commit/10e833a))
* **session:** restore tool calls in chat history ([1cb86bb](https://github.com/shuuul/obsius2/commit/1cb86bb))
* **session:** summarize branches by visible turns ([1153dae](https://github.com/shuuul/obsius2/commit/1153dae))
* **ui:** render Obsidian list results structurally ([07dff99](https://github.com/shuuul/obsius2/commit/07dff99))

## [0.2.1](https://github.com/shuuul/obsius2/compare/v0.2.0...v0.2.1) (2026-06-23)


### Bug Fixes

* **release:** prepare automated 0.2.1 release ([710af94](https://github.com/shuuul/obsius2/commit/710af9443f1bd193f6db4cf4d5f8ad8572be3399))
