"use client";

import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export function SiteHeader() {
  const { data: session } = authClient.useSession();
  const buildDate = process.env.NEXT_PUBLIC_BUILD_DATE ?? "dev";

  return (
    <header className="px-6 py-2 flex items-center justify-between border-b text-sm">
      <Link href="/" className="font-bold tracking-tight">
        PRNTD
      </Link>
      <div className="flex items-center gap-4">
        {session ? (
          <>
            <Link
              href="/designs"
              className="text-xs text-text-muted hover:text-foreground transition-colors"
            >
              My Designs
            </Link>
            <Link
              href="/orders"
              className="text-xs text-text-muted hover:text-foreground transition-colors"
            >
              Orders
            </Link>
            <button
              onClick={() =>
                authClient.signOut().then(() => {
                  window.location.href = "/";
                })
              }
              className="text-xs text-text-faint hover:text-text-muted transition-colors"
            >
              Sign out
            </button>
          </>
        ) : (
          <Link
            href="/sign-in"
            className="text-xs text-text-muted hover:text-foreground transition-colors"
          >
            Sign in
          </Link>
        )}
        <span className="text-xs text-gray-400 font-mono">{buildDate}</span>
      </div>
    </header>
  );
}
