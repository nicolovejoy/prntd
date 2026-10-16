import { describe, it, expect } from "vitest";
import { BENCH_HREF } from "@/lib/studio-focus";
import {
  isSeedFired,
  markSeedFired,
  parseFiredSeeds,
  parseSeed,
  readSeedPrompt,
  SEED_FIRED_CAP,
  SEED_FIRED_STORAGE_KEY,
  seedHref,
} from "@/lib/studio-seed";
import { isUuid } from "@/lib/uuid";

const LANE = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";

function paramsOf(href: string): URLSearchParams {
  return new URL(href, "http://prntd.invalid").searchParams;
}

describe("seedHref", () => {
  it("builds the Studio URL with the prompt and both ids", () => {
    const href = seedHref("a heron in tall reeds", { designId: LANE, jobId: JOB });
    expect(href.startsWith("/studio?")).toBe(true);
    const p = paramsOf(href);
    expect(p.get("prompt")).toBe("a heron in tall reeds");
    expect(p.get("lane")).toBe(LANE);
    expect(p.get("seed")).toBe(JOB);
  });

  it("trims the prompt", () => {
    expect(paramsOf(seedHref("  ink fish \n", { designId: LANE, jobId: JOB })).get("prompt")).toBe(
      "ink fish"
    );
  });

  it("returns the bench for a blank, missing or null prompt", () => {
    expect(seedHref("")).toBe(BENCH_HREF);
    expect(seedHref("   \n\t")).toBe(BENCH_HREF);
    expect(seedHref(null)).toBe(BENCH_HREF);
    expect(seedHref(undefined)).toBe(BENCH_HREF);
    expect(BENCH_HREF).toBe("/studio");
  });

  it("mints a fresh pair of UUIDs when none is given", () => {
    const a = paramsOf(seedHref("x"));
    const b = paramsOf(seedHref("x"));
    expect(isUuid(a.get("lane"))).toBe(true);
    expect(isUuid(a.get("seed"))).toBe(true);
    expect(a.get("lane")).not.toBe(a.get("seed"));
    expect(a.get("lane")).not.toBe(b.get("lane"));
    expect(a.get("seed")).not.toBe(b.get("seed"));
  });

  it("mints only the id that is missing", () => {
    const p = paramsOf(seedHref("x", { designId: LANE }));
    expect(p.get("lane")).toBe(LANE);
    expect(isUuid(p.get("seed"))).toBe(true);
    const q = paramsOf(seedHref("x", { jobId: JOB }));
    expect(isUuid(q.get("lane"))).toBe(true);
    expect(q.get("seed")).toBe(JOB);
  });

  it("never emits the stage params", () => {
    const p = paramsOf(seedHref("a heron", { designId: LANE, jobId: JOB }));
    expect(p.has("conversation")).toBe(false);
    expect(p.has("image")).toBe(false);
    expect([...p.keys()].sort()).toEqual(["lane", "prompt", "seed"]);
  });
});

describe("parseSeed", () => {
  const awkward = "a cat & a dog? #1 — café 日本語 100%";

  it("round-trips a prompt holding & ? # spaces and non-ASCII text (URLSearchParams)", () => {
    const href = seedHref(awkward, { designId: LANE, jobId: JOB });
    expect(parseSeed(paramsOf(href))).toEqual({
      kind: "complete",
      seed: { prompt: awkward, designId: LANE, jobId: JOB },
    });
  });

  it("round-trips through a searchParams record, the way the page receives it", () => {
    const href = seedHref(awkward, { designId: LANE, jobId: JOB });
    const record = Object.fromEntries(paramsOf(href).entries());
    expect(parseSeed(record)).toEqual({
      kind: "complete",
      seed: { prompt: awkward, designId: LANE, jobId: JOB },
    });
  });

  it("is none when the prompt is absent, blank or repeated", () => {
    expect(parseSeed({})).toEqual({ kind: "none" });
    expect(parseSeed({ lane: LANE, seed: JOB })).toEqual({ kind: "none" });
    expect(parseSeed({ prompt: "", lane: LANE, seed: JOB })).toEqual({ kind: "none" });
    expect(parseSeed({ prompt: "  \n ", lane: LANE, seed: JOB })).toEqual({ kind: "none" });
    expect(parseSeed({ prompt: ["a", "b"], lane: LANE, seed: JOB })).toEqual({ kind: "none" });
    expect(parseSeed(new URLSearchParams("prompt=a&prompt=b"))).toEqual({ kind: "none" });
  });

  it("is incomplete, with the trimmed prompt, when lane or seed is missing", () => {
    expect(parseSeed({ prompt: " a heron " })).toEqual({ kind: "incomplete", prompt: "a heron" });
    expect(parseSeed({ prompt: "a heron", seed: JOB })).toEqual({
      kind: "incomplete",
      prompt: "a heron",
    });
    expect(parseSeed({ prompt: "a heron", lane: LANE })).toEqual({
      kind: "incomplete",
      prompt: "a heron",
    });
  });

  it("is incomplete when an id is not a UUID", () => {
    expect(parseSeed({ prompt: "a heron", lane: LANE, seed: "not-a-uuid" })).toEqual({
      kind: "incomplete",
      prompt: "a heron",
    });
    expect(parseSeed({ prompt: "a heron", lane: "design-1", seed: JOB })).toEqual({
      kind: "incomplete",
      prompt: "a heron",
    });
    expect(parseSeed({ prompt: "a heron", lane: "", seed: JOB })).toEqual({
      kind: "incomplete",
      prompt: "a heron",
    });
  });

  it("is incomplete when lane or seed is repeated", () => {
    expect(parseSeed({ prompt: "a heron", lane: [LANE, LANE], seed: JOB })).toEqual({
      kind: "incomplete",
      prompt: "a heron",
    });
    expect(parseSeed(new URLSearchParams(`prompt=a&lane=${LANE}&seed=${JOB}&seed=${JOB}`))).toEqual({
      kind: "incomplete",
      prompt: "a",
    });
  });

  it("ignores the stage params", () => {
    expect(
      parseSeed({ prompt: "a", lane: LANE, seed: JOB, conversation: "c", image: "i" })
    ).toEqual({ kind: "complete", seed: { prompt: "a", designId: LANE, jobId: JOB } });
  });
});

