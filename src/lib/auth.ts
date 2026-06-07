import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import * as schema from "./db/schema";
import { sendPasswordResetEmail } from "./email";

// The auth client resolves to same-origin, so requests come from whatever
// host serves the page. Trust this project's Vercel preview hosts
// (prntd-<hash>-<team>.vercel.app) and any prntd.org subdomain so the CSRF
// origin check passes on previews without a per-deploy env var. Scoped to
// `prntd-*` rather than all of `*.vercel.app` so we don't trust every
// deployment on the platform. Production (prntd.org) is covered by baseURL.
const trustedOrigins = ["https://prntd-*.vercel.app", "https://*.prntd.org"];
// In dev the page is served from localhost while baseURL points at prod
// (NEXT_PUBLIC_APP_URL), so the origin check would reject local sign-in and
// auth'd server actions. Trust localhost only in development — never in prod.
if (process.env.NODE_ENV === "development") {
  trustedOrigins.push("http://localhost:3000", "http://localhost:3001");
}

export const auth = betterAuth({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  trustedOrigins,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail({ to: user.email, url });
    },
  },
  plugins: [nextCookies()],
});
