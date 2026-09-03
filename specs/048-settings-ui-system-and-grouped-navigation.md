---
id: "048"
title: "Settings UI system and Obsidian-native page navigation"
status: Active
created: 2026-09-03
updated: 2026-09-03
coordinator: "Cursor (Claude), owner shuuul"
---

# 048 — Settings UI system and Obsidian-native page navigation

## Context

The React settings surface (`packages/pivi-react/src/settings/`, 35 files / ~7.6k lines of TSX plus ~2.3k lines under `packages/pivi-react/styles/settings/`) grew page by page. Each page invented its own presentation idiom, so the same concept renders differently depending on which tab the user opens:

- **Four competing collection idioms.** Models, MCP servers, and Web providers use provider-style disclosure cards (`.pivi-provider-card`, `.pivi-mcp-card`, `.pivi-web-provider-*`); Skills and Commands' internal list use flat `.pivi-sp-item` cards; Toolbar mixes compact sortable rows with removable disclosures; Prompt modules use their own card chrome in `prompt-settings.css`. Header layouts, toggle/remove placement, hover treatment, and body padding differ across all of them.
- **Two competing section idioms.** `SettingsSection` (heading + divider + surfaced body) coexists with `SettingsListHeader` (heading + actions, no body) and the Tools page's own `pivi-tools-settings-page` flow wrapper.
- **Spacing, radius, and color are set in seven feature CSS files.** `provider-settings.css` (726 lines) and `base.css` (774 lines) both define card tokens; `mcp-settings.css`, `slash-settings.css`, `command-editor.css`, and `prompt-settings.css` restate padding, gap, border, and radius values instead of consuming a shared contract. Recent commits (`7dcbf2a2 Polish settings section surfaces`) kept patching individual surfaces without a system that prevents the next divergence.
- **Eight flat top-level tabs** (`SettingsShell.tsx`: General, Models, Skills, Tools, Subagents, Commands, Toolbar, Prompt) wrap to two rows on narrow settings panes. Tools is a long single page with three unrelated sections, while Subagents is three rows.
- **Search cannot route.** `PiviSettingTabHost.getSettingDefinitions()` returns one `SettingDefinitionRender` item for the whole plugin. `render(setting, group)` does not receive the matched query, so Obsidian 1.13 settings search can only open the whole Pivi surface; no alias can ever land on a page or row from a single item.

