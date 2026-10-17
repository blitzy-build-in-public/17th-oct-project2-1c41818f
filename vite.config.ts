/**
 * Path: vite.config.ts
 * Purpose: Dev server and bundler configuration: the React plugin, the `@` alias and the build target
 * Lines: 25
 */
import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Same key and target as tsconfig.json's `paths`, so an `@/...` import resolves
    // identically for the type checker and for the bundler.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    // Matches tsconfig.json's `target`; `dist` is the ignored build output.
    target: "es2022",
    outDir: "dist",
  },
});
