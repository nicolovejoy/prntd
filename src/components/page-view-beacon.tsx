"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// prompt-lab's page-view endpoint. prntd sends the same three-field body the
// prompt-lab beacon.js script sends, from its own code, so no third-party
// script runs on prntd's pages (Nico, 2026-11-03). prompt-lab derives the site
// from the Origin header. The body is an interface with prompt-lab: change it
// only after telling them on the handoff. Paths carry no ids (/d/<imageId> is
// sent as /d/[id]) and admin pages are not sent at all (Nico, 2026-11-04).
// The first view of each document sends no `event` field, which prompt-lab
// counts as a page load; every later client-side route change adds
// `"event": "nav"`, which prompt-lab counts separately as an in-app view, so
// prntd's page loads stay comparable with sites that count loads only
// (prompt-lab, 2026-11-04; contract: prompt-lab's docs/beacon.md).
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

/** Fire-and-forget. Never throws. `nav` marks a client-side navigation. */
export function sendPageView(path: string, ref: string, nav = false): void {
  try {
    const body = nav
      ? { path, ref, wd: agentFlag(), event: "nav" }
      : { path, ref, wd: agentFlag() };
    const data = JSON.stringify(body);
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
    // Not the document's first route: the document loaded earlier (even on
    // an admin page that was not sent), so this is an in-app navigation.
    const prev = lastPath.current;
    const nav = prev !== null;
    let ref: string;
    if (prev === null) {
      ref = stripToOriginPath(document.referrer);
      if (ref.startsWith(window.location.origin + "/")) {
        const { origin } = window.location;
        ref = origin + beaconPath(ref.slice(origin.length));
      }
    } else {
      ref = window.location.origin + beaconPath(prev);
    }
    lastPath.current = pathname;
    if (isAdminPath(pathname)) return;
    sendPageView(beaconPath(pathname), ref, nav);
  }, [pathname]);

  return null;
}
