import { describe, it, expect, vi } from "vitest";
import { desc } from "drizzle-orm";
import { createTestDb } from "./test-db";
import { appError } from "@/lib/db/schema";
import { shapeAppError } from "@/lib/app-error";
import { recordAppError } from "@/lib/app-error-store";
import type { db as appDb } from "@/lib/db";

describe("recordAppError (real DB)", () => {
  it("inserts a row from a shaped error", async () => {
    const db = await createTestDb();
    const shape = shapeAppError(
      Object.assign(new Error("delete failed"), { digest: "digest-1" }),
      { path: "/designs", method: "POST" },
      { routerKind: "App Router", routeType: "action", routePath: "/designs" }
    );

    await recordAppError(shape, db);

    const rows = await db.select().from(appError);
    expect(rows).toHaveLength(1);
    expect(rows[0].digest).toBe("digest-1");
    expect(rows[0].message).toBe("delete failed");
    expect(rows[0].stack).toContain("delete failed");
    expect(rows[0].path).toBe("/designs");
    expect(rows[0].method).toBe("POST");
    expect(rows[0].context).toEqual({
      routerKind: "App Router",
      routeType: "action",
      routePath: "/designs",
    });
    expect(rows[0].id).toBeTruthy();
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it("orders newest first under the admin query shape", async () => {
    const db = await createTestDb();
    await db.insert(appError).values({
      message: "older",
      createdAt: new Date("2026-07-01T00:00:00Z"),
    });
    await db.insert(appError).values({
      message: "newer",
      createdAt: new Date("2026-07-02T00:00:00Z"),
    });

    const rows = await db
      .select()
      .from(appError)
      .orderBy(desc(appError.createdAt))
      .limit(50);
    expect(rows.map((r) => r.message)).toEqual(["newer", "older"]);
  });

  it("never throws when the insert fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      insert() {
        throw new Error("db down");
      },
    } as unknown as typeof appDb;

    await expect(
      recordAppError(shapeAppError(new Error("boom")), broken)
    ).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      "app_error insert failed:",
      "db down"
    );
    consoleSpy.mockRestore();
  });

  it("never throws when the insert rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      insert() {
        return {
          values: () => Promise.reject(new Error("network")),
        };
      },
    } as unknown as typeof appDb;

    await expect(
      recordAppError(shapeAppError(new Error("boom")), broken)
    ).resolves.toBeUndefined();
    consoleSpy.mockRestore();
  });
});
