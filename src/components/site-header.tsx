"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { getHeaderState } from "@/components/site-header-actions";
import { FeedbackPanel } from "@/components/feedback-launcher";
import { FEEDBACK_PROJECT_ID } from "@/lib/feedback/project-id";

type NavLink = { href: string; label: string };

export function SiteHeader({
  cartEnabled: showCart,
  storesEnabled: showDashboard,
}: {
  /** Resolved server-side (plain env reads, no round trip — #127). */
  cartEnabled: boolean;
  storesEnabled: boolean;
}) {
  const { data: session } = authClient.useSession();
  const buildDate = process.env.NEXT_PUBLIC_BUILD_DATE ?? "dev";
  const [menuOpen, setMenuOpen] = useState(false);
  // Feedback panel opened from the nav — the entry point on funnel pages,
  // where the floating launcher is hidden (#74).
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const pathname = usePathname();

  // Cart count (#26) — session/DB-dependent, so it still needs a round trip;
  // refetched on navigation so adding an item then moving pages updates it.
  const [cartCount, setCartCount] = useState(0);
  const cartLabel = cartCount > 0 ? `Cart (${cartCount})` : "Cart";

  // Admin nav entry — session/DB-dependent (email vs ADMIN_EMAIL), batched
  // into the same round trip as cart count instead of its own call (#127).
  const [isAdmin, setIsAdmin] = useState(false);

  // Generations running for this user anywhere — the durable job outlives the
  // tab that started it, so the header is where you find out one is still
  // going after navigating away from /design.
  const [runningJobs, setRunningJobs] = useState(0);
  useEffect(() => {
    getHeaderState(showCart)
      .then(({ isAdmin, cartCount, runningJobs }) => {
        setIsAdmin(isAdmin);
        setCartCount(cartCount);
        setRunningJobs(runningJobs);
      })
      .catch(() => {
        setIsAdmin(false);
        setCartCount(0);
        setRunningJobs(0);
      });
  }, [pathname, session?.user?.id, showCart]);

  // Outside-click + Escape dismissal for the mobile dropdown. pointerdown so
  // the menu closes before the tap's click lands elsewhere; the hamburger is
  // excluded or its toggle would re-open the menu it just closed. Escape
  // preventDefaults so page-level Escape-to-go-up (Breadcrumbs) skips it.
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        menuRef.current?.contains(target) ||
        menuButtonRef.current?.contains(target)
      ) {
        return;
      }
      setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // Guest-funnel (#26) anonymous sessions don't count as signed-in for the nav:
  // a guest sees the signed-out nav ("Sign in"), not "Sign out" + the gated
  // personal links (/designs, /orders still redirect anon to sign-in).
  const isAuthed =
    Boolean(session) &&
    !(session?.user as { isAnonymous?: boolean } | undefined)?.isAnonymous;

  // Studio leads for signed-in users — it's where a design session lives and
  // where work resumes. "New Design" is gone: an unanchored Generate in the
  // Studio composer IS new design, so a second door to the same place was
  // just incoherence. Shop (the community storefront, /prints) stays the
  // open buy-existing flow for signed-out visitors.
  const links: NavLink[] = isAuthed
    ? [
        { href: "/studio", label: "Studio" },
        { href: "/designs", label: "My Designs" },
        { href: "/prints", label: "Shop" },
        { href: "/orders", label: "Orders" },
        ...(showDashboard ? [{ href: "/dashboard", label: "Dashboard" }] : []),
        ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
      ]
    : [{ href: "/prints", label: "Shop" }];

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

        {/* Always in the bar itself, not inside the mobile dropdown: a phone
            user who left /design mid-generation has to see it without opening
            a menu. Links to the Studio, where a running generation renders as
            a pending cell. */}
        {runningJobs > 0 && (
          <Link
            href="/studio"
            className="ml-3 mr-auto rounded-full border border-border px-2 py-0.5 text-xs text-text-muted hover:text-foreground transition-colors"
            data-testid="running-jobs-badge"
          >
            {runningJobs === 1
              ? "1 generating"
              : `${runningJobs} generating`}
          </Link>
        )}

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
          {showCart && (
            <Link
              href="/cart"
              className="text-xs text-text-muted hover:text-foreground transition-colors"
            >
              {cartLabel}
            </Link>
          )}
          <button
            onClick={() => setFeedbackOpen(true)}
            className="text-xs text-text-muted hover:text-foreground transition-colors"
          >
            Feedback
          </button>
          {isAuthed ? (
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
          <span className="text-xs text-text-muted font-mono">{buildDate}</span>
        </div>

        {/* Mobile: hamburger */}
        <button
          ref={menuButtonRef}
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

      {/* Mobile dropdown — anchored to the right edge under the hamburger,
          solid raised panel so it reads over page content. */}
      {menuOpen && (
        <div
          ref={menuRef}
          className="sm:hidden absolute right-2 top-full z-50 mt-1 w-64 max-w-[calc(100vw-1rem)] flex flex-col rounded-md border border-border bg-surface-raised py-1 shadow-lg shadow-black/60"
        >
          {/* Which account is signed in (#126) — with two accounts the only
              other tell is whether Admin shows. */}
          {isAuthed && session?.user?.email && (
            <span className="truncate px-4 pt-2 pb-1 text-right text-xs text-text-faint">
              {session.user.email}
            </span>
          )}
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMenuOpen(false)}
              className="flex min-h-11 items-center justify-end px-4 text-lg text-foreground hover:bg-surface transition-colors"
            >
              {l.label}
            </Link>
          ))}
          {showCart && (
            <Link
              href="/cart"
              onClick={() => setMenuOpen(false)}
              className="flex min-h-11 items-center justify-end px-4 text-lg text-foreground hover:bg-surface transition-colors"
            >
              {cartLabel}
            </Link>
          )}
          <button
            onClick={() => {
              setMenuOpen(false);
              setFeedbackOpen(true);
            }}
            className="flex min-h-11 items-center justify-end px-4 text-lg text-foreground hover:bg-surface transition-colors"
          >
            Feedback
          </button>
          {isAuthed ? (
            <button
              onClick={signOut}
              className="flex min-h-11 items-center justify-end px-4 text-lg text-foreground hover:bg-surface transition-colors"
            >
              Sign out
            </button>
          ) : (
            <Link
              href="/sign-in"
              onClick={() => setMenuOpen(false)}
              className="flex min-h-11 items-center justify-end px-4 text-lg text-foreground hover:bg-surface transition-colors"
            >
              Sign in
            </Link>
          )}
          <span className="px-4 pt-2 pb-1 text-right text-[10px] leading-none text-text-faint font-mono">
            {buildDate}
          </span>
        </div>
      )}

      {/* Feedback panel — same card the floating launcher uses, fixed
          bottom-right so it clears the header on phones. */}
      {feedbackOpen && (
        <div
          className="fixed bottom-4 right-4 z-50 w-72 max-w-[calc(100vw-2rem)] print:hidden"
          data-loop-redact=""
        >
          <FeedbackPanel
            projectId={FEEDBACK_PROJECT_ID}
            onClose={() => setFeedbackOpen(false)}
          />
        </div>
      )}
    </header>
  );
}
