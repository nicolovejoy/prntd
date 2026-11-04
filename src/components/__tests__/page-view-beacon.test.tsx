import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

let mockPathname = "/shop";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

import {
  PageViewBeacon,
  stripToOriginPath,
  beaconPath,
  BEACON_URL,
} from "../page-view-beacon";

// Records Blob parts and type so tests do not depend on jsdom's Blob reading.
class RecordingBlob {
  parts: unknown[];
  type: string;
  constructor(parts: unknown[], opts?: { type?: string }) {
    this.parts = parts;
    this.type = opts?.type ?? "";
  }
}

const OriginalBlob = globalThis.Blob;
const origBeacon = Object.getOwnPropertyDescriptor(navigator, "sendBeacon");
const origReferrer = Object.getOwnPropertyDescriptor(document, "referrer");

function setReferrer(value: string) {
  Object.defineProperty(document, "referrer", { value, configurable: true });
}

function bodyOf(call: unknown[]): unknown {
  const blob = call[1] as RecordingBlob;
  return JSON.parse(blob.parts.join(""));
}

let beacon: ReturnType<typeof vi.fn>;

function call(i: number): unknown {
  return bodyOf(beacon.mock.calls[i]);
}

beforeEach(() => {
  mockPathname = "/shop";
  vi.stubGlobal("Blob", RecordingBlob);
  beacon = vi.fn(() => true);
  Object.defineProperty(navigator, "sendBeacon", {
    value: beacon,
    configurable: true,
    writable: true,
  });
  setReferrer("");
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.Blob = OriginalBlob;
  if (origBeacon) Object.defineProperty(navigator, "sendBeacon", origBeacon);
  else delete (navigator as unknown as Record<string, unknown>).sendBeacon;
  if (origReferrer) Object.defineProperty(document, "referrer", origReferrer);
  else delete (document as unknown as Record<string, unknown>).referrer;
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("PageViewBeacon", () => {
  it("sends one beacon on mount with the three-field body", () => {
    setReferrer("https://www.google.com/search?q=shirts#x");
    render(<PageViewBeacon />);
    expect(beacon).toHaveBeenCalledTimes(1);
    const call = beacon.mock.calls[0];
    expect(call[0]).toBe("https://prompt-labs.org/api/beacon");
    expect((call[1] as RecordingBlob).type).toBe("text/plain");
    expect((call[1] as RecordingBlob).parts.join("")).toBe(
      '{"path":"/shop","ref":"https://www.google.com/search","wd":0}',
    );
  });

  it("sends an empty ref when there is no referrer", () => {
    render(<PageViewBeacon />);
    expect(bodyOf(beacon.mock.calls[0])).toEqual({
      path: "/shop",
      ref: "",
      wd: 0,
    });
  });

  it("sends a second beacon on navigation with the previous page as ref", () => {
    const { rerender } = render(<PageViewBeacon />);
    mockPathname = "/cart";
    rerender(<PageViewBeacon />);
    expect(beacon).toHaveBeenCalledTimes(2);
    expect(bodyOf(beacon.mock.calls[1])).toEqual({
      path: "/cart",
      ref: window.location.origin + "/shop",
      wd: 0,
      event: "nav",
    });
  });

  it("marks only client-side navigations as nav; the document load has no event", () => {
    const { rerender } = render(<PageViewBeacon />);
    mockPathname = "/cart";
    rerender(<PageViewBeacon />);
    mockPathname = "/shop";
    rerender(<PageViewBeacon />);
    expect(beacon).toHaveBeenCalledTimes(3);
    expect(bodyOf(beacon.mock.calls[0])).not.toHaveProperty("event");
    expect((call(1) as { event?: string }).event).toBe("nav");
    expect((call(2) as { event?: string }).event).toBe("nav");
    expect((beacon.mock.calls[1][1] as RecordingBlob).parts.join("")).toBe(
      `{"path":"/cart","ref":"${window.location.origin}/shop","wd":0,"event":"nav"}`,
    );
  });

  it("does not send again for the same pathname", () => {
    const { rerender } = render(<PageViewBeacon />);
    rerender(<PageViewBeacon />);
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("sends once under Strict Mode", () => {
    render(
      <React.StrictMode>
        <PageViewBeacon />
      </React.StrictMode>,
    );
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("sets wd to 1 when navigator.webdriver is true", () => {
    Object.defineProperty(navigator, "webdriver", {
      value: true,
      configurable: true,
    });
    try {
      render(<PageViewBeacon />);
      expect((bodyOf(beacon.mock.calls[0]) as { wd: number }).wd).toBe(1);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).webdriver;
    }
  });

  it("sets wd to 1 when localStorage.pl_agent is 1", () => {
    localStorage.setItem("pl_agent", "1");
    render(<PageViewBeacon />);
    expect((bodyOf(beacon.mock.calls[0]) as { wd: number }).wd).toBe(1);
  });

  it("sets wd to 1 and remembers it when the URL has ?pl_agent=1", () => {
    window.history.replaceState({}, "", "/shop?pl_agent=1");
    render(<PageViewBeacon />);
    expect((bodyOf(beacon.mock.calls[0]) as { wd: number }).wd).toBe(1);
    expect(localStorage.getItem("pl_agent")).toBe("1");
  });

  it("does not throw when sendBeacon throws", () => {
    beacon.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => render(<PageViewBeacon />)).not.toThrow();
  });

  it("falls back to fetch without sendBeacon, and swallows a rejection", async () => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const rejected = Promise.reject(new Error("offline"));
    const catchSpy = vi.spyOn(rejected, "catch");
    const fetchMock = vi.fn(() => rejected);
    vi.stubGlobal("fetch", fetchMock);
    render(<PageViewBeacon />);
    await Promise.resolve();
    expect(catchSpy).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(BEACON_URL);
    expect(init).toMatchObject({
      method: "POST",
      mode: "no-cors",
      keepalive: true,
    });
    expect(JSON.parse(init.body as string)).toEqual({
      path: "/shop",
      ref: "",
      wd: 0,
    });
  });

  it("sends nav through the fetch fallback too", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const fetchMock = vi.fn(() => Promise.resolve(new Response()));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<PageViewBeacon />);
    mockPathname = "/cart";
    rerender(<PageViewBeacon />);
    const init = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string)).toMatchObject({
      path: "/cart",
      event: "nav",
    });
  });
});

