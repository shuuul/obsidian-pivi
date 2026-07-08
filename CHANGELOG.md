# Changelog

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
