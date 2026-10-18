/**
 * Path: vitest.config.ts
 * Purpose: Test configuration: the node and jsdom projects, setup file, globals, coverage thresholds and `passWithNoTests`
 * Lines: 75
 */

import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Vitest resolves this file rather than vite.config.ts, so the "@" alias the source tree
  // imports through has to be declared here too, against the same target.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Ambient describe/it/expect in every test file; tsconfig.json supplies their types.
    globals: true,
    // The build's phase gate is `npm test` exiting zero from phase 1, thirty-three phases
    // before the first test file exists: removing this option invalidates it for all of them.
    passWithNoTests: true,
    // The jest-dom matchers plus the between-test state clearing, wanted by both projects.
    // tests/setup.ts arrives in phase 34; Vitest loads a setup file only when it runs test
    // files, so its absence does not fail an otherwise empty run.
    setupFiles: ["tests/setup.ts"],
    // The integration flows mount the whole application and drive real user-event sequences through
    // jsdom, so a case measures two to four seconds on an idle host and more while the other files
    // run; the five-second default failed them for reasons no assertion describes. The ceiling is
    // raised here, once, for both projects, above the 5,149 ms one case measured under deliberate
    // load, so contention cannot decide a run. Only the per-test allowance moves: no assertion, case
    // or skip is relaxed, and a test that genuinely hangs still fails, at the wider limit, not in 5 s.
    testTimeout: 30_000,
    // Pure logic needs no DOM; the jsdom project below overrides this.
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      // The entry shell only mounts the application and no test covers it; declaration files
      // carry no runtime code.
      exclude: ["src/**/*.d.ts", "src/main.tsx"],
      thresholds: {
        statements: 80,
        "src/utils/**": { statements: 85, branches: 80 },
        "src/lib/**": { statements: 85, branches: 80 },
        "src/state/**": { statements: 85, branches: 80 },
      },
    },
    projects: [
      {
        // An inline project inherits the root plugins, setup file, globals and coverage only
        // through `extends`; without it each of them is silently lost.
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["tests/components/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
