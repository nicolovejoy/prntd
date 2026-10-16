import { describe, it, expect } from "vitest";
import { BENCH_HREF } from "@/lib/studio-focus";
import {
  parseSeed,
  readSeedPrompt,
  seedFiredKey,
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

describe("seedFiredKey", () => {
  it("namespaces the sessionStorage key by the seed's job id", () => {
    expect(seedFiredKey(JOB)).toBe(`studio-seed:${JOB}`);
  });
});
