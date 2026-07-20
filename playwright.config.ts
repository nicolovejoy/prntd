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
  // Default fan-out everywhere. The local server is a *compiled* build (see
  // webServer below), not `next dev`, so it scales under parallel load the same
  // way the Vercel preview does in CI — no lazy per-route compilation to wedge.
  workers: undefined,
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
        // Compiled build, not `next dev`: precompiling every route up front
        // removes the lazy per-route compilation that wedges a dev server under
        // parallel load and flaked the heaviest spec. Mirrors CI (compiled
        // Vercel preview). Kill any stray `next dev` on 3100 first — with
        // reuseExistingServer it'd be reused instead of building.
        command: "npm run build && npm run start -- -p 3100",
        url: "http://localhost:3100",
        reuseExistingServer: true,
        timeout: 240_000,
        env: {
          GUEST_FUNNEL_ENABLED: "true",
          CART_ENABLED: "true",
          STORES_ENABLED: "true",
          // Compiled build runs as NODE_ENV=production but is served on
          // localhost; let Better-Auth trust the localhost origin so the
          // sign-up/sign-in flow (origin-checked) works. Never set in real prod.
          E2E_TRUST_LOCALHOST: "true",
          // The Stripe money-path spec (e2e:stripe) completes a real test-mode
          // payment, which drives the webhook into Printful submission — force
          // dry-run so a local e2e can never place a real Printful order,
          // whatever .env.local says.
          PRINTFUL_DRY_RUN: "true",
        },
      },
});
