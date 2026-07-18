*This file extends the package [AGENTS.md](../AGENTS.md). Follow package and root guidance first, then these local rules.*

# Pivi Styles

## Purpose

- `packages/pivi-react/styles/` contains the modular CSS source for Pivi's product React UI.
- These modules style the sidebar chat, rendered messages and tool calls, composer toolbar, context features, modals, settings, and accessibility states.
- The generated root `styles.css` is the release artifact; make source changes here rather than editing `styles.css` directly.

## Build flow

- `manifest.mjs` is the authoritative module inventory and cascade order.
- `scripts/build-css.mjs` prepends `packages/obsidian-host/styles/pivi-theme.css`, then resolves the 37 manifest paths within this directory, concatenates modules in declaration order, and writes root `styles.css`.
- Development output retains module headers and formatting. Production output removes ordinary comments and whitespace while preserving the Style Settings `/* @settings ... */` metadata block.
- Manifest entries must resolve to `.css` files inside this directory.
- Every CSS file below this directory must be listed. Missing entries, missing files, invalid paths, or an empty manifest fail the build.
- Add, remove, or rename a module together with its `manifest.mjs` entry.

## Directory layout

- `base/`: shared custom properties, container utilities, host-neutral presentation primitives, and animations; loaded first after the host theme-token mapping.
- `components/`: core chat structure—header, tabs, messages, markdown, navigation, code, thinking/tool/subagent/status displays, composer input, mentions, and context footer.
- `toolbar/`: model, mode, thinking, and external-context selectors inside the composer toolbar.
- `features/`: feature-specific chat UI, including file/image context, embeds and modals, diffs, slash commands, questions, and todos.
- `modals/`: standalone modal styling, currently MCP configuration.
- `settings/`: settings navigation and shared layout plus slash, MCP, and agent-specific rules. `settings/base.css` owns shared `.pivi-sp-*` structures.
- `accessibility.css`: shared focus-visible behavior; intentionally loaded last.
- `manifest.mjs`: build manifest only; it must not contain CSS rules.

## Conventions

- Prefix plugin-owned classes, custom properties, animations, and highlight names with `pivi-` (`.pivi-*`, `--pivi-*`, `pivi-*`). Strictly Pivi-scoped integration rules may consume upstream Markdown renderer, CodeMirror, or Lucide variables, but must not expose them as Pivi-owned public tokens.
- Scope overrides beneath a Pivi root such as `.pivi-container` or `.pivi-settings` when touching Obsidian elements.
- Components consume `--pivi-host-*` theme tokens and shared `--pivi-*` product tokens. Each note-host maps its theme system into that contract; the Obsidian mapping lives in `packages/obsidian-host/styles/pivi-theme.css`.
- Shared product spacing, radius, elevation, material, motion, surface, typography, focus, and press tokens are declared together for `.pivi-container` and `.pivi-settings`. Keep Style Settings-backed chat and composer typography as separate semantic tokens.
- Transcript flow uses the shared `--pivi-flow-compact`, `--pivi-flow-content`, and `--pivi-flow-section` tokens. Narrative Markdown controls transitions between top-level content blocks while continuing to inherit host typography, color, list markers, list-item geometry, and inline indentation. Ordinary narrative blocks use content flow; headings use section flow before and compact flow after.
- Product CSS targets only package-owned structural classes. Host adapters may normalize rendered third-party markup onto `.pivi-*` classes before package CSS consumes it; do not target host classes such as `setting-item`, `modal-*`, `svg-icon`, or theme-marker classes here.
- Settings form controls share `.pivi-settings-control` for sizing, borders, focus, placeholder, and disabled states. Use `--fill` only for intentional full-width editors; checkbox, toggle, and range controls are excluded. Badge-list fields own wrapping, long-token overflow, and compact per-badge remove buttons in `settings/base.css`.
- Compact control feedback uses `.pivi-settings-action-feedback` beside its owning action: host green for success and host error red for failure. `.pivi-settings-action-group` and `.pivi-settings-control-feedback` provide shared wrapping/layout; feature styles must not recreate page-level result banners.
- Settings page descriptions, row content, section labels, and list-header titles align to `--pivi-settings-gutter`. `SettingsSection` owns asymmetric section spacing (`--pivi-settings-section-gap` before, `--pivi-settings-section-title-gap` after the label); nested subsections inside a section body use `--pivi-settings-subsection-gap`. Section headings reset host `h2`/`h3` margin/padding under `.pivi-settings`. Lists and cards stay full width with internal padding; feature CSS must not introduce one-off row insets. A list header owns the header-to-list gap, so the following list must not add another top margin.
- Native settings selectors must render through the shared React `Select` control and `.pivi-select` primitive. Keep them content-sized with a 100% container cap and the shared height, border, focus, hover, and disabled states; feature CSS must not stretch a selector to fill a row. Custom composer/menu selectors remain separate interaction components.
- Keep selectors aligned with the classes and state modifiers emitted by UI code; common state forms include `.is-*`, `.active`, `.selected`, `.visible`, `.enabled`, and BEM-style `--modifier`.
- Prefer logical properties (`margin-inline-*`, `padding-inline-*`, `inset-block-*`) where directionality matters.
- Keep styles with their owning UI feature: chat primitives in `components/`, toolbar controls in `toolbar/`, optional interactions in `features/`, and settings-only UI in `settings/`.
- Put shared markdown rules in `components/markdown-content.css`; rendered markdown classes may be on the same element, so preserve compound-selector semantics.
- Preserve the `/* @settings ... */` block in `base/variables.css`; external Style Settings integrations depend on it.

## Gotchas

