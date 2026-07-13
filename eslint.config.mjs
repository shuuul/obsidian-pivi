import jestPlugin from "eslint-plugin-jest";
import noOnlyTests from "eslint-plugin-no-only-tests";
import obsidianmd from "eslint-plugin-obsidianmd";
import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import { defineConfig } from "eslint/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const jestRecommended = jestPlugin.configs["flat/recommended"];
const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

const piviObsidianRuleOverrides = {
  "obsidianmd/commands/no-command-in-command-id": "error",
  "obsidianmd/commands/no-command-in-command-name": "error",
  "obsidianmd/commands/no-default-hotkeys": "error",
  "obsidianmd/commands/no-plugin-id-in-command-id": "error",
  "obsidianmd/commands/no-plugin-name-in-command-name": "error",
  "obsidianmd/detach-leaves": "error",
  "obsidianmd/editor-drop-paste": "error",
  "obsidianmd/hardcoded-config-path": "error",
  "obsidianmd/no-forbidden-elements": "error",
  "obsidianmd/no-global-this": "error",
  "obsidianmd/no-plugin-as-component": "error",
  "obsidianmd/no-sample-code": "error",
  "obsidianmd/no-static-styles-assignment": "error",
  "obsidianmd/no-tfile-tfolder-cast": "error",
  "obsidianmd/no-unsupported-api": "error",
  "obsidianmd/no-view-references-in-plugin": "error",
  "obsidianmd/object-assign": "error",
  "obsidianmd/platform": "error",
  "obsidianmd/prefer-abstract-input-suggest": "error",
  "obsidianmd/prefer-active-doc": "error",
  "obsidianmd/prefer-file-manager-trash-file": "error",
  "obsidianmd/prefer-get-language": "error",
  "obsidianmd/prefer-instanceof": "error",
  "obsidianmd/prefer-window-timers": "error",
  "obsidianmd/regex-lookbehind": "error",
  "obsidianmd/sample-names": "error",
  "obsidianmd/ui/sentence-case": [
    "warn",
    {
      ignoreWords: ["Pivi", "Pi", "WSL", "ChatGPT", "Codex", "stdio", "OpenAI"],
      ignoreRegex: ["\\.(?:pi)/"],
      enforceCamelCaseLower: true,
    },
  ],
  "obsidianmd/vault/iterate": "error",
  // This custom multi-tab renderer has no declarative equivalent; duplicating it would not index its dynamic controls.
  "obsidianmd/settings-tab/prefer-setting-definitions": "off",
};

const piPackageBoundaryRule = [
  "error",
  {
    patterns: [
      {
        group: [
          "@earendil-works/pi-ai",
          "@earendil-works/pi-ai/*",
          "@earendil-works/pi-agent-core",
          "@earendil-works/pi-agent-core/*",
          "@earendil-works/pi-coding-agent",
          "@earendil-works/pi-coding-agent/*",
        ],
        message:
          "Raw Pi SDK imports belong in @pivi/pivi-agent-core/engine/pi. App and UI code should depend on Pivi-owned package APIs instead.",
      },
    ],
  },
];

const rawPiSdkRestriction = {
  group: ["@earendil-works/*"],
  message:
    "Raw Pi SDK imports belong in @pivi/pivi-agent-core/engine/pi. Depend on Pivi-owned package APIs instead.",
};

const obsidianHostRestriction = {
  group: ["obsidian", "obsidian/*"],
  message:
    "This package must stay Obsidian-host-neutral. Put Obsidian API access behind an Obsidian package boundary.",
};

const electronRestriction = {
  group: ["electron", "electron/*"],
  message:
    "This package must not depend on Electron APIs.",
};

const packageBoundaryRule = (patterns) => [
  "error",
  {
    patterns,
  },
];

