import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./vitest.setup.ts",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      // text-summary prints the one-line totals in CI logs; html/json are for
      // local drill-down. No thresholds yet — measure the baseline before
      // gating, so an unrelated PR isn't blocked by a coverage dip.
      reporter: ["text-summary", "text", "html", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      // Exclude things that aren't unit-testable product logic: tests
      // themselves, type-only files, generated schema, pure-presentation
      // pages/layouts, and thin I/O wrappers that only run against live APIs.
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/__tests__/**",
        "src/**/*.d.ts",
        "src/app/**/layout.tsx",
        "src/app/**/page.tsx",
        "src/lib/db/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
