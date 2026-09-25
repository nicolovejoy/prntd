/**
 * React #418 on prod (2026-09-25): the header hydrated with a different
 * element than the server sent. The server always renders the header signed
 * out, because `useSession()` has no data there. better-auth's client store
 * starts its `/get-session` fetch from inside the first hydration render
 * (nanostores' `get()` mounts the atom), so a hydration pass that restarts
 * after that fetch lands reads a signed-in session and renders the account
 * button where the server put the "Sign in" link.
 *
 * These tests reproduce that state directly: server-render with no session,
 * then hydrate while `useSession()` already returns a signed-in user.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, createRoot, type Root } from "react-dom/client";
import { SiteHeader } from "../site-header";
import { useHydrated } from "../use-hydrated";

const h = vi.hoisted(() => ({
  session: null as {
    user: { id: string; email?: string; isAnonymous?: boolean };
  } | null,
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/studio" }));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: h.session }),
    signOut: vi.fn(async () => {}),
  },
}));

vi.mock("@/components/site-header-actions", () => ({
  getHeaderState: vi.fn(async () => ({
    isAdmin: false,
    cartCount: 0,
    runningJobs: 0,
  })),
}));

vi.mock("@/components/feedback-launcher", () => ({
  FeedbackPanel: () => null,
}));

const SIGNED_IN = { user: { id: "user-1", email: "maker@example.com" } };

let container: HTMLDivElement;
let root: Root | null;
let recoverable: unknown[];

beforeEach(() => {
  h.session = null;
  recoverable = [];
  root = null;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

/** Server HTML with `serverSession`, then hydrate with `clientSession`. */
async function serverThenHydrate(
  element: React.ReactElement,
  serverSession: typeof h.session,
  clientSession: typeof h.session
) {
  h.session = serverSession;
  container.innerHTML = renderToString(element);
  h.session = clientSession;
  await act(async () => {
    root = hydrateRoot(container, element, {
      onRecoverableError: (error) => recoverable.push(error),
    });
  });
}

function signInLinks() {
  return [...container.querySelectorAll('a[href="/sign-in"]')];
}

describe("SiteHeader hydration", () => {
  it("hydrates without a mismatch when the session store is already signed in", async () => {
    await serverThenHydrate(<SiteHeader cartEnabled />, null, SIGNED_IN);

    expect(recoverable).toEqual([]);
    // Once hydrated, the header switches to the signed-in shape: no
    // "Sign in" link anywhere in the bar.
    expect(signInLinks()).toHaveLength(0);
  });

  it("hydrates without a mismatch when signed out on both sides", async () => {
    await serverThenHydrate(<SiteHeader cartEnabled />, null, null);

    expect(recoverable).toEqual([]);
    expect(signInLinks()).toHaveLength(1);
  });

  it("treats a guest (anonymous) session as signed out, before and after hydration", async () => {
    const guest = { user: { id: "anon-1", isAnonymous: true } };
    await serverThenHydrate(<SiteHeader cartEnabled />, null, guest);

    expect(recoverable).toEqual([]);
    expect(signInLinks()).toHaveLength(1);
  });
});

function HydratedProbe() {
  const hydrated = useHydrated();
  return <span data-hydrated={String(hydrated)}>{String(hydrated)}</span>;
}

describe("useHydrated", () => {
  it("is false in the server render", () => {
    expect(renderToString(<HydratedProbe />)).toContain("false");
  });

  it("hydrates as false without a mismatch, then flips to true", async () => {
    await serverThenHydrate(<HydratedProbe />, null, null);

    expect(recoverable).toEqual([]);
    expect(container.textContent).toBe("true");
  });

  it("is true on a plain client mount (no server HTML)", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<HydratedProbe />);
    });

    expect(container.textContent).toBe("true");
  });
});
