import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // One-off ops scripts; also excluded from tsconfig.
    "scripts/**",
    // Agent worktrees are full second checkouts; without this, a live
    // worktree makes local `npm run lint` walk it and report hundreds of
    // errors unrelated to the working tree. CI is unaffected (fresh clone).
    ".claude/worktrees/**",
  ]),
  // `any` is the canonical idiom for typing mocks. Allow it in tests.
  {
    files: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
