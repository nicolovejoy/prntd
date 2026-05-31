"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Crumb } from "@/lib/nav";

/**
 * Breadcrumb trail + Escape-to-go-up. Phone-first: mobile shows a single
 * "← Parent" back chip (one tap up, 40px target); desktop shows the full
 * trail with the current page as the bold tail. Escape navigates to the
 * immediate parent (deterministic push, not history back) unless focus is
 * in a field or an overlay already consumed the key (defaultPrevented).
 *
 * Renders nothing at the root (no parent to go up to).
 */
export function Breadcrumbs({
  trail,
  current,
  className = "",
}: {
  trail: Crumb[];
  /** Label for the current page — the bold, non-link tail on desktop. */
  current?: string;
  className?: string;
}) {
  const router = useRouter();
  const up = trail.length > 0 ? trail[trail.length - 1] : null;
  const upHref = up?.href ?? null;

  useEffect(() => {
    if (!upHref) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      router.push(upHref!);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [upHref, router]);

  if (!up) return null;

  return (
    <nav aria-label="Breadcrumb" className={className}>
      {/* Mobile: single back chip */}
      <Link
        href={up.href}
        className="sm:hidden inline-flex items-center gap-1 min-h-[40px] text-sm text-text-muted hover:text-foreground transition-colors"
      >
        <span aria-hidden>←</span> {up.label}
      </Link>

      {/* Desktop: full trail */}
      <ol className="hidden sm:flex items-center gap-2 text-sm text-text-muted">
        {trail.map((c) => (
          <li key={c.href} className="flex items-center gap-2">
            <Link href={c.href} className="hover:text-foreground hover:underline transition-colors">
              {c.label}
            </Link>
            <span aria-hidden className="text-text-faint">
              /
            </span>
          </li>
        ))}
        {current && (
          <li aria-current="page" className="text-foreground font-medium">
            {current}
          </li>
        )}
      </ol>
    </nav>
  );
}
