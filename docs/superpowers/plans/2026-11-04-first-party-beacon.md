# First-party page-view beacon

Spec: CLAUDE.md "Current state", the "Next (Nico agreed 2026-11-03)" entry. Nico, 2026-11-03: prntd should not run prompt-lab's code; it should send prompt-lab data.

Goal: replace #363's `<Script src="https://prompt-labs.org/beacon.js">` in `src/app/layout.tsx` with a prntd client component that sends the same body to `https://prompt-labs.org/api/beacon` on every route change.

## Global Constraints

- Endpoint exactly `https://prompt-labs.org/api/beacon`. Body is `JSON.stringify({ path, ref, wd })`, sent as `new Blob([data], { type: "text/plain" })` through `navigator.sendBeacon`; when `navigator.sendBeacon` is not a function, `fetch(url, { method: "POST", body: data, mode: "no-cors", keepalive: true })` with its rejection swallowed. Same contract as the live `beacon.js` (read 2026-11-04).
- `path`: `usePathname()`, no query, no hash.
- `ref`: origin + path only (no query, no hash: `/checkout?session=`, `/sign-in?next=` must never leave). First send of a document: `document.referrer` reduced that way (`""` when empty or unparseable). Later sends (client-side navigation): `location.origin` + the previous pathname.
- `wd`: `1` when `navigator.webdriver` is truthy, or the URL query has `pl_agent=1` (then also `localStorage.setItem("pl_agent","1")`), or `localStorage.getItem("pl_agent") === "1"`; else `0`. Each probe in its own try/catch (storage throws in sandboxed frames), matching `beacon.js`.
- Never throws, never renders anything (`return null`).
- One send per distinct pathname change. A re-run of the effect with the same pathname (React Strict Mode in dev) sends nothing.
- No admin skip (counts only, not safety; spec says optional).
- No new dependency, no env var, no copy string.

## Task 1: PageViewBeacon component, mounted in the root layout

Files:
- Create `src/components/page-view-beacon.tsx`
- Create `src/components/__tests__/page-view-beacon.test.tsx`
- Modify `src/app/layout.tsx`: delete the beacon `<Script>` block and its JSX comment, delete `import Script from "next/script";` (nothing else uses it), import `PageViewBeacon` from `@/components/page-view-beacon` and render `<PageViewBeacon />` where the `<Script>` was, with a one-line JSX comment saying it reports page views to prompt-lab from prntd's own code (no third-party script).
- Modify `src/app/__tests__/layout-beacon.test.ts`: replace its assertion with: the comment-stripped layout renders `<PageViewBeacon />` exactly once, contains no `prompt-labs.org/beacon.js`, and does not import `next/script`.

Component (write as given; adjust only if lint or typecheck demands it, and say so in the report):

```tsx
"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// prompt-lab's page-view endpoint. prntd sends the same three-field body the
// prompt-lab beacon.js script sends, from its own code, so no third-party
// script runs on prntd's pages (Nico, 2026-11-03). prompt-lab derives the site
// from the Origin header. The body is an interface with prompt-lab: change it
// only after telling them on the handoff.
export const BEACON_URL = "https://prompt-labs.org/api/beacon";

/** Origin + path of an absolute URL; "" when empty or unparseable. Drops query and hash. */
export function stripToOriginPath(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return "";
  }
}

// Same automation signals as beacon.js: labelled, not dropped.
function agentFlag(): 0 | 1 {
  let agent: 0 | 1 = 0;
  try {
    if (navigator.webdriver) agent = 1;
  } catch {
    // ignore
  }
  try {
    if (/[?&]pl_agent=1(&|$)/.test(window.location.search)) {
      localStorage.setItem("pl_agent", "1");
    }
    if (localStorage.getItem("pl_agent") === "1") agent = 1;
  } catch {
    // storage throws in sandboxed frames and with blocked site data
  }
  return agent;
}

/** Fire-and-forget. Never throws. */
export function sendPageView(path: string, ref: string): void {
  try {
    const data = JSON.stringify({ path, ref, wd: agentFlag() });
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(BEACON_URL, new Blob([data], { type: "text/plain" }));
    } else if (typeof fetch === "function") {
      fetch(BEACON_URL, {
        method: "POST",
        body: data,
        mode: "no-cors",
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // never break the page
  }
}

export function PageViewBeacon() {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || lastPath.current === pathname) return;
    const ref =
      lastPath.current === null
        ? stripToOriginPath(document.referrer)
        : window.location.origin + lastPath.current;
    lastPath.current = pathname;
    sendPageView(pathname, ref);
  }, [pathname]);

  return null;
}
```

Tests (`src/components/__tests__/page-view-beacon.test.tsx`, jsdom, `@testing-library/react`; mock `next/navigation`'s `usePathname` with a mutable value; stub `navigator.sendBeacon` with `vi.fn(() => true)`). jsdom's Blob may lack `text()`/`arrayBuffer()`; read the body through `FileReader` or by stubbing `Blob` with a class that records `parts` and `type`. Restore every stub after each test (`navigator.webdriver`, `document.referrer` via `Object.defineProperty(document, "referrer", { value, configurable: true })`, localStorage cleared). Cases:

1. Mount at `/shop` with referrer `https://www.google.com/search?q=shirts#x`: exactly one `sendBeacon` call, URL `https://prompt-labs.org/api/beacon`, Blob type `text/plain`, body `{"path":"/shop","ref":"https://www.google.com/search","wd":0}`.
2. Empty referrer → `ref` `""`.
3. Rerender with pathname `/cart`: a second call whose body has `path` `/cart` and `ref` equal to `window.location.origin + "/shop"`.
4. Rerender with the same pathname: no additional call.
5. Strict Mode: rendering inside `<React.StrictMode>` at `/shop` sends exactly one call.
6. `navigator.webdriver` true → `wd` 1.
7. `localStorage.pl_agent = "1"` → `wd` 1.
8. `sendBeacon` throws → render does not throw.
9. No `sendBeacon` (set to undefined): `fetch` (stubbed) called once with the beacon URL and `{ method: "POST", mode: "no-cors", keepalive: true }` and the same body; a rejecting fetch produces no unhandled rejection.
10. `stripToOriginPath`: `""` → `""`; `"not a url"` → `""`; `"https://prntd.org/checkout?session=cs_123"` → `"https://prntd.org/checkout"`; `"https://prntd.org/sign-in?next=%2Fcart#top"` → `"https://prntd.org/sign-in"`.

Gate before reporting DONE: `npm run lint` (0 errors), `npm run typecheck`, `npx vitest run src/components/__tests__/page-view-beacon.test.tsx src/app/__tests__/layout-beacon.test.ts`, then `npm test`.
