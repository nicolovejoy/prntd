import { describe, it, expect } from "vitest";
import {
  classifyDbTarget,
  dbPreflight,
  DATABASE_URL_FROM_SHELL_KEY,
} from "@/lib/db-target";

const DEV_URL = "libsql://prntd-dev-nicolovejoy.aws-us-west-2.turso.io";
const PREVIEW_URL = "libsql://prntd-preview-nicolovejoy.aws-us-west-2.turso.io";
const PROD_URL = "libsql://prntd-nicolovejoy.aws-us-west-2.turso.io";

// dbPreflight is typed against the real NodeJS.ProcessEnv (which this repo's
// TS setup requires NODE_ENV on) so the test env objects are built by
// clearing the DB-related keys off a copy of the real process.env rather
// than constructing bare object literals.
function makeEnv(
  overrides: Record<string, string | undefined>
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: undefined,
    DB_TARGET_CONFIRM: undefined,
    [DATABASE_URL_FROM_SHELL_KEY]: undefined,
  };
  return { ...env, ...overrides };
}

describe("classifyDbTarget", () => {
  it("classifies the dev branch", () => {
    expect(classifyDbTarget(DEV_URL)).toBe("dev");
  });

  it("classifies the preview branch", () => {
    expect(classifyDbTarget(PREVIEW_URL)).toBe("preview");
  });

  it("classifies the prod branch", () => {
    expect(classifyDbTarget(PROD_URL)).toBe("prod");
  });

  it("classifies :memory: as memory", () => {
    expect(classifyDbTarget(":memory:")).toBe("memory");
  });

  it("classifies a file: URL as memory", () => {
    expect(classifyDbTarget("file:./local.db")).toBe("memory");
  });

  it("classifies an unrecognized host as unknown", () => {
    expect(classifyDbTarget("libsql://some-other-db.turso.io")).toBe(
      "unknown"
    );
  });

  it("classifies undefined as unknown", () => {
    expect(classifyDbTarget(undefined)).toBe("unknown");
  });
});

describe("dbPreflight", () => {
  it("refuses when DATABASE_URL is missing", () => {
    const result = dbPreflight(makeEnv({}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/DATABASE_URL is not set/);
    }
  });

  it("allows dev implicitly (from .env.local)", () => {
    const result = dbPreflight(makeEnv({ DATABASE_URL: DEV_URL }));
    expect(result).toMatchObject({ ok: true, target: "dev", fromShell: false });
  });

  it("allows :memory: implicitly", () => {
    const result = dbPreflight(makeEnv({ DATABASE_URL: ":memory:" }));
    expect(result).toMatchObject({
      ok: true,
      target: "memory",
      fromShell: false,
    });
  });

  it("refuses prod when DATABASE_URL came from .env.local", () => {
    const result = dbPreflight(makeEnv({ DATABASE_URL: PROD_URL }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/"prod"/);
      expect(result.reason).toMatch(/DB_TARGET_CONFIRM=prod/);
    }
  });

  it("allows prod when DATABASE_URL was already set in the shell", () => {
    const result = dbPreflight(makeEnv({
      DATABASE_URL: PROD_URL,
      [DATABASE_URL_FROM_SHELL_KEY]: "1",
    }));
    expect(result).toMatchObject({
      ok: true,
      target: "prod",
      fromShell: true,
    });
  });

  it("allows prod-from-file when DB_TARGET_CONFIRM=prod is set", () => {
    const result = dbPreflight(makeEnv({
      DATABASE_URL: PROD_URL,
      DB_TARGET_CONFIRM: "prod",
    }));
    expect(result).toMatchObject({
      ok: true,
      target: "prod",
      fromShell: false,
    });
  });

  it("refuses prod-from-file when DB_TARGET_CONFIRM has the wrong value", () => {
    const result = dbPreflight(makeEnv({
      DATABASE_URL: PROD_URL,
      DB_TARGET_CONFIRM: "preview",
    }));
    expect(result.ok).toBe(false);
  });

  it("refuses preview-from-file without confirmation", () => {
    const result = dbPreflight(makeEnv({ DATABASE_URL: PREVIEW_URL }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/"preview"/);
    }
  });

  it("allows preview-from-file with DB_TARGET_CONFIRM=preview", () => {
    const result = dbPreflight(makeEnv({
      DATABASE_URL: PREVIEW_URL,
      DB_TARGET_CONFIRM: "preview",
    }));
    expect(result).toMatchObject({ ok: true, target: "preview" });
  });

  it("refuses an unknown target from .env.local without confirmation", () => {
    const result = dbPreflight(makeEnv({
      DATABASE_URL: "libsql://something-else.turso.io",
    }));
    expect(result.ok).toBe(false);
  });

  it("allows an unknown target from .env.local with DB_TARGET_CONFIRM=unknown", () => {
    const result = dbPreflight(makeEnv({
      DATABASE_URL: "libsql://something-else.turso.io",
      DB_TARGET_CONFIRM: "unknown",
    }));
    expect(result).toMatchObject({ ok: true, target: "unknown" });
  });
});
