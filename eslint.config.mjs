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
  "obsidianmd/prefer-create-el": "error",
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
  "obsidianmd/settings-tab/prefer-setting-definitions": "error",
};

export default defineConfig([
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "main.js",
      "metafile.json",
      "styles.css",
      ".agents/**",
      ".claude/**",
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
    },
  },
  {
    // Package sources get the same type-safety bar as product source.
    files: ["packages/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
    },
  },
  {
    // Size/complexity limits are errors so pre-existing package debt can be
    // ratcheted through .config/eslint-suppressions.json (bulk suppressions only
    // record errors). Fixing a suppressed violation requires pruning it.
    files: ["src/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    rules: {
      complexity: ["error", { max: 25 }],
      "max-lines": [
        "error",
        { max: 600, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: [
      "src/**/*.{ts,tsx}",
      "packages/pivi-react/src/**/*.{ts,tsx}",
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
