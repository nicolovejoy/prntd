import { describe, expect, it } from "vitest";
import {
  resolveEmbeddedCheckoutConfig,
  safeCheckoutReturnPath,
  embeddedCheckoutPath,
} from "../embedded-checkout";

const validPkTest = "pk_test_abc123";
const validPkLive = "pk_live_abc123";
const validSkTest = "sk_test_abc123";
const validSkLive = "sk_live_abc123";

describe("resolveEmbeddedCheckoutConfig", () => {
  it.each([undefined, "false", "TRUE", "", "1"])(
    "is flag-off when the raw flag is %j (only the literal string 'true' counts)",
    (flag) => {
      const result = resolveEmbeddedCheckoutConfig({
        flag,
        publishableKey: validPkTest,
        secretKey: validSkTest,
      });
      expect(result).toEqual({ enabled: false, reason: "flag-off" });
    }
  );

  it.each([undefined, "", "   "])(
    "is missing-key when the publishable key is %j",
    (publishableKey) => {
      const result = resolveEmbeddedCheckoutConfig({
        flag: "true",
        publishableKey,
        secretKey: validSkTest,
      });
      expect(result).toEqual({ enabled: false, reason: "missing-key" });
    }
  );

  it.each(["sk_test_abc123", "garbage", "pk_abc123", "pk_test_"])(
    "is invalid-key when the publishable key is shaped like %j",
    (publishableKey) => {
      const result = resolveEmbeddedCheckoutConfig({
        flag: "true",
        publishableKey,
        secretKey: validSkTest,
      });
      expect(result).toEqual({ enabled: false, reason: "invalid-key" });
    }
  );

  it("is mode-mismatch for pk_test + sk_live", () => {
    const result = resolveEmbeddedCheckoutConfig({
      flag: "true",
      publishableKey: validPkTest,
      secretKey: validSkLive,
    });
    expect(result).toEqual({ enabled: false, reason: "mode-mismatch" });
  });

  it("is mode-mismatch for pk_live + sk_test", () => {
    const result = resolveEmbeddedCheckoutConfig({
      flag: "true",
      publishableKey: validPkLive,
      secretKey: validSkTest,
    });
    expect(result).toEqual({ enabled: false, reason: "mode-mismatch" });
  });

  it("is mode-mismatch when the secret key is unparseable garbage", () => {
    const result = resolveEmbeddedCheckoutConfig({
      flag: "true",
      publishableKey: validPkTest,
      secretKey: "garbage",
    });
    expect(result).toEqual({ enabled: false, reason: "mode-mismatch" });
  });

  it("is enabled for pk_test + sk_test, trimming the publishable key", () => {
    const result = resolveEmbeddedCheckoutConfig({
      flag: "true",
      publishableKey: `  ${validPkTest}  `,
      secretKey: validSkTest,
    });
    expect(result).toEqual({ enabled: true, publishableKey: validPkTest });
  });

  it("is enabled for pk_test + rk_test (restricted key)", () => {
    const result = resolveEmbeddedCheckoutConfig({
      flag: "true",
      publishableKey: validPkTest,
      secretKey: "rk_test_abc123",
    });
    expect(result).toEqual({ enabled: true, publishableKey: validPkTest });
  });

  it("is enabled for pk_live + sk_live", () => {
    const result = resolveEmbeddedCheckoutConfig({
      flag: "true",
      publishableKey: validPkLive,
      secretKey: validSkLive,
    });
    expect(result).toEqual({ enabled: true, publishableKey: validPkLive });
  });
});

describe("safeCheckoutReturnPath", () => {
  it("accepts a normal relative path", () => {
    expect(safeCheckoutReturnPath("/d/abc")).toBe("/d/abc");
  });

  it.each([
    "//evil.com",
    "https://evil.com",
    "/\\evil.com",
    "javascript:alert(1)",
    "",
    null,
    undefined,
    42,
    {},
  ])("falls back to /shop for %j", (value) => {
    expect(safeCheckoutReturnPath(value)).toBe("/shop");
  });

  it("rejects control characters", () => {
    expect(safeCheckoutReturnPath("/d/abc\n/evil")).toBe("/shop");
  });
});

describe("embeddedCheckoutPath", () => {
  it("encodes the session id and the safe back path into the query string", () => {
    expect(embeddedCheckoutPath("cs_test_123", "/d/abc")).toBe(
      "/checkout?session=cs_test_123&from=%2Fd%2Fabc"
    );
  });

  it("falls back to /shop when the back path is unsafe", () => {
    expect(embeddedCheckoutPath("cs_test_123", "//evil.com")).toBe(
      "/checkout?session=cs_test_123&from=%2Fshop"
    );
  });

  it("percent-encodes special characters in the session id", () => {
    expect(embeddedCheckoutPath("cs test&x", "/shop")).toBe(
      "/checkout?session=cs%20test%26x&from=%2Fshop"
    );
  });
});
