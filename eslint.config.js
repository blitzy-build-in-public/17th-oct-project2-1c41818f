/**
 * Path: eslint.config.js
 * Purpose: Flat ESLint configuration over source, tests and config files, with type-aware TypeScript and hooks rules
 * Lines: 58
 */

import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Source, test and config TypeScript files that type-aware linting applies to. */
const TS_FILES = ["**/*.{ts,tsx}"];

export default tseslint.config(
  // Prettier owns formatting and no stylistic rule is enabled here, so the two cannot disagree.
  { ignores: ["dist/**", "coverage/**", "node_modules/**", "**/*.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({ ...config, files: TS_FILES })),
  // Flat preset: the plain configs["recommended-latest"] carries an eslintrc-shaped plugins array.
  { ...reactHooks.configs.flat["recommended-latest"], files: TS_FILES },
  {
    files: TS_FILES,
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.vitest,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `eslint .` cannot be told to fail on warnings and this configuration must pass with none,
      // so the hooks preset's three advisory rules are errors here instead of warnings.
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/incompatible-library": "error",
      "react-hooks/unsupported-syntax": "error",
      // Underscore-prefixed unused names, which tsconfig.json's noUnusedLocals also exempts.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Outside the TypeScript program, so parsed without one: no typed rule applies to this file.
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
);