export default defineConfig([
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "main.js",
      "metafile.json",
      "styles.css",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.{ts,cts,mts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
      },
    },
  },
  {
    files: ["jest.config.js"],
    languageOptions: {
      sourceType: "commonjs",
    },
  },
  {
    files: ["esbuild.config.mjs", "scripts/**/*.js", "scripts/**/*.mjs", "build/**/*.mjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-console": "off",
      "obsidianmd/rule-custom-message": "off",
    },
  },
  {
    files: ["esbuild.config.mjs", "build/plugins/copy-to-obsidian.mjs"],
    rules: {
      "obsidianmd/hardcoded-config-path": "off",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { args: "none", ignoreRestSiblings: true },
      ],
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    rules: {
      // These paths intentionally create standard DOM nodes from ownerDocument; the Obsidian extension type is not available there.
      "obsidianmd/prefer-create-el": "off",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      ...piviObsidianRuleOverrides,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/no-base-to-string": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      complexity: ["warn", { max: 25 }],
      "max-lines": [
        "warn",
        { max: 600, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: [
      "src/**/*.{ts,tsx}",
      "packages/obsidian-ui/src/**/*.{ts,tsx}",
    ],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": piPackageBoundaryRule,
    },
  },
  {
    files: ["src/app/hostContracts.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": packageBoundaryRule([
        rawPiSdkRestriction,
        {
          group: [
            "@pivi/pivi-agent-core/engine/pi",
            "@pivi/pivi-agent-core/engine/pi/*",
          ],
          message:
            "Host contracts must stay structural and must not name concrete Pi engine implementation types.",
        },
        {
          group: ["@/app/workspace", "@/app/workspace/*"],
          message:
            "Host contracts must not import app workspace implementation modules. Use narrow structural interfaces instead.",
        },
      ]),
    },
  },
  {
    files: ["src/ui/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": packageBoundaryRule([
        rawPiSdkRestriction,
        {
          group: [
            "@pivi/pivi-agent-core/engine/pi",
            "@pivi/pivi-agent-core/engine/pi/*",
          ],
          message:
            "Product UI must not import Pi engine implementations. Use plugin.createChatService(), createAuxQueryRunner(), and getUiFacades() instead.",
        },
        {
          group: ["@/app/workspace", "@/app/workspace/*"],
          message:
            "Product UI must not import app workspace modules. Reach services through PiviPluginHost methods.",
        },
        {
          group: ["@pivi/obsidian-host", "@pivi/obsidian-host/*"],
          message:
            "Product UI must not import @pivi/obsidian-host directly. Use @/app/hostPlatform and host contracts instead.",
        },
        {
          group: ["@pivi/obsidian-tools", "@pivi/obsidian-tools/*"],
          message:
            "Product UI must not import concrete Obsidian tool implementations.",
        },
      ]),
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/app/ui/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": packageBoundaryRule([
        {
          group: [
            "@pivi/obsidian-ui/mount",
            "@pivi/obsidian-ui/mount/*",
          ],
          message:
            "Only src/app/ui may mount @pivi/obsidian-ui surfaces.",
        },
        {
          group: [
            "@pivi/obsidian-ui/ports",
            "@pivi/obsidian-ui/ports/*",
          ],
          allowTypeImports: true,
          message:
            "Only src/app/ui may implement @pivi/obsidian-ui ports. Chat/runtime code may import port types only.",
        },
      ]),
    },
  },
  {
    files: ["src/app/workspace/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": packageBoundaryRule([
        rawPiSdkRestriction,
        {
          group: ["@/ui", "@/ui/*"],
          message:
            "src/app/workspace must not import product UI. Inject UI adapters from the composition root.",
        },
      ]),
    },
  },
  {
    files: [
      "packages/obsidian-tools/src/**/*.{ts,tsx}",
      "packages/obsidian-host/src/**/*.{ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": packageBoundaryRule([rawPiSdkRestriction]),
    },
  },
  {
    files: ["packages/obsidian-ui/src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": packageBoundaryRule([
        rawPiSdkRestriction,
        electronRestriction,
        {
          group: [
            "@pivi/pivi-agent-core/engine/pi",
            "@pivi/pivi-agent-core/engine/pi/*",
          ],
          message:
            "@pivi/obsidian-ui must not import Pi engine implementations. Use host-neutral contracts and display models.",
        },
        {
          group: ["@pivi/obsidian-host", "@pivi/obsidian-host/*"],
          message:
            "@pivi/obsidian-ui must not import concrete host adapters. Receive feature-specific ports from app composition.",
        },
        {
          group: ["@pivi/obsidian-tools", "@pivi/obsidian-tools/*"],
          message:
            "@pivi/obsidian-ui must not import concrete Obsidian tools. Consume host-neutral tool display models.",
        },
        {
          group: ["@", "@/*", "src", "src/*"],
          message:
            "@pivi/obsidian-ui must not import product src code.",
        },
        {
          group: ["node:*", "fs", "fs/*", "path", "path/*"],
          message:
            "@pivi/obsidian-ui must stay renderer-safe and must not depend on Node-only APIs.",
        },
      ]),
    },
  },
  {
    files: ["packages/pivi-agent-core/src/foundation/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": packageBoundaryRule([
        obsidianHostRestriction,
        electronRestriction,
        {
          group: ["node:*", "fs", "fs/*", "path", "path/*"],
          message:
            "Foundation contracts must stay platform-neutral. Move Node filesystem/path access behind an adapter package.",
        },
        rawPiSdkRestriction,
        {
          group: ["@", "@/*", "src", "src/*"],
          message:
            "@pivi/pivi-agent-core/foundation must not import product src code.",
        },
      ]),
    },
  },
  {
    files: ["packages/pivi-agent-core/src/tools/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": packageBoundaryRule([
        obsidianHostRestriction,
        electronRestriction,
        rawPiSdkRestriction,
        {
          group: ["@", "@/*", "src", "src/*"],
          message:
            "@pivi/pivi-agent-core/tools must not import product src code.",
        },
      ]),
    },
  },
  {
    files: ["packages/pivi-agent-core/src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": packageBoundaryRule([
        obsidianHostRestriction,
        electronRestriction,
        {
          group: ["@pivi/obsidian-host", "@pivi/obsidian-host/*"],
          message:
            "@pivi/pivi-agent-core must not depend on concrete host adapters. Inject host ports from the app layer.",
        },
        {
          group: ["@pivi/obsidian-tools", "@pivi/obsidian-tools/*"],
          message:
            "@pivi/pivi-agent-core must not depend on concrete host tools. Inject generic ToolSpec providers.",
        },
        rawPiSdkRestriction,
        {
          group: ["@", "@/*", "src", "src/*"],
          message:
            "@pivi/pivi-agent-core must not import product app or UI code.",
        },
      ]),
    },
  },
  {
    files: ["packages/pivi-agent-core/src/engine/pi/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": packageBoundaryRule([
        obsidianHostRestriction,
        electronRestriction,
        {
          group: ["@pivi/obsidian-host", "@pivi/obsidian-host/*"],
          message:
            "@pivi/pivi-agent-core/engine/pi must not depend on concrete host adapters. Inject host ports from the app layer.",
        },
        {
          group: ["@pivi/obsidian-tools", "@pivi/obsidian-tools/*"],
          message:
            "@pivi/pivi-agent-core/engine/pi must not depend on concrete host tools. Inject generic ToolSpec providers.",
        },
        {
          group: ["@", "@/*", "src", "src/*"],
          message:
            "@pivi/pivi-agent-core/engine/pi must not import product app or UI code.",
        },
      ]),
    },
  },
  {
    files: ["packages/pivi-agent-core/src/session/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": packageBoundaryRule([
        rawPiSdkRestriction,
        {
          group: [
            "@/ui",
            "@/ui/*",
            "src/ui",
            "src/ui/*",
          ],
          message:
            "Session must not depend on plugin UI. Keep session data and compatibility logic UI-neutral.",
        },
      ]),
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    ...jestRecommended,
    plugins: {
      ...jestRecommended.plugins,
      "no-only-tests": noOnlyTests,
    },
    languageOptions: {
      ...jestRecommended.languageOptions,
      globals: {
        ...jestRecommended.languageOptions.globals,
      },
    },
    rules: {
      ...jestRecommended.rules,
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-implied-eval": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/only-throw-error": "off",
      "@typescript-eslint/unbound-method": "off",
      "obsidianmd/no-global-this": "off",
      "obsidianmd/prefer-create-el": "off",
      "obsidianmd/prefer-instanceof": "off",
      "obsidianmd/prefer-window-timers": "off",
      "no-only-tests/no-only-tests": [
        "error",
        { functions: ["fit", "fdescribe"] },
      ],
    },
  },
]);
