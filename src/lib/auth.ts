import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import * as schema from "./db/schema";
import { sendPasswordResetEmail } from "./email";

export const auth = betterAuth({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  // The auth client resolves to same-origin, so requests come from whatever
  // host serves the page. Trust Vercel preview hosts and any prntd.org
  // subdomain so the CSRF origin check passes on previews without a per-deploy
  // env var. Production (prntd.org) is covered by baseURL above.
  trustedOrigins: ["https://*.vercel.app", "https://*.prntd.org"],
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
