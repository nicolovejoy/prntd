/**
 * The per-surface embedded-checkout switches and their env-reading configs
 * (#135 slice 3). EMBEDDED_CHECKOUT_ENABLED gates the image detail page,
 * PREVIEW_EMBEDDED_CHECKOUT_ENABLED gates /preview, and the /checkout page
 * accepts either.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  embeddedCheckoutConfig,
  previewEmbeddedCheckoutConfig,
  embeddedCheckoutPageConfig,
} from "../embedded-checkout";
import {
  embeddedCheckoutFlag,
  previewEmbeddedCheckoutFlag,
  embeddedCheckoutPageFlag,
} from "../flags";

const PK_TEST = "pk_test_abc123";
const PK_LIVE = "pk_live_abc123";
const SK_TEST = "sk_test_abc123";

function stubEnv(detail: string | undefined, preview: string | undefined) {
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", detail);
  vi.stubEnv("PREVIEW_EMBEDDED_CHECKOUT_ENABLED", preview);
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", PK_TEST);
  vi.stubEnv("STRIPE_SECRET_KEY", SK_TEST);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("embedded checkout flags and env-reading configs", () => {
  it("both off: every flag and config is off", () => {
    stubEnv(undefined, undefined);
    expect(embeddedCheckoutFlag()).toBe(false);
    expect(previewEmbeddedCheckoutFlag()).toBe(false);
    expect(embeddedCheckoutPageFlag()).toBe(false);
    expect(embeddedCheckoutConfig()).toEqual({ enabled: false, reason: "flag-off" });
    expect(previewEmbeddedCheckoutConfig()).toEqual({ enabled: false, reason: "flag-off" });
    expect(embeddedCheckoutPageConfig()).toEqual({ enabled: false, reason: "flag-off" });
  });

  it("only the image-detail flag: the preview flag and config stay off, the page accepts it", () => {
    stubEnv("true", undefined);
    expect(embeddedCheckoutFlag()).toBe(true);
    expect(previewEmbeddedCheckoutFlag()).toBe(false);
    expect(embeddedCheckoutPageFlag()).toBe(true);
    expect(embeddedCheckoutConfig().enabled).toBe(true);
    expect(previewEmbeddedCheckoutConfig()).toEqual({ enabled: false, reason: "flag-off" });
    expect(embeddedCheckoutPageConfig()).toEqual({ enabled: true, publishableKey: PK_TEST });
  });

  it("only the preview flag: the image-detail flag and config stay off, the page accepts it", () => {
    stubEnv(undefined, "true");
    expect(embeddedCheckoutFlag()).toBe(false);
    expect(previewEmbeddedCheckoutFlag()).toBe(true);
    expect(embeddedCheckoutPageFlag()).toBe(true);
    expect(embeddedCheckoutConfig()).toEqual({ enabled: false, reason: "flag-off" });
    expect(previewEmbeddedCheckoutConfig()).toEqual({ enabled: true, publishableKey: PK_TEST });
    expect(embeddedCheckoutPageConfig()).toEqual({ enabled: true, publishableKey: PK_TEST });
  });

  it.each(["false", "TRUE", "", "1"])(
    "only the literal string 'true' counts: %j turns nothing on",
    (value) => {
      stubEnv(value, value);
      expect(embeddedCheckoutFlag()).toBe(false);
      expect(previewEmbeddedCheckoutFlag()).toBe(false);
      expect(embeddedCheckoutPageFlag()).toBe(false);
      expect(embeddedCheckoutPageConfig()).toEqual({ enabled: false, reason: "flag-off" });
    }
  );

  it("preview flag on with a missing or mismatched key fails closed, page config included", () => {
    stubEnv(undefined, "true");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", undefined);
    expect(previewEmbeddedCheckoutConfig()).toEqual({ enabled: false, reason: "missing-key" });
    expect(embeddedCheckoutPageConfig()).toEqual({ enabled: false, reason: "missing-key" });

    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", PK_LIVE);
    expect(previewEmbeddedCheckoutConfig()).toEqual({ enabled: false, reason: "mode-mismatch" });
    expect(embeddedCheckoutPageConfig()).toEqual({ enabled: false, reason: "mode-mismatch" });
  });
});
