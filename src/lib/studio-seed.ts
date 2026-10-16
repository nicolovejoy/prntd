import { BENCH_HREF, one, type ParamSource } from "@/lib/studio-focus";
import { isUuid } from "@/lib/uuid";

/**
 * The landing page's idea, as the Studio takes it (#188 slice 2b). The
 * address carries its own ids: `lane` is the new conversation's id and `seed`
 * is the client job id of the one generation it fires. The Studio never
 * strips them from the URL (#311: a history write there races the server
 * action). A fire is remembered instead: in localStorage, as a capped list of
 * seed job ids (below), so a reload, a remount from the bfcache and an address
 * reopened in another tab of this browser do not fire it again. The server's
 * replay check on `(user, lane, seed)` stays the authority: it returns the
 * original job when storage is unavailable or the mark is lost.
 */
export type StudioSeed = { prompt: string; designId: string; jobId: string };

export type ParsedSeed =
  | { kind: "none" }
  | { kind: "incomplete"; prompt: string }
  | { kind: "complete"; seed: StudioSeed };

/** The `prompt` param, trimmed: present exactly once and not blank, else
 * null. The one rule /studio and /design both use for "is there an idea". */
export function readSeedPrompt(source: ParamSource): string | null {
  const raw = one(source, "prompt");
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The Studio address for an idea. A blank prompt is the bench. Each id that
 * is not given is minted here, so a caller with only a prompt (the landing
 * hero's hop through /design, an old link) gets a complete seed.
 */
export function seedHref(
  prompt: string | null | undefined,
  ids: { designId?: string; jobId?: string } = {}
): string {
  const trimmed = prompt?.trim();
  if (!trimmed) return BENCH_HREF;
  const params = new URLSearchParams();
  params.set("prompt", trimmed);
  params.set("lane", ids.designId ?? crypto.randomUUID());
  params.set("seed", ids.jobId ?? crypto.randomUUID());
  return `${BENCH_HREF}?${params.toString()}`;
}

/**
 * Reads a seed off a Studio address. `none` when there is no usable prompt.
 * `complete` only when `lane` and `seed` are each present once and are UUIDs;
 * anything else with a prompt is `incomplete`, and the page redirects it to a
 * complete address (R3).
 */
export function parseSeed(source: ParamSource): ParsedSeed {
  const prompt = readSeedPrompt(source);
  if (!prompt) return { kind: "none" };
  const designId = one(source, "lane");
  const jobId = one(source, "seed");
  if (isUuid(designId) && isUuid(jobId)) {
    return { kind: "complete", seed: { prompt, designId, jobId } };
  }
  return { kind: "incomplete", prompt };
}

/** The one localStorage key that holds the fired seeds. */
export const SEED_FIRED_STORAGE_KEY = "studio-seeds-fired";
/** How many seed job ids the list keeps; the oldest drop first. */
export const SEED_FIRED_CAP = 50;

/**
 * The stored list: a JSON array of seed job ids, newest last. Nothing stored,
 * a value that is not JSON, or JSON that is not an array counts as empty;
 * entries that are not strings are dropped. Callers read and write storage
 * themselves (each access in try/catch) and pass the raw string here.
 */
export function parseFiredSeeds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

/** Whether `jobId` is on the stored list. */
export function isSeedFired(raw: string | null | undefined, jobId: string): boolean {
  return parseFiredSeeds(raw).includes(jobId);
}

/** The list to store after firing `jobId`: it goes last (a repeat moves it
 * there), and only the newest SEED_FIRED_CAP stay. */
export function markSeedFired(raw: string | null | undefined, jobId: string): string {
  const next = [...parseFiredSeeds(raw).filter((id) => id !== jobId), jobId];
  return JSON.stringify(next.slice(-SEED_FIRED_CAP));
}
