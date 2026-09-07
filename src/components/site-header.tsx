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
}: {
  /** Resolved server-side (plain env reads, no round trip — #127). */
  cartEnabled: boolean;
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

  // Outside-click + Escape dismissal for the account-menu dropdown, present
  // at every breakpoint now (hamburger below sm:, "Account" text at sm: and
  // up). pointerdown so the menu closes before the tap's click lands
  // elsewhere; the trigger button is excluded or its toggle would re-open
  // the menu it just closed. Escape preventDefaults so page-level
  // Escape-to-go-up (Breadcrumbs) skips it.
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

  // Guest-funnel (#26) anonymous sessions don't count as signed-in for the
  // nav: a guest sees "Sign in" rather than "Sign out", and the account
  // menu's Orders/Admin links stay off. This does NOT gate Studio — under
  // nav model A, Studio shows to signed-out visitors too and middleware
  // bounces them to sign-in on click (see the comment on primaryLinks
  // below); isAuthed only governs sign-in state and the account-only links.
  const isAuthed =
    Boolean(session) &&
    !(session?.user as { isAnonymous?: boolean } | undefined)?.isAnonymous;

  // Nav model A (docs/ux-design-review-2026-09.md): two verbs in the bar plus
  // an account menu. Studio is where you make; Shop is where you buy; Cart is
  // funnel-critical so it never goes behind a tap. Everything about *you* —
  // Orders, Admin, Feedback, which account this is, the build, signing out —
  // is one tap into the menu.
  //
  // "My Designs" is gone from the header: it is the Studio's Library tab now
  // (src/components/studio-tabs.tsx). Organizer storefronts are retired
  // (#191), so there is no Dashboard entry.
  //
  // Studio shows signed-out too. It bounces an unauthenticated visitor to
  // /sign-in via middleware, which is the honest answer to "where do I make
  // one" — the alternative is hiding the product's main verb from everyone
  // who has not signed up.
  const primaryLinks: NavLink[] = [
    { href: "/studio", label: "Studio" },
    { href: "/shop", label: "Shop" },
  ];

  // Account-menu links. Cart is deliberately absent — it lives in the bar.
  const accountLinks: NavLink[] = isAuthed
    ? [
        { href: "/orders", label: "Orders" },
        ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
      ]
    : [];

  function signOut() {
    authClient.signOut().then(() => {
      window.location.href = "/";
    });
  }

  return (
    <header className="px-4 sm:px-6 py-2 border-b text-sm relative">
      <div className="flex items-center justify-between" data-testid="header-bar">
        <Link href="/" className="font-bold tracking-tight text-accent-rose">
          PRNTD
        </Link>

        {/* Always in the bar itself, not inside the account menu: a phone
            user who left the Studio mid-generation has to see it without
            opening a menu. Links to the Studio, where a running generation
            renders as a pending cell. */}
        {runningJobs > 0 && (
          <Link
            href="/studio"
            className="ml-3 mr-auto rounded-full border border-border px-2 py-0.5 text-xs text-text-muted hover:text-foreground transition-colors"
            data-testid="running-jobs-badge"
          >
            {runningJobs === 1 ? "1 generating" : `${runningJobs} generating`}
          </Link>
        )}

        <div className="flex items-center gap-4">
          {/* The two verbs: in the bar from sm: up, inside the menu on a
              phone, where there is no room for them beside Cart. */}
          {primaryLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="hidden sm:inline text-sm text-text-muted hover:text-foreground transition-colors"
            >
              {l.label}
            </Link>
          ))}

          {/* Cart never moves into the menu: it is the funnel, and a count
              behind a tap is a count nobody sees. min-h-11 gives it a real
              44px tap target on phones, where the bar is now the only place
              Cart appears at all — relaxed back to an inline row at sm:,
              where the target-size rule doesn't bind the same way. */}
          {showCart && (
            <Link
              href="/cart"
              className="flex items-center min-h-11 sm:min-h-0 text-sm text-text-muted hover:text-foreground transition-colors"
            >
              {cartLabel}
            </Link>
          )}

          {!isAuthed && (
            <Link
              href="/sign-in"
              className="hidden sm:inline text-sm text-text-muted hover:text-foreground transition-colors"
            >
              Sign in
            </Link>
          )}

          {/* min-h-11/min-w-11 give the hamburger a real 44px tap target on
              phones, where this button is now the only way to reach Orders,
              Feedback and Sign out — relaxed at sm:, where the box shrinks
              to fit the "Account" text instead. */}
          <button
            ref={menuButtonRef}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Account menu"
            aria-expanded={menuOpen}
            className="flex items-center justify-center min-h-11 min-w-11 -mr-2 sm:mr-0 sm:min-h-0 sm:min-w-0"
          >
            <span className="hidden sm:inline text-sm text-text-muted hover:text-foreground transition-colors">
              Account
            </span>
            <span className="sm:hidden flex flex-col gap-1" aria-hidden>
              <span className="block w-5 h-0.5 bg-foreground" />
              <span className="block w-5 h-0.5 bg-foreground" />
              <span className="block w-5 h-0.5 bg-foreground" />
            </span>
          </button>
        </div>
      </div>

      {/* The account menu — anchored to the right edge under its trigger,
          solid raised panel so it reads over page content. Same panel at
          every breakpoint; the two primary verbs appear inside it only on
          phones, where the bar has no room for them. */}
      {menuOpen && (
        <div
          ref={menuRef}
          data-testid="header-menu"
          className="absolute right-2 top-full z-50 mt-1 w-64 max-w-[calc(100vw-1rem)] flex flex-col rounded-md border border-border bg-surface-raised py-1"
        >
          {primaryLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMenuOpen(false)}
              className="sm:hidden flex min-h-11 items-center justify-end px-4 text-lg text-foreground hover:bg-surface transition-colors"
            >
              {l.label}
            </Link>
          ))}

          {/* Which account is signed in (#126) — with two accounts the only
              other tell is whether Admin shows. */}
          {isAuthed && session?.user?.email && (
            <span className="truncate px-4 pt-2 pb-1 text-right text-xs text-text-faint">
              {session.user.email}
            </span>
          )}

          {accountLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMenuOpen(false)}
              className="flex min-h-11 items-center justify-end px-4 text-lg text-foreground hover:bg-surface transition-colors"
            >
              {l.label}
            </Link>
          ))}

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
            // sm:hidden: the bar already carries its own "Sign in" link from
            // sm: up, so a query for that label must scope to one container.
            <Link
              href="/sign-in"
              onClick={() => setMenuOpen(false)}
              className="sm:hidden flex min-h-11 items-center justify-end px-4 text-lg text-foreground hover:bg-surface transition-colors"
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