Platform facts verified on 2026-09-03 (`node_modules/obsidian/obsidian.d.ts` 1.13.1; [Obsidian 1.13 public changelog, 2026-07-30](https://obsidian.md/changelog/2026-07-30-desktop-v1.13.4/); [Settings developer docs](https://docs.obsidian.md/Plugins/User+interface/Settings)):

- `SettingDefinitionPage` (`type: 'page'`) is a navigable entry that slides in a sub-page with a back button and titlebar; `page: () => SettingPage` renders the sub-page imperatively (`SettingPage.display()` into `containerEl`, `hide()` on navigate-away / tab switch / modal close, not guaranteed on window destroy). The factory runs each time the page is opened.
- `SettingDefinitionGroup` (`type: 'group'`) is a heading whose `items` may contain both settings and pages.
- `getSettingDefinitions()` is called on every `update()` and once at registration for the search index; it must stay cheap. Page entries are indexed by `name`, `desc`, and `aliases`.
- The official migration guide recommends Path A (bump `minAppVersion` to 1.13.0, delete `display()`) whenever the plugin can drop pre-1.13 users. Obsidian refuses to enable a plugin below its `minAppVersion`, so no runtime guard is needed.
- Obsidian guidance on sub-pages: use them only when the parent tab is too long to scan or the section has a self-contained scope; two or three settings stay on the parent.

The work spans one package, app-side host wiring, the plugin manifest, i18n catalogs, style architecture, contract tests, and human visual sign-off across every settings page, so it needs a tracked spec.

## Goal and success criteria

Ship one enforced settings UI system, move navigation onto Obsidian 1.13's native settings pages, and migrate every settings page onto that system in a single release, deleting the legacy idioms and the 1.12 fallback.

- [ ] `manifest.json` `minAppVersion` is `1.13.0`; `PiviSettingTabHost` has no `display()`; `getSettingDefinitions()` returns the root layout in this exact order: page **Models**; group **Agent** → Built-in tools · Web tools · MCP servers · Skills · Prompt; group **Editor** → Commands · Toolbar; group **General** → page Environment; then one root-level `render` item mounting the General content. Verified by `tests/jsdom/app-ui/PiviSettingTabHost.test.ts` over the returned structure.
- [ ] Each page entry carries a localized `name`, `desc`, and `aliases` derived from the labels of every row on that page, so Obsidian search opens the owning page (page-level routing; no row addressing). Verified by a unit test over `SETTINGS_PAGES` alias coverage (every former `SETTINGS_SEARCH_KEYS` key is owned by exactly one page).
- [ ] Each page is a `PiviSettingsPage extends SettingPage` whose `display()` mounts `mountSettingsPage({ page, ports, ... })` into `containerEl` and whose `hide()` disposes the React root; plugin unload disposes any surface still mounted. The React package has no `SettingsShell`, tablist, sub-nav, or navigation memory. Verified by `PiviSettingTabHost.test.ts` (mount/dispose lifecycle, locale change → `update()`) and by `rg` in the contract test for the deleted components.
- [ ] Built-in tools page contains a **Subagents** section (the three former Subagents rows); About remains the last section of the General content; Environment is its own page. `SettingsPageId` has exactly ten values: `general`, `environment`, `models`, `builtInTools`, `webTools`, `mcpServers`, `skills`, `prompt`, `commands`, `toolbar`. Verified by a jsdom test over `SETTINGS_PAGES` and page renders.
- [ ] Every page composes only the approved primitives (`SettingsPage`, `SettingsSection`, `SettingRow`, `SettingsCollection`, `DisclosureCard`, `SettingsInlineActions`, `SettingsFeedback`, and the controls under `primitives/controls/`). A contract test rejects raw structural class names (`pivi-settings-page`, `pivi-settings-section`, `pivi-settings-row`, `pivi-settings-collection`, `pivi-settings-card`, `pivi-settings-actions`, `pivi-settings-feedback`, `pivi-sp-`, `pivi-provider-card`, `pivi-mcp-card`, `pivi-web-provider-`) in any settings TSX outside `settings/primitives/`.
- [ ] Every collection item renders through `SettingsCollection` as either a `DisclosureCard` (item has an editable body: providers, web providers, MCP servers, workspace commands, removable/configurable toolbar items, workflow and custom prompt modules) or a flat `SettingRow` with `SettingsInlineActions` (item has nothing to edit: installed and remote skills, internal commands, required toolbar actions, curated editor commands; source/folder/identifier/target go in the row description). No card ever has an empty or metadata-only body. `.pivi-sp-*`, `.pivi-provider-card`, `.pivi-mcp-card`, `.pivi-web-provider-*`, `.pivi-tools-settings-page`, `.pivi-settings-tabs`, `.pivi-settings-tab`, and bespoke prompt-module card selectors no longer exist in `styles/`. Verified by the style contract test.
- [ ] Feature CSS under `styles/settings/features/` contains no `margin*`, `padding*`, `gap`, `row-gap`, `column-gap`, `border-radius`, `border`, or `border*-color` declarations, and every `color` / `background*` value is exactly one `var(--pivi-settings-*)` or `var(--pivi-host-*)` token. `--pivi-settings-*` custom properties are declared only in `styles/settings/system/tokens.css`. Verified by `tests/unit/ui/settingsStyleContract.test.ts` parsing every feature file, with `tests/unit/ui/settingsStyleContract.allowlist.json` for reviewed `file:selector:property` exceptions (target: empty).
- [ ] Visual direction is Obsidian-native 1.13: each section is a native-metric heading plus one surfaced rounded body (`--pivi-host-setting-items-background`) holding flat rows and disclosure rows separated by hairlines; no nested surfaces, no per-item card borders; Pivi render items are not double-wrapped by Obsidian's implicit group surface. Human visual sign-off at Checkpoint 1 and Checkpoint 2 (see Verification), light and dark themes.
- [ ] All new UI copy ships in `en.json` and every other locale in the same commit; `settings.tabs.*` keys are removed; `scripts/check-i18n-dead-keys.mjs` is green.
- [ ] `npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build && npm run check:bundle-size && npm run check:specs` green; `obsidian plugin:reload id=pivi` then `obsidian dev:errors` reports no errors.

## Scope and non-goals

In scope:

- `minAppVersion` 1.13.0; native page navigation through `getSettingDefinitions()`; `PiviSettingsPage` host class; deletion of `display()`, `SettingsShell`, tab CSS, and the 1.12 route.
- `settings/primitives/` module with the approved primitives, a shrinking legacy allowlist during migration, and a written usage contract in `packages/pivi-react/AGENTS.md`.
- CSS restructure: `styles/settings/system/*.css` (tokens, host reset, layout, row, controls, card, feedback) plus `styles/settings/features/*.css` limited to feature-internal structure; `manifest.mjs` updated; legacy settings CSS files deleted.
- Migration of all ten pages onto the primitives, including splitting Tools into three pages, folding Subagents into Built-in tools, and moving Environment out of General.
- `mountSettingsPage` mount API; location-aware `searchMetadata.ts` → `SETTINGS_PAGES` inventory with per-page aliases.
- Contract tests (style declarations, raw-class usage, page inventory, alias ownership), jsdom behavior tests, host lifecycle tests, i18n catalog updates, documentation sync.

Not in scope:

- Changing which settings exist, their persistence, or any `SettingsPorts` action semantics. `SettingsPorts` stays one object shared by every page.
- Row-level deep links or highlight (`rowId`). No caller exists; Obsidian search routes to pages only.
- Navigation memory of any kind (Obsidian owns settings navigation).
- Declarative per-row `items` / `SettingDefinitionList` for page contents; pages are imperative React mounts.
- Chat surface CSS, composer, or transcript styling.
- New settings features (for example a Pivi-internal search box).
- Mobile layouts (Desktop-only remains per spec 042).
- Version bump and `CHANGELOG.md` (release commit per SOP; this ships as **0.24.0** with a "Requires Obsidian 1.13 or later" note).

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-09-03 | Navigation is Obsidian-native: `minAppVersion` 1.13.0, `getSettingDefinitions()` returns page/group entries, each page is an imperative `SettingPage` mounting one React page; `display()` and the React tab shell are deleted. Supersedes the earlier draft's React-owned four-tab + scrollable sub-nav design. | The draft's search fallback ("route the best-matching alias") is impossible: `render` never receives the query, so page routing requires per-page Obsidian items. Native pages give sub-page navigation, back button, keyboard navigation, and search routing with zero custom nav code, and remove the sub-nav scroll/fade/drag/roving-focus/memory surface entirely. 1.13 has been public since 2026-07-30; owner accepted dropping 1.12. | WS-02 |
| 2026-09-03 | Root layout order: page Models (no group heading); group Agent → Built-in tools · Web tools · MCP servers · Skills · Prompt; group Editor → Commands · Toolbar; group General → page Environment, then the General content as one `render` item. | Most-used destinations sit one click from the top; General's long content does not bury the entries; a "Models" heading over a single "Models" entry is redundant. Confirmed by owner. | WS-02, WS-03 |
| 2026-09-03 | Page inventory: Subagents (3 rows) becomes a section of Built-in tools; About (3 rows) stays at the end of General; Environment (entry list + bulk import) is a page. Ten `SettingsPageId`s. | Obsidian sub-page guidance: two or three settings stay on the parent; `spawn_agent` is a built-in tool. Confirmed by owner. | WS-02, WS-03, WS-04 |
| 2026-09-03 | Pages are imperative React mounts (`page: () => new PiviSettingsPage(id)`), one shared `SettingsPorts`; no declarative `items` / `SettingDefinitionList` inside pages. | MCP editor, provider OAuth flows, and prompt module editors are stateful React trees; splitting them across dozens of `render` callbacks would duplicate state in two systems. Page-level search granularity is sufficient. Confirmed by owner. | WS-02 |
| 2026-09-03 | Search aliases: each page entry's `aliases` are the localized labels of every row on that page; the former flat `SETTINGS_SEARCH_KEYS` list is partitioned by page in `SETTINGS_PAGES`. `desc` is a one-line localized page description. | Obsidian indexes page entries by name/desc/aliases; this is the only way a search for "bash" opens Built-in tools. | WS-02 |
| 2026-09-03 | Pages are declarative `SettingDefinitionPage`s whose `items` hold exactly one `SettingDefinitionRender` (`name`, `desc`, `aliases`, `render` mounting the React page); no `page: () => SettingPage` factory and no `PiviSettingsPage` subclass. | Verified in the live app through `app.setting.searchIndex`: `SettingDefinitionPage` has no `aliases` in the 1.13 types and Obsidian does not index a page's own aliases; imperative `page` factories contribute zero search entries. Only definition items inside a page are indexed (with `pagePath`), so a single render item per page is the documented way to get page-level search routing. It also removes a class and its lifecycle races. | WS-02 |
| 2026-09-03 | Sections mirror Obsidian 1.13 native `.setting-group`s: a heading outside (interface font, native heading size/weight, hairline below, native gap) and a surfaced rounded body (`--pivi-host-setting-items-background`) holding flat rows separated by hairlines. Metrics are read from the live app's computed styles and set once in `system/tokens.css`. Supersedes the earlier "no surfaced section bodies" decision. | Screenshots of the WS-02 build inside the native settings window (2026-09-03) show every neighbor—core settings, page entries, list items—as heading + surfaced group. Flat rows on the primary background would be the foreign element; "Obsidian-native" now means matching the 1.13 group idiom. Coordinator decision pending owner confirmation at Checkpoint 1; reversible in `system/` CSS only. | WS-01 (CSS), WS-03–WS-05 |
| 2026-09-03 | Collection items render as disclosure rows inside the section surface (header row + inline body, hairline separators, no per-item border, radius, or background), matching how 1.13 renders `SettingDefinitionList` items. `DisclosureCard` keeps its API and class root; only `system/card.css` changes. Supersedes "cards are the only surfaced element". | White bordered cards inside a grey native surface read as nested surfaces (visible on the WS-02 Models page). One surface per section is the native idiom. Pending owner confirmation at Checkpoint 1. | WS-01 (CSS), WS-03–WS-05 |
| 2026-09-03 | The host neutralizes Obsidian's implicit group surface around every Pivi render item: `render` tags the enclosing `.setting-items` and `.setting-group-search` elements with a Pivi reset class (product CSS targets only that class). The General content becomes a root-level render item placed after the General group, so that group keeps only the Environment entry with its native surface. | Every Pivi render item is wrapped by an implicit `.setting-group > .setting-items` surface; without the reset, React sections would nest surfaces. Keeping General content inside the General group would either nest or strip the Environment entry's surface. | WS-03 (host), WS-02 tests |
| 2026-09-03 | React section headings must not inherit the vault theme's heading font; `system/layout.css` sets the interface font family and native heading metrics explicitly. | WS-02 screenshot shows "Layout" / "Chat behavior" in the theme's serif heading font while native headings use the interface font. | WS-03 |
| 2026-09-03 | Checkpoint 1 owner feedback (on the not-yet-migrated Web tools page): (a) buttons keep their pre-048 appearance — compact transparent icon buttons and compact text buttons, never Obsidian's default filled button chrome (`button:not(.clickable-icon)` must be out-specified inside `.pivi-settings`); (b) an open or focused disclosure row shows no emphasized outline/border around the row — only a subtle `:focus-visible` ring on the toggle button itself; (c) no text touches a surface edge: card bodies, inline editors, hints, and feedback all sit inside the row gutter. General/Environment/Models direction otherwise accepted; remaining polish folds into WS-04. | Owner review of the WS-03 build. Rules live in `system/card.css` / `system/controls.css` so every page inherits them. | WS-04, WS-05 |
| 2026-09-03 | Hard primitive contract. Pages compose only the seven primitives plus `primitives/controls/`. Feature CSS may not set spacing, radius, or borders; `color` / `background*` must be a single `var(--pivi-settings-*)` or `var(--pivi-host-*)` token; a Jest contract test enforces the CSS and raw-class rules. | Guidelines alone did not prevent the divergence. Banning properties outright would force an allowlist for the Prompt usage bar and provider logo slots; constraining values to tokens expresses the real intent ("values are set in one place") and lets the allowlist stay empty. Confirmed by owner. | WS-01, WS-06 |
| 2026-09-03 | Collection items are `DisclosureCard` only when they have an editable body; items with nothing to edit are flat `SettingRow`s with `SettingsInlineActions`. `SettingsCollection` accepts both. | A chevron that opens only metadata adds a click and is less Obsidian-native than a row whose description carries the metadata. "One idiom per situation" still holds and the contract test enforces both. Confirmed by owner. | WS-01, WS-03–WS-05 |
| 2026-09-03 | Visual direction is Obsidian-native: page uses host primary background; sections are quiet muted labels with a hairline divider and flat rows separated by dividers; no rounded surfaced section body. Cards exist only as `DisclosureCard`. | Settings live inside Obsidian's settings window; mirroring core reduces visual noise and the token surface. | WS-01 |
| 2026-09-03 | WS-01 swaps the row/section/control/feedback layer in place: `controls.tsx` exports become the new primitives (same import names) so every existing page renders through the system immediately; only card idioms and page wrappers stay legacy until WS-03–WS-05. Legacy CSS files stay until WS-06. | Grow in layers on a product that keeps working: Checkpoint 1 previews the row system on every page, and no intermediate commit leaves pages unstyled. | WS-01 |
| 2026-09-03 | The uncommitted working-tree edits present at scoping time (18 tracked files toward surfaced cards) were reviewed and discarded with owner authorization. Baseline for this spec is commit `7dcbf2a2`. | The edits pushed further toward surfaced cards, which the Obsidian-native decision removes; the one reusable idea (section-owned header actions) is part of the `SettingsSection` primitive. | WS-01 |
| 2026-09-03 | Big-bang delivery on one branch (`feat/settings-native-navigation`), two human checkpoints: **Checkpoint 1** after WS-03 (primitives, native navigation, General/Environment/Models) locks the visual direction before the remaining pages migrate; **Checkpoint 2** after WS-06 is the full matrix. Nothing merges to `main` before Checkpoint 2. | Two coexisting idioms in an incremental rollout would be more inconsistent than today; an early checkpoint bounds rework if the primitives need adjustment. Confirmed by owner. | All |
| 2026-09-03 | Workstreams run sequentially in one working tree (WS-01 → WS-02 → WS-03 → CP1 → WS-04 → WS-05 → WS-06 → CP2). Each workstream adds its own locale keys in all ten catalogs in its own commit. | Parallel subagents in one tree race on locale JSON, `index.ts`, and `SettingsRoot`; the i18n same-commit rule needs each workstream to own its keys. | All |
| 2026-09-03 | `DisclosureCard` header actions (toggle, remove, drag handle) keep the compact glyph-sized hover emphasis contract. | Textbook hit-box enlargement previously produced oversized emphasis blocks (Coding Standards #11). | WS-01, CP1/CP2 |
| 2026-09-03 | Spec 046's pending Prompt-tab visual sign-off is closed as superseded by this spec; 046 and 047 archived 2026-09-03. | Signing off pre-048 visuals has no lasting value. Confirmed by owner. | — |

## Design

### Host navigation (`src/app/ui/`)

```ts
// packages/pivi-react/src/settings/navigation.ts
export type SettingsPageId =
  | 'general' | 'environment' | 'models'
  | 'builtInTools' | 'webTools' | 'mcpServers' | 'skills' | 'prompt'
  | 'commands' | 'toolbar';
export interface SettingsPageDescriptor {
  readonly id: SettingsPageId;
  readonly labelKey: TranslationKey;        // settings.pages.<id>.label
  readonly descriptionKey: TranslationKey;  // settings.pages.<id>.description
  readonly aliasKeys: readonly TranslationKey[]; // labels of every row on the page
}
export const SETTINGS_PAGES: Readonly<Record<SettingsPageId, SettingsPageDescriptor>>;
export type SettingsRootEntry =
  | { kind: 'page'; page: SettingsPageId }
  | { kind: 'group'; labelKey: TranslationKey; items: readonly ({ kind: 'page'; page: SettingsPageId } | { kind: 'content'; page: 'general' })[] };
export const SETTINGS_ROOT_LAYOUT: readonly SettingsRootEntry[]; // models; agent[...]; editor[...]; general[environment]; content general
```

- `PiviSettingTabHost.getSettingDefinitions()` maps `SETTINGS_ROOT_LAYOUT` to `SettingDefinitionItem[]`: `{ kind: 'page' }` → `{ type: 'page', name, desc, items: [renderItem] }`; `{ kind: 'group' }` → `{ type: 'group', heading, items }`; `{ kind: 'content' }` → the same `renderItem` used inside pages. `renderItem` is `{ name, desc, aliases, render: (setting) => mount into setting.settingEl }` with the `.pivi-settings-definition-host` reset. Search entries come from that item (`pagePath` is empty for General content and one page name for the nine pages). It must be cheap: labels come from the in-memory translator only. Locale changes call `update()` as today. There is no `page:` factory and no `SettingPage` subclass.
- The host tracks live surfaces in a `Set` and disposes them on plugin unload because render cleanup is not guaranteed on window destroy. A per-page generation guard drops a late mount that resolves after cleanup ran.
- `mountSettingsPage({ page, ports, container, i18n, platform, ownerDocument, ownerWindow, portalContainer }): Promise<MountedSurface>` replaces `mountSettings`. `SettingsRoot` becomes a page switch over `SettingsPageId`.

### Primitives (`packages/pivi-react/src/settings/primitives/`)

| Primitive | Class root | Responsibility |
|---|---|---|
| `SettingsPage` | `pivi-settings-page` | Page root, optional intro copy, vertical rhythm. Replaces `pivi-tools-settings-page`, `SettingsPageDescription`. |
| `SettingsSection` | `pivi-settings-section` | Quiet heading (h2/h3), optional header actions slot, hairline divider, children. Absorbs `SettingsListHeader`, `SettingsSectionHeading`. |
| `SettingRow` | `pivi-settings-row` | Name/description + control slot; flat with divider; `stacked` variant for full-width editors; optional `actions` slot for flat collection items. Existing labelled-by wiring retained. |
| `SettingsCollection` | `pivi-settings-collection` | Ordered list of `DisclosureCard`s or flat `SettingRow`s, empty state, trailing add trigger, optional `useSortableReorder` integration, live-region announcements. Replaces `pivi-sp-list`, `pivi-providers-list`, `pivi-sp-empty-state`. |
| `DisclosureCard` | `pivi-settings-card` | Header: leading icon, name, summary, meta badges, `SettingsInlineActions`, chevron; body: children; controlled `open`/`onToggle`; header pointer drag when sortable; buttons isolated from disclosure/drag. Replaces provider/MCP/web/toolbar/prompt/sp cards. |
| `SettingsInlineActions` | `pivi-settings-actions` | Isolated action cluster (Toggle, remove, drag handle) for card headers, section headers, and flat rows. Renamed from `SettingsItemActions`. |
| `SettingsFeedback` | `pivi-settings-feedback` | Compact success/pending/error text beside its action. Renamed from `SettingsActionFeedback`. |

Controls (`Toggle`, `Select`, `BadgeListInput`, `SettingsRemoveButton`, `.pivi-settings-control` inputs) move to `primitives/controls/` unchanged in behavior. During WS-01–WS-05 `controls.tsx` re-exports the primitives under the old names; WS-06 deletes it and pages import `primitives/` directly.

### CSS layout

```
styles/settings/system/tokens.css     # --pivi-settings-* spacing/radius/surface tokens (only place values are set)
styles/settings/system/host.css       # .pivi-settings-definition-host reset, page root on host background
styles/settings/system/layout.css     # page, section heading, divider rhythm
styles/settings/system/row.css        # SettingRow variants
styles/settings/system/controls.css   # form controls, badge list, range, select
styles/settings/system/card.css       # DisclosureCard, collection list, empty state, sortable feedback
styles/settings/system/feedback.css   # inline feedback colors
styles/settings/features/models.css   # model checklist grid, provider logo slot (structure only)
styles/settings/features/commands.css # icon grid, mention editor host (structure only)
styles/settings/features/mcp.css      # inventory table + inline editor structure
styles/settings/features/prompt.css   # usage stacked bar structure
styles/settings/features/toolbar.css  # picker grouping structure
```

Deleted in WS-06: `settings/base.css`, `provider-settings.css`, `command-editor.css`, `slash-settings.css`, `mcp-settings.css`, `prompt-settings.css`, `agent-settings.css`. `modals/mcp-modal.css` keeps only the modal. `base/presentation-primitives.css` loses its `.pivi-setting-row` rules in WS-01 (or they move to `system/row.css` if still needed by non-settings surfaces; WS-01 verifies which surfaces use them).

### i18n

Add `settings.groups.{agent,editor,general}`, `settings.pages.<id>.{label,description}` for the ten page ids, and any flat-row metadata labels needed by WS-03–WS-05. Remove `settings.tabs.*`. Mirror all ten locales in the same commit as the code that uses them.

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status. Implementation agents are Grok 4.6 High subagents; the coordinator plans, reviews, and verifies.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | `settings/primitives/` (seven primitives + `controls/`), `styles/settings/system/*.css`, `manifest.mjs` update, `controls.tsx` re-exports so every page renders rows/sections/controls/feedback through the system, `.pivi-setting-row` rules removed from `base/presentation-primitives.css` (or justified), `tests/unit/ui/settingsStyleContract.test.ts` (feature-CSS rules, token-only declaration rule, raw-class ban with a `legacyAllowlist` of the card classes still pending migration, allowlist JSON), jsdom `SettingsPrimitives.test.tsx` (DisclosureCard toggle/remove/drag isolation, controlled open, SettingsCollection empty/add/sortable, flat-row actions) | Grok 4.6 High (WS-01) | Done | None (baseline `7dcbf2a2` + archived 046/047) | `npm run test -- tests/unit/ui tests/jsdom/pivi-react`; `npm run build:css`; `npm run typecheck && npm run lint` |
| WS-02 | `navigation.ts` (`SettingsPageId`, `SETTINGS_PAGES`, `SETTINGS_ROOT_LAYOUT`), `mountSettingsPage`, `SettingsRoot` page switch routing existing components (Built-in tools page temporarily renders `BuiltInToolsSection` + `SubagentsSettingsTab`), delete `SettingsShell.tsx` and `SettingsTabId`, `PiviSettingsPage`, `PiviSettingTabHost.getSettingDefinitions()` root layout, delete `display()`, unload disposal, `manifest.json` `minAppVersion` 1.13.0, `searchMetadata.ts` → per-page aliases, obsidian mock `SettingPage`, i18n groups/pages keys (all locales) and `settings.tabs.*` removal | Grok 4.6 High (WS-02) | Done | WS-01 | `npm run test -- tests/jsdom/app-ui tests/jsdom/pivi-react tests/unit/ui`; `npm run check:boundaries`; `npm run check:i18n-dead-keys`; `npm run build && obsidian plugin:reload id=pivi && obsidian dev:errors` |
| WS-03 | General content (Language, Layout, Chat behavior, Provider requests, Session files, Personalization, Input shortcuts with hotkey grid as a section of rows, Style Settings integration, About) on primitives; Environment page (stacked rows); Models page: providers as `DisclosureCard`s in a sortable `SettingsCollection`, Add provider picker as trailing add trigger, model checklist under `features/models.css` | Grok 4.6 High (WS-03) | Done | WS-02 | `SettingsUi.test.tsx` updated; provider sorting tests green; raw-class allowlist shrinks (provider card removed) |
| CP1 | **Checkpoint 1 human visual sign-off**: root tab layout, Environment, Models, DisclosureCard states, row/section rhythm, light + dark | Human (shuuul) | Done (direction accepted with three primitive-level corrections; see Decisions "Checkpoint 1 owner feedback") | WS-03 | Owner confirms direction or requests primitive adjustments before WS-04 |
| WS-04 | Agent pages: Built-in tools (tool groups as sections + Subagents section), Web tools (sortable provider cards), MCP servers (cards with inline editor body, inventory table in `features/mcp.css`, `mcp-modal.css` reduced to the modal), Skills (default bundle + remote source rows; remote and installed skills as flat rows with inline actions), Prompt (usage section with `features/prompt.css` bar, workflow modules as cards with toggle/editor/modified/restore, custom modules collection with add trigger) | Grok 4.6 High (WS-04) | Done | CP1 | `ToolsSettingsPage`, `McpToolsSection`, `PromptTab`, `SettingsUi` (skills) tests updated; allowlist shrinks (mcp/web/sp/prompt cards removed) |
| WS-05 | Editor pages: Commands (internal commands as flat rows; workspace commands as cards with mention editor body; icon grid in `features/commands.css`), Toolbar (required actions and curated editor commands as flat rows; removable/configurable items as cards; pickers in `features/toolbar.css`) | Grok 4.6 High (WS-05) | Done | WS-04 | `CommandsTab.test.tsx`, `EditorToolbarSection.test.tsx` updated; allowlist empty |
| WS-06 | Delete `controls.tsx` re-exports, `SettingsListHeader`, `SettingsPageDescription`, `SettingsSectionHeading`, legacy CSS files and dead selectors; contract test at final strictness (empty allowlists, deleted-selector assertions); i18n dead-key sweep; documentation sync per section below; full gate run | Grok 4.6 High (WS-06) | Done | WS-05 | `rg` for deleted selectors returns nothing; `node scripts/check-i18n-dead-keys.mjs`; full gate command |
| CP2 | **Checkpoint 2 human visual sign-off matrix** (see Verification) | Human (shuuul) | Pending | WS-06 | Owner marks each surface; agent must not self-attest |

## Verification

Automated (run from repo root):

```bash
npm run typecheck
npm run lint
npm run check:boundaries
npm run build:css
npm run test -- tests/unit/ui/settingsStyleContract.test.ts
npm run test -- tests/jsdom/pivi-react
npm run test -- tests/jsdom/app-ui
npm run test:coverage
npm run build && npm run check:bundle-size
node scripts/check-i18n-dead-keys.mjs
npm run check:specs
obsidian plugin:reload id=pivi && obsidian dev:errors
```

Contract test requirements (`settingsStyleContract.test.ts`):

- Parses every file under `styles/settings/features/` and fails on any declaration of `margin*`, `padding*`, `gap`, `row-gap`, `column-gap`, `border-radius`, `border`, `border-*` shorthands, or `border*-color`, and on any `color` / `background*` value that is not exactly `var(--pivi-settings-<name>)` or `var(--pivi-host-<name>)`, unless the exact `file:selector:property` triple is listed in `settingsStyleContract.allowlist.json` (reviewed; target empty).
- Fails if any file other than `system/tokens.css` declares a `--pivi-settings-*` custom property.
- Fails if any `*.tsx` under `packages/pivi-react/src/settings/` outside `primitives/` contains a `className` string starting with one of the primitive class roots or a legacy card class, except entries in the in-test `legacyAllowlist` (WS-01 seeds it with the pending card classes; WS-06 empties it).
- Final state (WS-06): fails if `styles/` contains `.pivi-sp-`, `.pivi-provider-card`, `.pivi-mcp-card`, `.pivi-web-provider-`, `.pivi-tools-settings-page`, `.pivi-settings-tabs`, `.pivi-settings-tab`, or `--pivi-host-setting-items-background`; fails if `packages/pivi-react/src/settings/` contains `SettingsShell`, `SettingsTabId`, `SettingsListHeader`, `SettingsPageDescription`, or `SettingsSectionHeading`.

jsdom / unit behavior:

- `PiviSettingTabHost.getSettingDefinitions()` returns the exact root order and types; every page entry has non-empty `name`, `desc`, `aliases`; each former search key is owned by exactly one page; locale change triggers `update()`; `PiviSettingsPage.display()` mounts and `hide()` disposes; unload disposes live surfaces; no `display` method on the tab.
- `DisclosureCard`: toggle and remove clicks do not change `open`; drag handle keyboard sorting works; header click toggles; `SettingsCollection` renders empty state, add trigger, flat rows with actions.
- Each page renders under `mountSettingsPage({ page })` with its sections in the documented order.

Human visual sign-off (owner only, light and dark themes, settings window at ~480 px and ~720 px content widths, after `npm run build && obsidian plugin:reload id=pivi`):

**Checkpoint 1 (after WS-03)**

| Surface | States to inspect |
|---|---|
| Root tab | Models entry, Agent / Editor / General group headings, Environment entry, General content beneath; entry hover/focus; Obsidian keyboard navigation between entries |
| General content | section heading/divider rhythm, row dividers, control alignment, hotkey grid as rows, About at the end |
| Environment page | titlebar + back, stacked textarea layout |
| Models page | provider `DisclosureCard` collapsed, hover, open, dragging, disabled toggle; toggle/remove hover emphasis glyph-sized; add trigger |
| Search | typing a General row label or "provider" opens the right destination |

**Checkpoint 2 (after WS-06)**: Checkpoint 1 surfaces plus every Agent and Editor page (cards and flat rows), MCP inline editor inside the card body, Prompt usage bar, Skills flat rows with inline actions, Toolbar pickers, Commands mention editor; `obsidian dev:errors` clean.

Performance/bundle: no new dependency; `check:bundle-size` must stay within the existing ceiling.

## Documentation sync

- Numbered developer docs: `docs/08-presentation-and-settings.md` (Settings data flow: native page navigation, `PiviSettingsPage`, `mountSettingsPage`, page inventory, alias ownership, primitives; replace the "eight/nine primary tabs" paragraphs; Styling section for the `system/` vs `features/` split); `docs/10-roadmap-release-and-maintenance.md` (minimum Obsidian 1.13 note for the 0.24.0 release).
- Nearest local guidance: `packages/pivi-react/AGENTS.md` (replace the tablist/no-drag rule, the eight-tab rule, section/list-header rules, and every card-idiom rule with the primitive contract and page inventory); `packages/pivi-react/styles/AGENTS.md` (directory layout, settings conventions, gotchas referencing deleted files, manifest count).
- Parent/package guidance: `src/app/AGENTS.md` (`PiviSettingTabHost` root layout, `PiviSettingsPage` lifecycle, unload disposal); `packages/pivi-react/src/i18n/AGENTS.md` only if catalog workflow changes (expected `None`); `tests/AGENTS.md` if the contract test introduces a new category (expected `None`).
- Root guidance: `AGENTS.md` "Minimum Obsidian" → 1.13.0; Architecture Status "Settings search compatibility" bullet rewritten for native pages; README minimum-version text if present.

## Progress and handoff

Append entries rather than rewriting another agent's record.

### 2026-09-03 — shuuul / Droid — scoping

- Changed: Spec created after a scoping interview; React-owned grouped tabs + scrollable sub-nav design recorded. Superseded working-tree edits discarded with owner authorization; tree clean at `7dcbf2a2`.
- Evidence: `SettingsShell.tsx` (8 flat tabs), `controls.tsx`, `styles/settings/*.css` line counts; post-revert focused tests 78 passed.
- Remaining: All workstreams pending.
- Blockers: Multi-item `getSettingDefinitions()` behavior unverified.
- Next action: WS-01.

### 2026-09-03 — Cursor (Claude) — re-grill and redesign

- Changed: Reviewed 046/047/048 with the owner. Verified against `obsidian.d.ts` 1.13.1 that `render` receives no query (draft's alias-routing fallback impossible) and that `SettingDefinitionPage` + `SettingPage` provide native sub-page navigation. Owner decisions: archive 046/047 on functional evidence (Prompt-tab sign-off superseded; 047 timeout scenario downgraded to unit fixture + logs); adopt native pages with `minAppVersion` 1.13.0 (Path A); root layout Models → Agent group → Editor group → General group (Environment page + General content); Subagents folds into Built-in tools, About stays in General, Environment is a page; imperative React page mounts with one shared `SettingsPorts`; cards only for items with editable bodies, flat rows otherwise; feature CSS bans spacing/radius/border and constrains color/background to tokens; drop `rowId` deep links and navigation memory; two human checkpoints; release as 0.24.0. Spec rewritten accordingly and set Active.
- Evidence: `node_modules/obsidian/obsidian.d.ts` lines 6079–6260 (`SettingDefinitionGroup`, `SettingDefinitionPage`), 6461–6508 (`SettingPage`), 6265–6284 (`SettingDefinitionRender`); Obsidian 1.13 public changelog 2026-07-30; explore-agent inventory of `packages/pivi-react/src/settings/` (35 files / 7,574 lines) and `styles/settings/` (2,334 lines).
- Remaining: WS-01 → WS-06 with CP1/CP2.
- Blockers: None.
- Next action: Create branch `feat/settings-native-navigation`; dispatch WS-01 to a Grok 4.6 High subagent.

### 2026-09-03 — Grok 4.6 High — WS-01

- Changed: Added `settings/primitives/` (seven primitives + `controls/`) and `styles/settings/system/*.css`. `controls.tsx` now re-exports the primitives (plus thin `SettingsListHeader` / `SettingsPageDescription` / `SettingsSectionHeading` adapters). Existing pages render rows, sections, controls, and feedback through the new system; card idioms stay legacy. `--pivi-settings-*` tokens live only in `tokens.css`. Section bodies are no longer surfaced. `.pivi-setting-row*` left `presentation-primitives.css` (no chat / inline-edit / modal consumers). Contract + jsdom primitive tests added; `settingsStyles.test.ts` replaced. Coordinator review: DisclosureCard header is a plain drag surface; a sibling toggle button owns `aria-expanded`/`aria-controls`; `useSortableReorder` skips nested interactives unless they opt in with `data-sortable-surface`.
- Evidence:
  - `npm run build:css` — pass
  - `npm run typecheck` — pass
  - `npm run lint` — pass
  - `npm run test -- tests/unit/ui tests/jsdom/pivi-react` — 36 suites, 361 tests passed
  - `npm run check:boundaries` — pass
  - `npm run build` — pass
  - `obsidian plugin:reload id=pivi && obsidian dev:errors` — `No errors captured.`
- Remaining: WS-02–WS-06. Visual sign-off is Checkpoint 1 (owner only). `legacyAllowlist` still contains `pivi-sp-`, `pivi-provider-card`, `pivi-mcp-card`, `pivi-web-provider-`.
- Blockers: None.
- Next action: WS-02 (native page navigation).

### 2026-09-03 — Grok 4.6 High — WS-02

- Changed: Moved Pivi settings onto Obsidian 1.13 native pages. React now exports `SETTINGS_ROOT_LAYOUT` / ten `SettingsPageId`s and mounts one page through `mountSettingsPage`. Environment left General; Tools split into three pages; Subagents temporarily rides Built-in tools. Host `PiviSettingTabHost` maps the root layout with no `display()` fallback; `PiviSettingsPage` owns mount/hide/unload disposal. `minAppVersion` is `1.13.0` in `manifest.json` only (`versions.json` left for release sync). Search aliases are per-page. `settings.tabs.*` removed from all ten locales.
- Evidence:
  - `node_modules/obsidian/obsidian.d.ts` 1.13.1: `SettingDefinitionPage` has no `aliases` (name/desc are indexed; aliases added via `IndexedSettingPage` intersection). `SettingTab.display()` is a deprecated concrete method, not abstract; not called when `getSettingDefinitions()` is non-empty.
  - `npm run typecheck` — pass
  - `npm run lint` — pass
  - `npm run check:boundaries` — pass (includes `check:i18n-dead-keys`: 996 catalog keys, 1005 referenced)
  - `npm run test -- tests/jsdom/app-ui tests/jsdom/pivi-react tests/unit/ui tests/unit/architecture` — 51 suites, 547 tests passed
  - `node scripts/check-i18n-dead-keys.mjs` — pass
  - `npm run build` — pass
  - `obsidian plugin:reload id=pivi && obsidian dev:errors` — `No errors captured.`
  - `obsidian command id=app:open-settings && obsidian dev:errors` — `Executed: app:open-settings`; `No errors captured.`
- Remaining: WS-03–WS-06. Page restyle, Subagents-as-section, tab-CSS deletion, and full handbook sync are later workstreams. Do not self-attest visual quality (CP1).
- Blockers: None.
- Next action: WS-03 (General / Environment / Models on primitives).
- Follow-up: Coordinator review found page-level `aliases` and imperative `page: () => SettingPage` factories are not indexed. Pages are now declarative `{ type: 'page', name, desc, items: [renderItem] }`; `PiviSettingsPage` and `IndexedSettingPage` are deleted. Search entries come from the render item.

### 2026-09-03 — Grok 4.6 High — WS-03

- Changed: Host tags Obsidian's implicit single-item `.setting-items` / `.setting-group-search` wrapper with `pivi-settings-host-surface-reset`. `SETTINGS_ROOT_LAYOUT` is now `[page models, group agent, group editor, group general [page environment], content general]`. System CSS now mirrors the 1.13 group idiom (interface-font heading + hairline + one surfaced body; disclosure rows inside that surface). General, Environment, and Models render through the primitives. Models providers are a sortable `SettingsCollection` of `DisclosureCard`s; checklist/logo structure lives in `settings/features/models.css`. No new i18n keys.
- Evidence:
  - Measured native 1.13 metrics (Pivi root + Appearance, 2026-09-03): heading Inter/system 15px / weight 500 / `#141413` / padding `0 16px` / margin `0 0 16px` / hairline `~0.66px solid #e8e6dc`; heading name 15px / 500; surface `#f0eee4` / radius `10px` / padding `0`; rows padding `20px` / no row border / gap `12px`; name 13px / 400 / `#141413` / lh `16.25px`; desc 12px / `#504e49` / lh `15px` / padding-top `4px`; control gap `8px` / flex `1 1 auto`; group margin-top `24px`; `--setting-items-background #f0eee4`; `--radius-l 10px`; `--radius-m 5px`; `--font-ui-medium 15px`; `--font-ui-small 13px`.
  - Tokens written from those numbers: section-gap `24px`, heading-size `--pivi-host-font-ui-medium`, heading-weight `--pivi-host-font-medium`, title-gap `16px`, gutter `16px`, row padding `20px`, row-gap `12px`, control-gap `8px`, description-gap `4px`, surface `var(--pivi-host-setting-items-background)` / `--pivi-host-radius-l`.
  - `npm run build:css` — pass
  - `npm run typecheck` — pass
  - `npm run lint` — pass
  - `npm run check:boundaries` — pass
  - `npm run test -- tests/unit/ui tests/jsdom/pivi-react tests/jsdom/app-ui tests/unit/scripts` — 63 suites, 506 passed
  - `node scripts/check-i18n-dead-keys.mjs` — pass (996 catalog / 1005 referenced)
  - `npm run build && obsidian plugin:reload id=pivi && obsidian command id=app:open-settings && obsidian dev:errors` — `No errors captured.`
  - Screenshots written for Checkpoint 1 (owner only; not a visual sign-off): `/tmp/ws03-root.png`, `/tmp/ws03-environment.png`, `/tmp/ws03-models.png` (MetaCube open).
- Remaining: WS-04–WS-06. `legacyAllowlist` is still `pivi-sp-`, `pivi-provider-card`, `pivi-mcp-card`, `pivi-web-provider-` — Models no longer emits `pivi-provider-card`, but Web / Prompt / Commands / Toolbar still do, so the allowlist cannot shrink until those pages migrate. Environment rows have no per-entry remove (Apply-gated import; no remove port). Subagents still temporarily rides Built-in tools. Visual sign-off is Checkpoint 1 (owner only).
- Blockers: None.
- Next action: Checkpoint 1 human visual sign-off, then WS-04.
- Coordinator review follow-up (same day): Nested `SettingsSection` / `DisclosureCard` body now emit `pivi-settings-section--nested` via `SettingsNestingContext` (no consumer prop). Card header order is icon · name · badges · actions · chevron; `.pivi-settings-actions` computed `background: rgba(0,0,0,0)`, `border: 0`, `border-radius: 0`. Environment omits the repeating section title; bulk import is a stacked row (textarea full width, Apply below). Gutter: heading `getBoundingClientRect().left` **386.5346374511719** equals row name **386.5346374511719** (`--pivi-settings-gutter` is now `20px` and row padding-inline aliases it). Fetch models sits in the Model IDs `SettingRow`; candidate models are nested-section rows. Re-ran gates: 63 suites / 509 passed; `dev:errors` none. Screenshots overwritten at the same three `/tmp/ws03-*.png` paths. Not a visual sign-off.

### 2026-09-03 — Grok 4.6 High — WS-04

- Changed: Part A primitive polish plus Agent-page migration. `mountSettingsPage` now emits `pivi-settings` on the React root so `system/controls.css` can beat Obsidian `button:not(.clickable-icon)`. Compact transparent icon/text buttons, no open-card outline, card-body gutter, quiet status chips. Built-in tools groups + inlined Subagents (`SubagentsSettingsTab` deleted). Web tools and Prompt custom/workflow modules are sortable `SettingsCollection`s of `DisclosureCard`s. MCP cards use an inline `SettingRow` editor + `features/mcp.css` inventory; add dialog stays in `mcp-modal.css`. Skills are flat `SettingRow`s with `SettingsInlineActions` + per-row `SettingsFeedback`. Prompt usage bar structure in `features/prompt.css`. New `settings.subagents.heading` in all ten locales.
- Evidence:
  - Part A computed styles on Web tools (Exa open), after `pivi-settings` root: remove/save `background-color: rgba(0, 0, 0, 0)`, `border: 0px none`, `box-shadow: none`, `padding: 4px 10px`; drag handle `background-color: rgba(0, 0, 0, 0)`, `border: 0px none`, `box-shadow: none`, `padding: 0px`, `width/height: 28px`. Open card `outline-style: none`, `box-shadow: none`. Card body padding `20px` (`--pivi-settings-gutter`).
  - `npm run build:css` — pass
  - `npm run typecheck` — pass
  - `npm run lint` — pass
  - `npm run check:boundaries` — pass (`check:i18n-dead-keys`: 997 catalog keys, 1006 referenced)
  - `npm run test -- tests/unit/ui tests/jsdom/pivi-react tests/jsdom/app-ui tests/unit/scripts` — 63 suites, 509 passed
  - `node scripts/check-i18n-dead-keys.mjs` — pass
  - `npm run build && obsidian plugin:reload id=pivi && obsidian command id=app:open-settings` — pass
  - `obsidian dev:errors` — Pivi-owned errors none; captured `NotAllowedError` traces are `plugin:advanced-canvas` / `plugin:obsidian-style-settings` sharing constructed stylesheets into the settings popout
  - Screenshots (owner visual sign-off only): `/tmp/ws04-builtin.png`, `/tmp/ws04-web.png` (Exa open), `/tmp/ws04-mcp.png` (deepwiki open), `/tmp/ws04-skills.png`, `/tmp/ws04-prompt.png` (module open), `/tmp/ws04-web-dark.png`
- Remaining: WS-05 (Commands + Toolbar still emit `pivi-sp-` and `pivi-provider-card`; `legacyAllowlist` is `['pivi-sp-', 'pivi-provider-card']`). WS-06 deletes leftover CSS files (`base.css` / `provider-settings.css` / `slash-settings.css` / `mcp-settings.css` / `prompt-settings.css` / `agent-settings.css`) and `controls.tsx` adapters. Human visual sign-off is still Checkpoint 1/2 (owner only).
- Blockers: None.
- Next action: WS-05 Editor pages (Commands, Toolbar).
- Coordinator review follow-up (same day): Stacked-row 280px flex-basis no longer becomes input height. `.pivi-settings-row--stacked` control cluster is a wrapping row; inputs `flex: 1 1 auto` at ~32px; action buttons `flex: 0 0 auto` on the same line. Host chrome neutralization is only `.pivi-settings-action-btn` / `.pivi-settings-text-btn` (plus card toggle/handle/chevron). Save / Apply / Connect / List skills / Update official skills use the host default. MCP card summary is `N tools · <url>` (no bare URL in the body). `+ Add provider` / `+ Add MCP` / `+ Add module` stay `.pivi-settings-text-btn`.
  - Computed (settings popout): Web Exa API key `height: 31.99px`, `flex: 1 1 auto`, parent `flex-direction: row` / `align-items: center`. MCP Server name / URL `height: 32.06px`. Skills remote input `height: 32.06px`. Environment textarea `height: 125.83px` (rows=6). Save `background: rgb(250, 249, 245)`, `height: 29.998px` matching `--input-height: 30px`. Apply changes same host fill and height. `+ Add MCP` remains `background: rgba(0, 0, 0, 0)`.
  - Gates re-run: `build:css`, `typecheck`, `lint`, `check:boundaries` pass; Jest 63 suites / 511 passed; i18n dead keys pass; `npm run build` + reload + `app:open-settings` pass. `dev:errors` Pivi-owned none (same third-party `adoptedStyleSheets` traces). Screenshots overwritten at the same `/tmp/ws04-*.png` paths. Not a visual sign-off.

### 2026-09-03 — Grok 4.6 High — WS-05

- Changed: Migrated Commands and Toolbar onto the primitives. Internal commands are flat `SettingRow`s; workspace commands are a sortable `SettingsCollection` of `DisclosureCard`s (draft never sorts; `+ Add command` is the collection trigger; Save collapses). Toolbar enablement is the first row; required Pivi actions and curated editor commands are flat sortable rows; host commands and Pivi Commands are cards (icon picker in the host header; execution target in the Pivi Command body). Icon-grid / mention-editor structure lives in `features/commands.css`; picker grouping in `features/toolbar.css`. Emptied `slash-settings.css` / `command-editor.css`. `legacyAllowlist` is `[]`. Built-in tools heading uses new `workspaceNameTitle` (`"{workspaceNameTitle} tools"`). `SettingsCollection` empty-state uses `Children.toArray` so a `null` draft sibling does not hide the empty copy. `DisclosureCard` skips an empty body so a host-command card does not open a blank padded hole.
- Evidence:
  - `npm run build:css` — pass
  - `npm run typecheck` — pass
  - `npm run lint` — pass
  - `npm run check:boundaries` — pass (`check:i18n-dead-keys`: 997 catalog keys, 1006 referenced)
  - `npm run test -- tests/unit/ui tests/jsdom/pivi-react tests/jsdom/app-ui tests/unit/scripts` — 63 suites, 511 passed
  - `node scripts/check-i18n-dead-keys.mjs` — pass
  - `npm run build && obsidian plugin:reload id=pivi && obsidian command id=app:open-settings` — pass
  - `obsidian dev:errors` — Pivi-owned errors none; captured `NotAllowedError` traces are `plugin:advanced-canvas` / `plugin:obsidian-style-settings` sharing constructed stylesheets into the settings popout
  - Screenshots (owner visual sign-off only): `/tmp/ws05-commands.png` (`/polish` open), `/tmp/ws05-commands-draft.png` (`+ Add command`), `/tmp/ws05-toolbar.png` (host command Add alias open, empty body omitted), `/tmp/ws05-builtin.png` (heading `Vault tools`)
- Remaining: WS-06 deletes leftover CSS files (`base.css` / `provider-settings.css` / emptied `slash-settings.css` / `command-editor.css` / `mcp-settings.css` / `prompt-settings.css` / `agent-settings.css`) and `controls.tsx` adapters / `SettingsListHeader`. Human visual sign-off is still Checkpoint 1/2 (owner only).
- Blockers: None.
- Next action: WS-06 cleanup (delete leftover files, empty allowlists at final strictness, handbook sync).
- Coordinator review (same day): Commands Save is a nameless trailing `SettingRow` (no duplicate “Save” label; Cancel sits on that line for drafts). Host toolbar commands are flat sortable `SettingRow`s like curated editor commands (icon picker in the row, “Obsidian command” description, toggle/remove/handle, no chevron). Pivi Commands stay `DisclosureCard`s. Screenshots overwritten at `/tmp/ws05-commands.png` and `/tmp/ws05-toolbar.png`. Gates re-run: `build:css`, `typecheck`, `lint`, `check:boundaries` pass; Jest 63 suites / 511 passed; i18n dead keys pass (997/1006); `npm run build` + reload + `app:open-settings` pass; `dev:errors` Pivi-owned none. Not a visual sign-off.

### 2026-09-03 — Grok 4.6 High — WS-06

- Changed: Deleted `controls.tsx` and leftover settings CSS (`base.css`, `provider-settings.css`, `command-editor.css`, `slash-settings.css`, `mcp-settings.css`, `prompt-settings.css`, `agent-settings.css`). Pages import `./primitives`. Inlined `SettingsPageDescription` / `SettingsSectionHeading`; `SettingsListHeader` gone. Live leftover rules moved into `system/controls.css` / `system/row.css`. Contract test is at final strictness (empty allowlists; deleted files/selectors/components asserted gone; feature CSS has no spacing/radius/border/shadow; `--pivi-settings-*` declared only in `tokens.css`; no `controls` adapter imports; structural `<h2>/<h3>/<ul>/<table>` allowed only with an explicit reason). Web provider display names are i18n keys and Web tools search aliases (`Brave Search`, `Tavily`, `Exa`, `AnySearch`). Docs/CHANGELOG describe the native 1.13 page/group system. `specs/README.md` still lists 048 as active.
- Evidence:
  - `rg` for `.pivi-sp-`, `.pivi-provider-card`, `.pivi-mcp-card`, `.pivi-web-provider-`, `.pivi-tools-settings-page`, `.pivi-settings-list-header`, `.pivi-settings-page-description` in `packages/`, `src/`, `tests/` — no product traces (contract test still names them as forbidden)
  - `node scripts/check-i18n-dead-keys.mjs` — pass (1002 catalog keys, 1011 referenced)
  - `npm run typecheck` — pass
  - `npm run lint` — pass
  - `npm run check:boundaries` — pass
  - `npm run test:coverage` — 349 suites, 3105 passed; All files 74.71% stmts / 63.8% branch / 72.16% funcs / 76.1% lines
  - `npm run build` — pass (`styles.css` minified 173.5 KB)
  - `npm run check:bundle-size` — pass (`main.js` 4,203,804 bytes / 4.01 MB; 0.99 MB below 5 MB cap). Coverage run prints a pre-existing snapshot-baseline warning about 10% growth vs 3,956,976 bytes; production check is the gate.
  - `obsidian plugin:reload id=pivi && obsidian command id=app:open-settings` — pass
  - `obsidian dev:errors` — Pivi-owned errors none; captured `NotAllowedError` traces are `plugin:advanced-canvas` / `plugin:obsidian-style-settings` sharing constructed stylesheets into the settings popout
  - Screenshots (owner visual sign-off only, Checkpoint 2): `/tmp/cp2-root-top.png`, `/tmp/cp2-root-general.png`, `/tmp/cp2-models.png`, `/tmp/cp2-builtin.png`, `/tmp/cp2-web.png`, `/tmp/cp2-mcp.png`, `/tmp/cp2-skills.png`, `/tmp/cp2-prompt.png`, `/tmp/cp2-commands.png`, `/tmp/cp2-toolbar.png`, `/tmp/cp2-environment.png`
  - Search: `app.setting.searchInputEl` is undefined on 1.14; used `app.setting.searchComponent.inputEl.value = 'brave'` + `input` event. Result: Pivi **Web tools** is the first group (`pagePath: ["Web tools"]`, bestScore -0.0112); Keychain `pivi-web-search-brave-api-key` is a second hit. Visible `searchResultsEl` text includes `Web toolsPiviWeb tools` then the keychain entry.
- Remaining: Checkpoint 2 human visual sign-off. Coordinator archives 048 after CP2. Do not commit.
- Blockers: None.
- Next action: Owner Checkpoint 2 matrix (light/dark, every page). Agent must not self-attest visual quality.
- Coordinator review (same day): three CP2 screenshot fixes. Unset hotkey rows now render a host button with localized `settings.hotkeys.notSet` ("Not set") and `settings.hotkeys.openHotkeys` aria-label; `.pivi-hotkey-item*` / `.pivi-hotkey-grid` / `.pivi-hotkey-name` deleted (badge kept for the set case). Stacked `textarea` takes `flex: 1 1 100%` so Apply wraps below and right-aligns; Web tools API-key `<input>` stays `1 1 auto` on the same line as Save/Remove. MCP context-saving chip uses `settings.mcp.mentionBadge` ("Slash mention"). Recaptured `/tmp/cp2-root-general.png`, `/tmp/cp2-environment.png`, `/tmp/cp2-mcp.png`. Focused gates: typecheck/lint/boundaries pass; Jest 63 suites / 514 passed; i18n 1005/1014; `main.js` 4,204,960 bytes (4.01 MB). Not a visual sign-off.

## Completion summary

Complete this section before archiving. Summarize the delivered outcome, deviations from the original scope, verification results, and durable documentation updated. The coordinator then sets `status: Completed`, updates the date, moves the unchanged filename to `archive/`, and moves its index entry in the same change.
