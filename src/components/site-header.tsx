"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { isCurrentSection } from "@/lib/nav";
import { useHydrated } from "@/components/use-hydrated";
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
  // The session is used only once hydrated (React #418, 2026-09-25). The
  // server has no session here, so it always renders the header signed out.
  // better-auth's store starts its /get-session fetch from inside the first
  // hydration render, and a hydration pass that restarts after that fetch
  // lands would read a signed-in session — dropping the "Sign in" link the
  // server sent and failing hydration. Gated, the hydration render always
  // matches the server; the signed-in shape appears right after hydration
  // commits, or when the fetch lands, whichever is later.
  const { data: liveSession } = authClient.useSession();
  const hydrated = useHydrated();
  const session = hydrated ? liveSession : null;
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
  // nav model A, Studio shows to everyone (see the comment on primaryLinks
  // below); isAuthed only governs sign-in state and the account-only links.
  const isAuthed =
    Boolean(session) &&
    !(session?.user as { isAnonymous?: boolean } | undefined)?.isAnonymous;

  // Nav model A (docs/ux-design-review-2026-09.md), as revised 2026-09-27:
  // three verbs in the bar — Studio, My Designs, Shop — plus Cart and an
  // account menu, at every width. Studio is where you make; My Designs is
  // everything you have made; Shop is where you buy; Cart is funnel-critical
  // so it never goes behind a tap. Everything about *you* — Orders, Admin,
  // Feedback, which account this is, the build, signing out — is one tap
  // into the menu.
  //
  // My Designs moved back into the bar (2026-09-27): it used to be the
  // Studio's own Library tab, reached three taps deep on a phone
  // (hamburger → Studio → Library). Organizer storefronts are retired
  // (#191), so there is no Dashboard entry.
  //
  // Studio shows to everyone. A guest-funnel session gets its own Studio
  // (#241, while GUEST_FUNNEL_ENABLED is on) with a line offering sign-up and
  // sign-in; a visitor with no session at all is sent to /sign-in by the proxy,
  // which is the honest answer to "where do I make one" — the alternative is
  // hiding the product's main verb from everyone who has not signed up.
  const primaryLinks: NavLink[] = [
    { href: "/studio", label: "Studio" },
    { href: "/designs", label: "My Designs" },
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

        {/* Full pill from sm: up, where it fits beside four bar items and the
            wordmark. On a phone, four items plus the wordmark already fill a
            360px bar, so there is no room for a fifth element here — the
            Studio link itself carries the phone signal instead (the dot
            just below). */}
        {runningJobs > 0 && (
          <Link
            href="/studio"
            className="hidden sm:inline-flex ml-3 mr-auto rounded-full border border-border px-2 py-0.5 text-xs text-text-muted hover:text-foreground transition-colors"
            data-testid="running-jobs-badge"
          >
            {runningJobs === 1 ? "1 generating" : `${runningJobs} generating`}
          </Link>
        )}

        {/* Geist 14px widths: wordmark 47px, Studio 41, My Designs 75, Shop
            33, "Cart (12)" 53, hamburger 44 (–8 via -mr-2). At 360px there
            are 328px inside the gutters; gap-4 needs ~349px, gap-3 ~333px,
            gap-2 ~317px (plan: docs/superpowers/plans/2026-09-27-my-designs-nav.md).
            Below 360px the same five items with zero gap still need ~285px,
            which overflows a 320px phone's 288px by only ~3px with gap-2's
            8px×4 gaps removed — gap-2 alone overflows 344px by ~5px and
            320px by ~29px, so the gap collapses to zero rather than a
            smaller-but-nonzero value in that band. */}
        <div className="flex items-center gap-2 max-[359px]:gap-0 sm:gap-4">
          {/* The three verbs, in the bar at every width now (My Designs used
              to live only in the Studio's own Library tab). Each gets a real
              44px tap target below sm:. Current-section styling is shared
              with Cart just below. */}
          {primaryLinks.map((l) => {
            const current = isCurrentSection(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={current ? "page" : undefined}
                className={`flex items-center min-h-11 sm:min-h-0 text-sm transition-colors ${
                  current
                    ? "text-foreground underline underline-offset-[3px]"
                    : "text-text-muted hover:text-foreground"
                }`}
              >
                {l.href === "/studio" && runningJobs > 0 ? (
                  <span className="relative">
                    {l.label}
                    {/* Phone-only stand-in for the full badge above: a 6px
                        ink dot (not rose — rose stays on the wordmark and
                        Generate, Paper "One Mark") that adds no layout width,
                        plus the count for anyone using a screen reader. */}
                    <span
                      aria-hidden
                      data-testid="running-jobs-dot"
                      className="sm:hidden absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-foreground"
                    />
                    <span className="sr-only sm:hidden">
                      , {runningJobs === 1 ? "1 generating" : `${runningJobs} generating`}
                    </span>
                  </span>
                ) : (
                  l.label
                )}
              </Link>
            );
          })}

          {/* Cart never moves into the menu: it is the funnel, and a count
              behind a tap is a count nobody sees. min-h-11 gives it a real
              44px tap target on phones, where the bar is now the only place
              Cart appears at all — relaxed back to an inline row at sm:,
              where the target-size rule doesn't bind the same way. */}
          {showCart && (
            <Link
              href="/cart"
              aria-current={isCurrentSection(pathname, "/cart") ? "page" : undefined}
              className={`flex items-center min-h-11 sm:min-h-0 text-sm transition-colors ${
                isCurrentSection(pathname, "/cart")
                  ? "text-foreground underline underline-offset-[3px]"
                  : "text-text-muted hover:text-foreground"
              }`}
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
          every breakpoint; it holds only account-scoped items now, since the
          three primary verbs live in the bar at every width. */}
      {menuOpen && (
        <div
          ref={menuRef}
          data-testid="header-menu"
          className="absolute right-2 top-full z-50 mt-1 w-64 max-w-[calc(100vw-1rem)] flex flex-col rounded-md border border-border bg-surface-raised py-1"
        >
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
