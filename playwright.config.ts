import { config as loadEnv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

// Local runs read DB creds (for the e2e seed helper) from .env.local; CI
// provides DATABASE_URL/DATABASE_AUTH_TOKEN as job env instead. dotenv never
// overrides vars already set in the environment.
loadEnv({ path: ".env.local" });

// Point at a deployed URL (Vercel preview) via E2E_BASE_URL; without it,
// Playwright starts a local dev server with the funnel flags on.
// Local port 3100: 3000 is often held by Docker on this machine.
const remoteURL = process.env.E2E_BASE_URL;
const baseURL = remoteURL ?? "http://localhost:3100";
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  // Against the local `next dev` server (no E2E_BASE_URL), cap parallelism: one
  // dev server cold-compiling routes under many workers wedges and flakes the
  // suite. A compiled Vercel preview (CI) scales fine, so leave it unbounded.
  workers: remoteURL ? undefined : 2,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    // Vercel Deployment Protection: the bypass header gets automation past the
    // 401; set-bypass-cookie carries the bypass across client-side navigation.
    extraHTTPHeaders: bypassSecret
      ? {
          "x-vercel-protection-bypass": bypassSecret,
          "x-vercel-set-bypass-cookie": "true",
        }
      : {},
    trace: "retain-on-failure",
  },
  projects: [
    // Phone-first project: the product principle is mobile wins, so the
    // primary E2E viewport is a phone.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: remoteURL
    ? undefined
    : {
        command: "npm run dev -- -p 3100",
        url: "http://localhost:3100",
        reuseExistingServer: true,
        timeout: 120_000,
        env: {
          GUEST_FUNNEL_ENABLED: "true",
          CART_ENABLED: "true",
          STORES_ENABLED: "true",
        },
      },
});
