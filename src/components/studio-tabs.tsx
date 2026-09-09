"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The Studio's two views (nav model A, docs/ux-design-review-2026-09.md):
 * the bench you are working on and the library of everything you have made.
 * They were separate top-level destinations; this is the one strip that
 * makes them one place.
 *
 * A third tab, Archive, existed here until 2026-09-09 — dropped as
 * redundant once Library's Active/All filter (#238) already showed every
 * archived image and the image detail page's "Open conversation" already
 * reopened a closed thread. /studio/archive now 308s to /studio/library.
 *
 * Exact-match active state: /studio must not light up while you are on
 * /studio/library, so `startsWith` is wrong here.
 */
const TABS = [
  { href: "/studio", label: "Bench" },
  { href: "/studio/library", label: "Library" },
] as const;

export function StudioTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Studio views"
      className="flex items-center gap-4 border-b border-border"
      data-testid="studio-tabs"
    >
      {TABS.map((tab) => {
        const current = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={`-mb-px min-h-11 flex items-center border-b-2 px-1 text-sm transition-colors ${
              current
                ? "border-foreground text-foreground"
                : "border-transparent text-text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
