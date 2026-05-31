"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

type NavLink = { href: string; label: string };

export function SiteHeader() {
  const { data: session } = authClient.useSession();
  const buildDate = process.env.NEXT_PUBLIC_BUILD_DATE ?? "dev";
  const [menuOpen, setMenuOpen] = useState(false);

  // Fresh Prints (the community storefront) leads for everyone — it's the
  // open buy-existing flow. The design-your-own + personal links are
  // auth-gated.
  const links: NavLink[] = session
    ? [
        { href: "/prints", label: "Fresh Prints" },
        { href: "/design", label: "New Design" },
        { href: "/designs", label: "My Designs" },
        { href: "/orders", label: "Orders" },
      ]
    : [{ href: "/prints", label: "Fresh Prints" }];

  function signOut() {
    authClient.signOut().then(() => {
      window.location.href = "/";
    });
  }

  return (
    <header className="px-4 sm:px-6 py-2 border-b text-sm relative">
      <div className="flex items-center justify-between">
        <Link href="/" className="font-bold tracking-tight">
          PRNTD
        </Link>

        {/* Desktop nav */}
        <div className="hidden sm:flex items-center gap-4">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-xs text-text-muted hover:text-foreground transition-colors"
            >
              {l.label}
            </Link>
          ))}
          {session ? (
            <button
              onClick={signOut}
              className="text-xs text-text-faint hover:text-text-muted transition-colors"
            >
              Sign out
            </button>
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

        {/* Mobile: hamburger */}
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Menu"
          aria-expanded={menuOpen}
          className="sm:hidden flex flex-col gap-1 p-2 -mr-2"
        >
          <span className="block w-5 h-0.5 bg-foreground" />
          <span className="block w-5 h-0.5 bg-foreground" />
          <span className="block w-5 h-0.5 bg-foreground" />
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="sm:hidden mt-2 flex flex-col gap-1 border-t pt-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMenuOpen(false)}
              className="py-2 text-text-muted hover:text-foreground transition-colors"
            >
              {l.label}
            </Link>
          ))}
          {session ? (
            <button
              onClick={signOut}
              className="py-2 text-left text-text-faint hover:text-text-muted transition-colors"
            >
              Sign out
            </button>
          ) : (
            <Link
              href="/sign-in"
              onClick={() => setMenuOpen(false)}
              className="py-2 text-text-muted hover:text-foreground transition-colors"
            >
              Sign in
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
