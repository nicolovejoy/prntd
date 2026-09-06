/**
 * sweepStudioForUser's never-reject contract (#204). It runs inside
 * `after()` on both the /studio page and the poll action, so a DB hiccup in
 * either sweep must be caught + logged, never allowed to become an unhandled
 * rejection on the shared Fluid instance.
 */
import { describe, it, expect, vi } from "vitest";
import { sweepStudioForUser } from "@/lib/studio";
import type { db as appDb } from "@/lib/db";

describe("sweepStudioForUser", () => {
  it("resolves (does not throw) when a sweep rejects, and logs it", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      select() {
        throw new Error("db down");
      },
    } as unknown as typeof appDb;

    await expect(
      sweepStudioForUser("owner", broken)
    ).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