describe("readSeedPrompt", () => {
  it("returns the trimmed single prompt, else null", () => {
    expect(readSeedPrompt({ prompt: "  a heron " })).toBe("a heron");
    expect(readSeedPrompt(new URLSearchParams("prompt=a+heron"))).toBe("a heron");
    expect(readSeedPrompt({})).toBeNull();
    expect(readSeedPrompt({ prompt: "   " })).toBeNull();
    expect(readSeedPrompt({ prompt: ["a", "b"] })).toBeNull();
  });
});

describe("the fired-seeds list", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  it("lives under one localStorage key and caps at 50", () => {
    expect(SEED_FIRED_STORAGE_KEY).toBe("studio-seeds-fired");
    expect(SEED_FIRED_CAP).toBe(50);
  });

  describe("parseFiredSeeds", () => {
    it("reads a JSON array of ids", () => {
      expect(parseFiredSeeds(JSON.stringify([id(1), id(2)]))).toEqual([id(1), id(2)]);
    });
    it("is empty for nothing stored", () => {
      expect(parseFiredSeeds(null)).toEqual([]);
      expect(parseFiredSeeds("")).toEqual([]);
    });
    it("counts a corrupt value as empty", () => {
      expect(parseFiredSeeds("{not json")).toEqual([]);
      expect(parseFiredSeeds('{"a":1}')).toEqual([]);
      expect(parseFiredSeeds('"text"')).toEqual([]);
      expect(parseFiredSeeds("null")).toEqual([]);
    });
    it("drops entries that are not strings", () => {
      expect(parseFiredSeeds(JSON.stringify([id(1), 7, null, { a: 1 }, id(2)]))).toEqual([
        id(1),
        id(2),
      ]);
    });
  });

  describe("isSeedFired", () => {
    it("is true only for an id on the list", () => {
      const raw = JSON.stringify([id(1), id(2)]);
      expect(isSeedFired(raw, id(2))).toBe(true);
      expect(isSeedFired(raw, id(3))).toBe(false);
      expect(isSeedFired(null, id(1))).toBe(false);
      expect(isSeedFired("{not json", id(1))).toBe(false);
    });
  });

  describe("markSeedFired", () => {
    it("appends the id, newest last", () => {
      const raw = markSeedFired(JSON.stringify([id(1)]), id(2));
      expect(JSON.parse(raw)).toEqual([id(1), id(2)]);
    });
    it("starts a list from nothing, and rewrites a corrupt value", () => {
      expect(JSON.parse(markSeedFired(null, id(1)))).toEqual([id(1)]);
      expect(JSON.parse(markSeedFired("{not json", id(1)))).toEqual([id(1)]);
    });
    it("does not list an id twice; marking again makes it the newest", () => {
      const raw = markSeedFired(JSON.stringify([id(1), id(2)]), id(1));
      expect(JSON.parse(raw)).toEqual([id(2), id(1)]);
    });
    it("keeps the newest 50", () => {
      let raw: string | null = null;
      for (let n = 1; n <= 60; n++) raw = markSeedFired(raw, id(n));
      const list = JSON.parse(raw as string) as string[];
      expect(list).toHaveLength(50);
      expect(list[0]).toBe(id(11));
      expect(list[49]).toBe(id(60));
      expect(isSeedFired(raw, id(10))).toBe(false);
      expect(isSeedFired(raw, id(11))).toBe(true);
    });
    it("trims an oversized stored list as well", () => {
      const big = JSON.stringify(Array.from({ length: 80 }, (_, i) => id(i + 1)));
      const list = JSON.parse(markSeedFired(big, id(500))) as string[];
      expect(list).toHaveLength(50);
      expect(list[49]).toBe(id(500));
      expect(list[0]).toBe(id(32));
    });
  });
});
