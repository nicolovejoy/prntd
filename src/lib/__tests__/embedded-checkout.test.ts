import { describe, expect, it } from "vitest";
import {
  resolveEmbeddedCheckoutConfig,
  safeCheckoutReturnPath,
  MAX_CHECKOUT_RETURN_PATH_LENGTH,
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

  it.each(["/.//evil.example", "/..//evil.example", "/cart/..//evil.example"])(
    "rejects the dot-segment shape %j that resolves to //host",
    (value) => {
      expect(safeCheckoutReturnPath(value)).toBe("/shop");
    }
  );

  it("returns a path with a dot segment resolved", () => {
    expect(safeCheckoutReturnPath("/cart/./x")).toBe("/cart/x");
  });

  it("leaves a normal image detail path with picks unchanged", () => {
    const path = "/d/img-1?front=a&back=b&size=M&swap=1";
    expect(safeCheckoutReturnPath(path)).toBe(path);
  });

  it("caps the resolved output: a 2048-char non-ASCII input that resolves longer is rejected", () => {
    const path = "/d/" + "é".repeat(MAX_CHECKOUT_RETURN_PATH_LENGTH - 3);
    expect(path.length).toBe(2048);
    expect(safeCheckoutReturnPath(path)).toBe("/shop");
  });

  it.each([
    "/d/img-1?front=a&back=b&size=M&swap=1",
    "/cart",
    "/d/" + "a".repeat(1997),
  ])("is idempotent for %#", (x) => {
    const once = safeCheckoutReturnPath(x);
    expect(safeCheckoutReturnPath(once)).toBe(once);
  });

  it("caps the length at MAX_CHECKOUT_RETURN_PATH_LENGTH", () => {
    const at = "/d/" + "a".repeat(MAX_CHECKOUT_RETURN_PATH_LENGTH - 3);
    expect(at.length).toBe(2048);
    expect(safeCheckoutReturnPath(at)).toBe(at);
    expect(safeCheckoutReturnPath(at + "a")).toBe("/shop");
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
  const OUTSIDE_VERCEL = { env: undefined, url: undefined, branchUrl: undefined };
  const PREVIEW = {
    env: "preview",
    url: "prntd-abc123def-nico-lovejoys-projects.vercel.app",
    branchUrl: "prntd-git-feature-x-nico-lovejoys-projects.vercel.app",
  };
  const PRODUCTION = {
    env: "production",
    url: "prntd-9f8e7d6c-nico-lovejoys-projects.vercel.app",
    branchUrl: "prntd-git-main-nico-lovejoys-projects.vercel.app",
  };
  const BRANCH_ORIGIN =
    "https://prntd-git-feature-x-nico-lovejoys-projects.vercel.app";
  const HASH_ORIGIN = "https://prntd-abc123def-nico-lovejoys-projects.vercel.app";

  it("falls back to appUrl's origin when there's no Origin header", () => {
    expect(resolveReturnOrigin(null, APP_URL, OUTSIDE_VERCEL)).toBe(
      "https://prntd.org"
    );
  });

  it("falls back to appUrl's origin when the header doesn't parse as a URL", () => {
    expect(resolveReturnOrigin("not a url", APP_URL, OUTSIDE_VERCEL)).toBe(
      "https://prntd.org"
    );
  });

  it("trusts an origin identical to appUrl's", () => {
    expect(
      resolveReturnOrigin("https://prntd.org", APP_URL, OUTSIDE_VERCEL)
    ).toBe("https://prntd.org");
  });

  it("trusts the Preview's branch host when it is VERCEL_BRANCH_URL", () => {
    expect(resolveReturnOrigin(BRANCH_ORIGIN, APP_URL, PREVIEW)).toBe(
      BRANCH_ORIGIN
    );
  });

  it("trusts the Preview's per-deploy host when it is VERCEL_URL", () => {
    expect(resolveReturnOrigin(HASH_ORIGIN, APP_URL, PREVIEW)).toBe(HASH_ORIGIN);
  });

  it("does not trust either preview host shape outside Vercel", () => {
    expect(resolveReturnOrigin(BRANCH_ORIGIN, APP_URL, OUTSIDE_VERCEL)).toBe(
      "https://prntd.org"
    );
    expect(resolveReturnOrigin(HASH_ORIGIN, APP_URL, OUTSIDE_VERCEL)).toBe(
      "https://prntd.org"
    );
  });

  it("does not trust another host of the same shape on a Preview", () => {
    expect(
      resolveReturnOrigin(
        "https://prntd-git-other-nico-lovejoys-projects.vercel.app",
        APP_URL,
        PREVIEW
      )
    ).toBe("https://prntd.org");
  });

  it("does not trust a Production deployment's own VERCEL_URL", () => {
    expect(
      resolveReturnOrigin(
        "https://prntd-9f8e7d6c-nico-lovejoys-projects.vercel.app",
        APP_URL,
        PRODUCTION
      )
    ).toBe("https://prntd.org");
  });

  it("does not trust a Production deployment's VERCEL_BRANCH_URL", () => {
    expect(
      resolveReturnOrigin(
        "https://prntd-git-main-nico-lovejoys-projects.vercel.app",
        APP_URL,
        PRODUCTION
      )
    ).toBe("https://prntd.org");
  });

  it("does not trust a Preview host over plain http", () => {
    expect(
      resolveReturnOrigin(
        "http://prntd-abc123def-nico-lovejoys-projects.vercel.app",
        APP_URL,
        PREVIEW
      )
    ).toBe("https://prntd.org");
  });

  it("does not trust a Preview host on a different port", () => {
    expect(
      resolveReturnOrigin(`${HASH_ORIGIN}:8443`, APP_URL, PREVIEW)
    ).toBe("https://prntd.org");
  });

  it("trusts the branch host when VERCEL_URL is undefined, and nothing when both are", () => {
    expect(
      resolveReturnOrigin(BRANCH_ORIGIN, APP_URL, { ...PREVIEW, url: undefined })
    ).toBe(BRANCH_ORIGIN);
    expect(
      resolveReturnOrigin(BRANCH_ORIGIN, APP_URL, {
        env: "preview",
        url: undefined,
        branchUrl: undefined,
      })
    ).toBe("https://prntd.org");
  });

  it("matches the host case-insensitively", () => {
    expect(
      resolveReturnOrigin(HASH_ORIGIN, APP_URL, {
        ...PREVIEW,
        url: "PRNTD-ABC123DEF-Nico-Lovejoys-Projects.vercel.app",
      })
    ).toBe(HASH_ORIGIN);
  });

  it("does not trust an unrelated *.vercel.app host", () => {
    expect(
      resolveReturnOrigin("https://someone-else.vercel.app", APP_URL, PREVIEW)
    ).toBe("https://prntd.org");
  });

  it("does not trust a prntd-* host missing the team suffix", () => {
    expect(
      resolveReturnOrigin("https://prntd-git-x.vercel.app", APP_URL, PREVIEW)
    ).toBe("https://prntd.org");
  });

  it("does not trust a prntd-* host claiming to be someone else's project", () => {
    expect(
      resolveReturnOrigin(
        "https://prntd-evil-someone-else.vercel.app",
        APP_URL,
        PREVIEW
      )
    ).toBe("https://prntd.org");
  });

  it("does not trust prntd.org when it is not appUrl's origin", () => {
    expect(
      resolveReturnOrigin("https://prntd.org", "https://other.example", OUTSIDE_VERCEL)
    ).toBe("https://other.example");
  });

  it("does not trust a *.prntd.org subdomain", () => {
    expect(
      resolveReturnOrigin("https://staging.prntd.org", APP_URL, OUTSIDE_VERCEL)
    ).toBe("https://prntd.org");
  });

  it("does not trust localhost when appUrl is a different origin", () => {
    expect(
      resolveReturnOrigin("http://localhost:3000", APP_URL, OUTSIDE_VERCEL)
    ).toBe("https://prntd.org");
  });

  it("trusts localhost when it's the same origin as appUrl (local dev / e2e)", () => {
    expect(
      resolveReturnOrigin(
        "http://localhost:3000",
        "http://localhost:3000",
        OUTSIDE_VERCEL
      )
    ).toBe("http://localhost:3000");
  });

  it("falls back to appUrl's origin for an untrusted host", () => {
    expect(
      resolveReturnOrigin("https://evil.example", APP_URL, OUTSIDE_VERCEL)
    ).toBe("https://prntd.org");
  });

  it("falls back to appUrl's origin for a non-http(s) scheme", () => {
    expect(
      resolveReturnOrigin("javascript:alert(1)", APP_URL, OUTSIDE_VERCEL)
    ).toBe("https://prntd.org");
  });

  it("returns a bare origin with no path even when the header carries one", () => {
    expect(
      resolveReturnOrigin(`${BRANCH_ORIGIN}/some/path`, APP_URL, PREVIEW)
    ).toBe(BRANCH_ORIGIN);
  });

  it("returns a malformed appUrl unchanged rather than throwing", () => {
    expect(resolveReturnOrigin(null, "not-a-url", OUTSIDE_VERCEL)).toBe(
      "not-a-url"
    );
    expect(
      resolveReturnOrigin("https://evil.example", "not-a-url/", OUTSIDE_VERCEL)
    ).toBe("not-a-url");
  });

  it("does not throw when appUrl is undefined (e.g. NEXT_PUBLIC_APP_URL unset)", () => {
    expect(() =>
      resolveReturnOrigin(null, undefined, OUTSIDE_VERCEL)
    ).not.toThrow();
    expect(resolveReturnOrigin(null, undefined, OUTSIDE_VERCEL)).toBe("");
    expect(() =>
      resolveReturnOrigin("https://prntd.org", undefined, OUTSIDE_VERCEL)
    ).not.toThrow();
    expect(
      resolveReturnOrigin("https://prntd.org", undefined, OUTSIDE_VERCEL)
    ).toBe("");
  });
});