describe("beaconPath", () => {
  it("drops admin detail and ids", () => {
    expect(beaconPath("/admin")).toBe("/admin");
    expect(beaconPath("/admin/orders/123")).toBe("/admin");
    expect(beaconPath("/administrator")).toBe("/administrator");
    expect(beaconPath("/d/abc123")).toBe("/d/[id]");
    expect(beaconPath("/d/abc123/x")).toBe("/d/[id]/x");
    expect(beaconPath("/design")).toBe("/design");
    expect(beaconPath("/shop")).toBe("/shop");
  });
});

describe("PageViewBeacon privacy", () => {
  it("sends nothing on an admin page", () => {
    mockPathname = "/admin/usage/u1";
    render(<PageViewBeacon />);
    expect(beacon).not.toHaveBeenCalled();
  });

  it("sends /d/[id] for an image page, and again for another image", () => {
    mockPathname = "/d/abc";
    const { rerender } = render(<PageViewBeacon />);
    expect(bodyOf(beacon.mock.calls[0])).toMatchObject({ path: "/d/[id]" });
    mockPathname = "/d/b";
    rerender(<PageViewBeacon />);
    expect(beacon).toHaveBeenCalledTimes(2);
    expect(bodyOf(beacon.mock.calls[1])).toMatchObject({ path: "/d/[id]" });
  });

  it("leaving an admin page sends one view whose ref is /admin", () => {
    mockPathname = "/admin/orders/9";
    const { rerender } = render(<PageViewBeacon />);
    mockPathname = "/shop";
    rerender(<PageViewBeacon />);
    expect(beacon).toHaveBeenCalledTimes(1);
    // The document loaded on the admin page, which is not sent, so the
    // first view prompt-lab sees from it is an in-app navigation.
    expect(bodyOf(beacon.mock.calls[0])).toMatchObject({
      path: "/shop",
      ref: window.location.origin + "/admin",
      event: "nav",
    });
  });

  it("leaving an image page gives ref /d/[id]", () => {
    mockPathname = "/d/abc";
    const { rerender } = render(<PageViewBeacon />);
    mockPathname = "/shop";
    rerender(<PageViewBeacon />);
    expect(bodyOf(beacon.mock.calls[1])).toMatchObject({
      ref: window.location.origin + "/d/[id]",
    });
  });

  it("scrubs a same-origin referrer", () => {
    setReferrer(window.location.origin + "/d/abc?x=1");
    mockPathname = "/sign-in";
    render(<PageViewBeacon />);
    expect(bodyOf(beacon.mock.calls[0])).toMatchObject({
      ref: window.location.origin + "/d/[id]",
    });
  });

  it("keeps a cross-origin referrer as origin + path", () => {
    setReferrer("https://checkout.stripe.com/c/pay/cs_test_1#frag");
    mockPathname = "/order/confirm";
    render(<PageViewBeacon />);
    expect(bodyOf(beacon.mock.calls[0])).toMatchObject({
      ref: "https://checkout.stripe.com/c/pay/cs_test_1",
    });
  });
});

describe("stripToOriginPath", () => {
  it("handles empty, unparseable and query/hash inputs", () => {
    expect(stripToOriginPath("")).toBe("");
    expect(stripToOriginPath("not a url")).toBe("");
    expect(stripToOriginPath("https://prntd.org/checkout?session=cs_123")).toBe(
      "https://prntd.org/checkout",
    );
    expect(
      stripToOriginPath("https://prntd.org/sign-in?next=%2Fcart#top"),
    ).toBe("https://prntd.org/sign-in");
  });
});
