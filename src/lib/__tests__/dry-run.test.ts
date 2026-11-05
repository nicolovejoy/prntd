import { afterEach, describe, expect, it, vi } from "vitest";
import { dryRunEnabled } from "@/lib/dry-run";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("dryRunEnabled", () => {
  it("is on only for the exact string true", () => {
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("PRINTFUL_DRY_RUN", "true");
    expect(dryRunEnabled("PRINTFUL_DRY_RUN")).toBe(true);
    vi.stubEnv("PRINTFUL_DRY_RUN", "1");
    expect(dryRunEnabled("PRINTFUL_DRY_RUN")).toBe(false);
    vi.stubEnv("PRINTFUL_DRY_RUN", undefined);
    expect(dryRunEnabled("PRINTFUL_DRY_RUN")).toBe(false);
  });

  it("stays on in a Preview deployment", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PRINTFUL_DRY_RUN", "true");
    vi.stubEnv("R2_DRY_RUN", "true");
    expect(dryRunEnabled("PRINTFUL_DRY_RUN")).toBe(true);
    expect(dryRunEnabled("R2_DRY_RUN")).toBe(true);
  });

  it("throws with VERCEL_ENV=production, naming the flag, so neither the dry run nor the real call happens", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PRINTFUL_DRY_RUN", "true");
    vi.stubEnv("R2_DRY_RUN", "true");
    expect(() => dryRunEnabled("PRINTFUL_DRY_RUN")).toThrow(/PRINTFUL_DRY_RUN/);
    expect(() => dryRunEnabled("R2_DRY_RUN")).toThrow(/R2_DRY_RUN/);
  });

  it("an unset flag never throws in Production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PRINTFUL_DRY_RUN", undefined);
    expect(dryRunEnabled("PRINTFUL_DRY_RUN")).toBe(false);
  });
});
