import { describe, it, expect, vi } from "vitest";
import { createTtlCache } from "@/lib/ttl-cache";

describe("createTtlCache", () => {
  it("returns a set value while fresh and undefined once expired", () => {
    let clock = 1000;
    const cache = createTtlCache<string>({ ttlMs: 100, now: () => clock });

    cache.set("a", "value");
    expect(cache.get("a")).toBe("value");
    expect(cache.has("a")).toBe(true);

    clock += 99;
    expect(cache.get("a")).toBe("value");

    clock += 1; // now exactly at expiry (expiresAt <= now → expired)
    expect(cache.get("a")).toBeUndefined();
    expect(cache.has("a")).toBe(false);
  });

  it("returns undefined for an unknown key", () => {
    const cache = createTtlCache<number>({ ttlMs: 100, now: () => 0 });
    expect(cache.get("nope")).toBeUndefined();
  });

  it("delete removes a fresh value", () => {
    const cache = createTtlCache<number>({ ttlMs: 100, now: () => 0 });
    cache.set("a", 1);
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
  });

  it("warm loads once and caches the result", async () => {
    const cache = createTtlCache<string>({ ttlMs: 100, now: () => 0 });
    const loader = vi.fn().mockResolvedValue("loaded");

    await expect(cache.warm("a", loader)).resolves.toBe("loaded");
    expect(cache.get("a")).toBe("loaded");

    // Second warm while fresh does not re-run the loader.
    await expect(cache.warm("a", loader)).resolves.toBe("loaded");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent warms of the same key to one load", async () => {
    const cache = createTtlCache<string>({ ttlMs: 100, now: () => 0 });
    let resolve!: (v: string) => void;
    const loader = vi.fn(
      () => new Promise<string>((r) => (resolve = r))
    );

    const p1 = cache.warm("a", loader);
    const p2 = cache.warm("a", loader);
    expect(loader).toHaveBeenCalledTimes(1);

    resolve("loaded");
    await Promise.all([p1, p2]);
    expect(await p1).toBe("loaded");
    expect(await p2).toBe("loaded");
  });

  it("does not cache a rejected load and retries on the next warm", async () => {
    const cache = createTtlCache<string>({ ttlMs: 100, now: () => 0 });
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("recovered");

    await expect(cache.warm("a", loader)).rejects.toThrow("boom");
    expect(cache.get("a")).toBeUndefined();

    await expect(cache.warm("a", loader)).resolves.toBe("recovered");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("re-runs the loader once a cached value has expired", async () => {
    let clock = 0;
    const cache = createTtlCache<string>({ ttlMs: 100, now: () => clock });
    const loader = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");

    await cache.warm("a", loader);
    clock += 100; // expired
    await expect(cache.warm("a", loader)).resolves.toBe("second");
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
