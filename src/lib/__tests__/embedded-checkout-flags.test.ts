/**
 * The embedded-checkout switch and its env-reading config. One switch,
 * EMBEDDED_CHECKOUT_ENABLED, gates the image detail page, the cart, the
 * /checkout page and its loader (#278 slice 6a removed the separate /preview
 * switch, PREVIEW_EMBEDDED_CHECKOUT_ENABLED; setting it now changes nothing).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { embeddedCheckoutConfig } from "../embedded-checkout";
import { embeddedCheckoutFlag } from "../flags";

const PK_TEST = "pk_test_abc123";
const PK_LIVE = "pk_live_abc123";
const SK_TEST = "sk_test_abc123";

function stubEnv(flag: string | undefined) {
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", flag);
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", PK_TEST);
  vi.stubEnv("STRIPE_SECRET_KEY", SK_TEST);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("embedded checkout flag and env-reading config", () => {
  it("off: the flag and the config are off", () => {
    stubEnv(undefined);
    expect(embeddedCheckoutFlag()).toBe(false);
    expect(embeddedCheckoutConfig()).toEqual({ enabled: false, reason: "flag-off" });
  });

  it("on with a matching key pair: enabled", () => {
    stubEnv("true");
    expect(embeddedCheckoutFlag()).toBe(true);
    expect(embeddedCheckoutConfig()).toEqual({ enabled: true, publishableKey: PK_TEST });
  });

  it("the retired preview switch turns nothing on", () => {
    stubEnv(undefined);
    vi.stubEnv("PREVIEW_EMBEDDED_CHECKOUT_ENABLED", "true");
    expect(embeddedCheckoutFlag()).toBe(false);
    expect(embeddedCheckoutConfig()).toEqual({ enabled: false, reason: "flag-off" });
  });

  it.each(["false", "TRUE", "", "1"])(
    "only the literal string 'true' counts: %j turns nothing on",
    (value) => {
      stubEnv(value);
      expect(embeddedCheckoutFlag()).toBe(false);
      expect(embeddedCheckoutConfig()).toEqual({ enabled: false, reason: "flag-off" });
    }
  );

  it("flag on with a missing or mismatched key fails closed", () => {
    stubEnv("true");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", undefined);
    expect(embeddedCheckoutConfig()).toEqual({ enabled: false, reason: "missing-key" });

    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", PK_LIVE);
    expect(embeddedCheckoutConfig()).toEqual({ enabled: false, reason: "mode-mismatch" });
  });
});
