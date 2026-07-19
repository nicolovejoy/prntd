"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { getCartCount, isCartEnabled } from "@/app/cart/actions";
import { isStoresEnabled } from "@/app/dashboard/actions";
import { isAdminUser } from "@/app/admin/actions";
import { FeedbackPanel } from "@/components/feedback-launcher";
import { FEEDBACK_PROJECT_ID } from "@/lib/feedback/project-id";

type NavLink = { href: string; label: string };

export function SiteHeader() {
  const { data: session } = authClient.useSession();
  const buildDate = process.env.NEXT_PUBLIC_BUILD_DATE ?? "dev";
  const [menuOpen, setMenuOpen] = useState(false);
  // Feedback panel opened from the nav — the entry point on funnel pages,
  // where the floating launcher is hidden (#74).
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const pathname = usePathname();

  // Cart (#26) — behind CART_ENABLED. Open to everyone incl. guests; count
  // refetched on navigation so adding an item then moving pages updates it.
  const [showCart, setShowCart] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  useEffect(() => {
    isCartEnabled().then(setShowCart).catch(() => setShowCart(false));
  }, []);
  useEffect(() => {
    if (!showCart) return;
    getCartCount()
      .then(setCartCount)
      .catch(() => setCartCount(0));
  }, [pathname, session?.user?.id, showCart]);
  const cartLabel = cartCount > 0 ? `Cart (${cartCount})` : "Cart";

  // Organizer Dashboard (pivot Phase 2) — behind STORES_ENABLED.
  const [showDashboard, setShowDashboard] = useState(false);
  useEffect(() => {
    isStoresEnabled().then(setShowDashboard).catch(() => setShowDashboard(false));
  }, []);

  // Admin nav entry — server action returns only a boolean (never the admin
  // email), so ADMIN_EMAIL stays out of the client bundle. Re-checked when the
  // session user changes (sign-in/out).
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    isAdminUser().then(setIsAdmin).catch(() => setIsAdmin(false));
  }, [session?.user?.id]);

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

  // Shop (the community storefront, /prints) leads for everyone — it's the
  // open buy-existing flow. The design-your-own + personal links are
  // auth-gated.
  const links: NavLink[] = isAuthed
    ? [
        { href: "/prints", label: "Shop" },
        { href: "/design", label: "New Design" },
        ...(showDashboard ? [{ href: "/dashboard", label: "Dashboard" }] : []),
        { href: "/designs", label: "My Designs" },
        { href: "/orders", label: "Orders" },
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
