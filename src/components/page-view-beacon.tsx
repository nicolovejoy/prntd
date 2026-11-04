"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// prompt-lab's page-view endpoint. prntd sends the same three-field body the
// prompt-lab beacon.js script sends, from its own code, so no third-party
// script runs on prntd's pages (Nico, 2026-11-03). prompt-lab derives the site
// from the Origin header. The body is an interface with prompt-lab: change it
// only after telling them on the handoff. Paths carry no ids (/d/<imageId> is
// sent as /d/[id]) and admin pages are not sent at all (Nico, 2026-11-04).
export const BEACON_URL = "https://prompt-labs.org/api/beacon";

/** The path prompt-lab sees: no ids, and every admin page collapses to /admin. */
export function beaconPath(pathname: string): string {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "/admin";
  return pathname.replace(/^\/d\/[^/]+/, "/d/[id]");
}

function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

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
    let ref: string;
    if (lastPath.current === null) {
      ref = stripToOriginPath(document.referrer);
      if (ref.startsWith(window.location.origin + "/")) {
        const { origin } = window.location;
        ref = origin + beaconPath(ref.slice(origin.length));
      }
    } else {
      ref = window.location.origin + beaconPath(lastPath.current);
    }
    lastPath.current = pathname;
    if (isAdminPath(pathname)) return;
    sendPageView(beaconPath(pathname), ref);
  }, [pathname]);

  return null;
}