- Cascade order is functional: base tokens must precede consumers, shared components precede feature overrides, settings base precedes specialized settings files, and accessibility overrides come last. Reordering imports can change behavior.
- Reduced-motion, reduced-transparency, and increased-contrast overrides live in the last-loaded `accessibility.css`, where they can override component declarations. Direct reduced-motion press selectors must stay synchronized with `base/presentation-primitives.css`.
- Mention and slash dropups share an interruptible `@starting-style` plus discrete-display transition contract. Update both consumers together; do not restore a shared entry keyframe for these rapidly toggled surfaces.
- A new CSS file that is not listed does not remain silently unused—the build fails until it is added to `manifest.mjs`.
- Do not use `!important`. Keep editable tab titles and inline-diff actions on elements that do not inherit Obsidian's high-specificity input/button rules, and use explicit component state classes instead of relational selectors.
- Do not use `:has`; emit state classes from React or imperative adapters, or rely on local `focus-within` state.
- Toolbar dropdowns rely on coordinated positioning, hover/focus states, and high `z-index` values; changing overflow or stacking contexts in the composer can hide them. `.pivi-input-container` stays above `.pivi-messages-bottom-controls` so model/thinking/external menus cover the tab switcher.
- `.pivi-input-container` has no extra bottom inset (`padding: 0`); the toolbar stays at the sidebar bottom as the input wrapper's last column-flex portal child. Keep dropdown stacking / focus-within rules so menus cover the tab switcher.
- Composer context meter styles live in `components/context-footer.css`; the single non-interactive ring shows total prompt context usage and has no output ring class or inspector styles. Obsidian owns the ring's `data-tooltip`; the stylesheet must not duplicate it with a pseudo-element or add a hover/active shadow.
- Context badges share one box model. Composer-inline badges use an 18px compact-middle height plus the input panel's host background and border so they stay readable without dominating a 14px input line; token kind is carried by the icon rather than a saturated chip fill. Slash skill/tool/MCP icons are intentionally one pixel smaller than file/folder icons to balance their denser visual shapes.
- Slash selector kind icons are vertically centered against each row's complete name/description block rather than aligned only to the first line.
- Slash row descriptions stay within the selector width, while the adjacent detail panel consumes only the measured remaining width inside the owning sidebar/input container and wraps unbroken content.
- MCP provider-style disclosure cards and read-only tool inventory live in `settings/mcp-settings.css`; `modals/mcp-modal.css` styles both the add-server modal and the inline configuration editor shown above each expanded card's refresh action and adjacent shared feedback.
- Shared provider-card drag handles, priorities, transform-only drag feedback, reduced-motion fallback, and screen-reader-only reorder status live in `settings/base.css`; Web and model provider lists use the same sorting chrome.
- Workspace-command visual icon picker, searchable grid, responsive popover, and command-row icon alignment live in `settings/slash-settings.css`; keep icon previews on the injected platform renderer rather than bundling host icons into React.
- Generic tool-call shells are structural disclosure rows, not cards: `.pivi-tool-call` has no static border, border radius, background, or clipping surface in transcript or subagent contexts. The subagent card (`.pivi-subagent-list` with inner `.pivi-subagent-card`) remains the enclosing bordered/background surface for delegated work; expanded tool content may retain its own inline result rule where it communicates hierarchy.
- Tool step-group headers are plain count/name summaries without a decorative list marker. React buttons and imperative subagent `div[role=button]` headers share the same one-line flex contract. The far-right status is a slash-separated, per-status count summary rather than one aggregate label. A step group nested inside a subagent reuses the unboxed outer step-group chrome and outer compact tool-row treatment rather than adding subagent-specific rectangular cards; its expanded tool rows have zero gap and zero margins between rows. Container queries progressively hide secondary summaries when the subagent content area narrows.
- `MessageList` sets `--pivi-expanded-content-max-height` from one third of the actual owner messages viewport and `--pivi-subagent-expanded-max-height` from two thirds. Expanded top-level tool and steps-group wrappers use the one-third maximum; expanded subagent cards use the two-thirds maximum (CSS fallback `min(640px, 66vh)`). Each wrapper keeps `overflow: hidden` while its direct body child owns the one stable scrollbar; the direct header is layout-fixed at the card top with an opaque host background and does not stick to the transcript. Nested wrappers reset to visible overflow and reuse the ancestor scroll body. Inside a subagent content scrollport, the steps title is sticky at `top: 0` and nested tool titles stick at `top: var(--pivi-tool-step-group-sticky-top)`. Top-level steps groups keep the steps title layout-fixed on the card while tools stick at `top: 0` inside the scrolling steps body. At internal scroll end, disclosure state and card height stay unchanged and scroll chaining lets the fixed-height card move with the transcript. Do not move the scrollbar back onto the wrapper, and do not use `vh`, fixed maxima, manual resize, height transitions, or shrink-to-title chaining for these disclosures.
- Never give collapsible step bodies an unconditional `display`; subagent step layout applies flex only to `.pivi-tool-step-group-steps:not(.pivi-hidden)` so the shared `.pivi-hidden` contract remains authoritative.
- Individual subagent cards animate their profile icon and bottom light bar only while running. Terminal states retain the same profile icon in a static form and remove the flowing bar. Reduced-motion mode stops both effects while preserving icon, text, and color semantics.
- Subagent shells use the same 6px outer radius while collapsed and expanded, matching tool windows, with one uniform border and no inline branch line. Their header order is profile icon, stable subagent name, truncated brief description, then trailing status. Header padding, line height, 13px name/summary typography, and the 16px icon slot match tool headers and remain identical while toggling content.
- Some small modules are intentionally shared or placeholders, such as `settings/agent-settings.css`; keep them imported so the manifest remains a complete inventory.
