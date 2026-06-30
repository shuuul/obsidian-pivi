import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tseslint from "@typescript-eslint/eslint-plugin";
import jestPlugin from "eslint-plugin-jest";
import noOnlyTests from "eslint-plugin-no-only-tests";
import obsidianmd from "eslint-plugin-obsidianmd";
import { DEFAULT_ACRONYMS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import { defineConfig } from "eslint/config";
import globals from "globals";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const jestRecommended = jestPlugin.configs["flat/recommended"];
const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

const typeCheckedForSrc = tseslint.configs["flat/recommended-type-checked"].map(
  (config) => ({
    ...config,
    files: ["src/**/*.ts"],
  }),
);

const obsidianRules = {
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
  "obsidianmd/settings-tab/no-manual-html-headings": "error",
  "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
  "obsidianmd/ui/sentence-case": [
    "warn",
    {
      ignoreWords: ["Pivi", "Pi", "WSL", "ChatGPT", "Codex", "stdio"],
      brands: [...DEFAULT_BRANDS, "Pivi", "Pi", "OpenAI"],
      acronyms: [
        ...DEFAULT_ACRONYMS,
        "TOML",
        "WSL",
        "MCP",
        "OAuth",
        "SSE",
        "HTTP",
        "API",
        "URL",
        "JSON",
        "CLI",
      ],
      ignoreRegex: ["\\.(?:pi)/"],
      enforceCamelCaseLower: true,
    },
  ],
  "obsidianmd/vault/iterate": "error",
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
          "Pi runtime packages are adapter dependencies. Use src/core ports from app/features/shared/core; only src/pi and tests may import Pi packages directly.",
      },
    ],
  },
];

export default defineConfig([
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "main.js",
      "esbuild.config.mjs",
      "jest.config.js",
    ],
  },
  js.configs.recommended,
  {
    files: ["esbuild.config.mjs", "scripts/**/*.js", "scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        module: "readonly",
        process: "readonly",
        __dirname: "readonly",
        require: "readonly",
      },
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  ...typeCheckedForSrc,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir,
      },
      globals: {
        activeDocument: "readonly",
        activeWindow: "readonly",
      },
    },
    plugins: {
      obsidianmd,
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      ...obsidianRules,
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { args: "none", ignoreRestSiblings: true },
      ],
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
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features", "@/features/*"],
              message:
                "Core models and infrastructure must not import UI features.",
            },
            {
              group: ["obsidian", "obsidian/*"],
              message:
                "Core must stay host-neutral. Define a core port and implement Obsidian access in src/app or src/pi.",
            },
            {
              group: [
                "@modelcontextprotocol/sdk",
                "@modelcontextprotocol/sdk/*",
              ],
              message:
                "MCP SDK is an adapter dependency. Keep concrete transports in src/pi/mcp and expose core ports/types only.",
            },
            {
              group: ["../main", "../../main", "../../../main", "@/main"],
              message:
                "Core must not depend on the Obsidian plugin class. Use AgentHostContext or another core port.",
            },
            {
              group: [
                "../pi/*",
                "../../pi/*",
                "../../../pi/*",
                "@/pi",
                "@/pi/*",
              ],
              message:
                "Core must not import Pi adapter code. Add or consume a core port instead.",
            },
            ...piPackageBoundaryRule[1].patterns,
          ],
        },
      ],
    },
  },
  {
    files: ["src/app/**/*.ts", "src/features/**/*.ts", "src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": piPackageBoundaryRule,
    },
  },
  {
    files: ["tests/**/*.ts"],
    ...jestRecommended,
    plugins: {
      ...jestRecommended.plugins,
      "no-only-tests": noOnlyTests,
    },
    languageOptions: {
      parser: tsParser,
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      ...jestRecommended.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-only-tests/no-only-tests": [
        "error",
        { functions: ["fit", "fdescribe"] },
      ],
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
]);
