import { describe, expect, it } from "vitest";
import {
  resolveEmbeddedCheckoutConfig,
  safeCheckoutReturnPath,
  embeddedCheckoutPath,
  resolveReturnOrigin,
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

const APP_URL = "https://prntd.org";

describe("resolveReturnOrigin", () => {
  it("falls back to appUrl's origin when there's no Origin header", () => {
    expect(resolveReturnOrigin(null, APP_URL)).toBe("https://prntd.org");
  });

  it("falls back to appUrl's origin when the header doesn't parse as a URL", () => {
    expect(resolveReturnOrigin("not a url", APP_URL)).toBe(
      "https://prntd.org"
    );
  });

  it("trusts an origin identical to appUrl's", () => {
    expect(resolveReturnOrigin("https://prntd.org", APP_URL)).toBe(
      "https://prntd.org"
    );
  });

  it("trusts a prntd-* preview host over https", () => {
    expect(
      resolveReturnOrigin("https://prntd-git-foo.vercel.app", APP_URL)
    ).toBe("https://prntd-git-foo.vercel.app");
  });

  it("does not trust an unrelated *.vercel.app host", () => {
    expect(
      resolveReturnOrigin("https://someone-else.vercel.app", APP_URL)
    ).toBe("https://prntd.org");
  });

  it("trusts the bare prntd.org host over https", () => {
    expect(resolveReturnOrigin("https://prntd.org", "https://other.example")).toBe(
      "https://prntd.org"
    );
  });

  it("trusts any *.prntd.org subdomain over https", () => {
    expect(resolveReturnOrigin("https://staging.prntd.org", APP_URL)).toBe(
      "https://staging.prntd.org"
    );
  });

  it("does not trust localhost when appUrl is a different origin", () => {
    expect(resolveReturnOrigin("http://localhost:3000", APP_URL)).toBe(
      "https://prntd.org"
    );
  });

  it("trusts localhost when it's the same origin as appUrl (local dev / e2e)", () => {
    expect(
      resolveReturnOrigin("http://localhost:3000", "http://localhost:3000")
    ).toBe("http://localhost:3000");
  });

  it("does not trust vercel.app over plain http", () => {
    expect(resolveReturnOrigin("http://prntd-git-x.vercel.app", APP_URL)).toBe(
      "https://prntd.org"
    );
  });

  it("falls back to appUrl's origin for an untrusted host", () => {
    expect(resolveReturnOrigin("https://evil.example", APP_URL)).toBe(
      "https://prntd.org"
    );
  });

  it("falls back to appUrl's origin for a non-http(s) scheme", () => {
    expect(resolveReturnOrigin("javascript:alert(1)", APP_URL)).toBe(
      "https://prntd.org"
    );
  });

  it("returns a bare origin with no path even when the header carries one", () => {
    expect(
      resolveReturnOrigin("https://prntd-git-x.vercel.app/some/path", APP_URL)
    ).toBe("https://prntd-git-x.vercel.app");
  });

  it("returns a malformed appUrl unchanged rather than throwing", () => {
    expect(resolveReturnOrigin(null, "not-a-url")).toBe("not-a-url");
    expect(resolveReturnOrigin("https://evil.example", "not-a-url/")).toBe(
      "not-a-url"
    );
  });

  it("does not throw when appUrl is undefined (e.g. NEXT_PUBLIC_APP_URL unset)", () => {
    expect(() => resolveReturnOrigin(null, undefined)).not.toThrow();
    expect(resolveReturnOrigin(null, undefined)).toBe("");
    expect(() => resolveReturnOrigin("https://prntd.org", undefined)).not.toThrow();
    expect(resolveReturnOrigin("https://prntd.org", undefined)).toBe("");
  });
});
