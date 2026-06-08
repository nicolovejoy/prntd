import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { anonymous } from "better-auth/plugins/anonymous";
import { eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./db/schema";
import {
  design as designTable,
  order as orderTable,
  cartItem as cartItemTable,
} from "./db/schema";
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
  plugins: [
    // Guest funnel (#26): every signed-out browser gets a real lightweight
    // user row so the design/preview/order surface works without sign-in. The
    // gate moves to checkout. onLinkAccount re-parents the guest's rows to the
    // real account on sign-in/up — it runs BEFORE the plugin deletes the anon
    // user (better-auth 1.5.6 after-hook order), so the FK re-pointing is safe.
    anonymous({
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        const fromId = anonymousUser.user.id;
        const toId = newUser.user.id;
        if (fromId === toId) return;
        // design_image + chat_message follow via design_id. design, order, and
        // the persistent cart re-parent by userId.
        await db
          .update(designTable)
          .set({ userId: toId })
          .where(eq(designTable.userId, fromId));
        await db
          .update(orderTable)
          .set({ userId: toId })
          .where(eq(orderTable.userId, fromId));
        await db
          .update(cartItemTable)
          .set({ userId: toId })
          .where(eq(cartItemTable.userId, fromId));
      },
    }),
    nextCookies(),
  ],
});

/**
 * True for a guest (anonymous-plugin) session. The funnel lets anonymous users
 * design/preview/cart, but the purchase point requires a real account — call
 * this to gate checkout. Tolerates the field being absent (flag off / pre-plugin
 * sessions) by treating it as not-anonymous.
 */
export function isAnonymousUser(
  user: { isAnonymous?: boolean | null } | null | undefined
): boolean {
  return !!user?.isAnonymous;
}
