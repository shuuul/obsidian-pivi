# Changelog

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
