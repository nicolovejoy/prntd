import { BENCH_HREF, one, type ParamSource } from "@/lib/studio-focus";
import { isUuid } from "@/lib/uuid";

/**
 * The landing page's idea, as the Studio takes it (#188 slice 2b). The
 * address carries its own ids: `lane` is the new conversation's id and `seed`
 * is the client job id of the one generation it fires. The Studio never
 * strips them from the URL (#311: a history write there races the server
 * action); instead the server's replay check on `(user, lane, seed)` makes a
 * second fire of the same address return the original job.
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

/** The sessionStorage key that marks a seed as fired in this tab. */
export function seedFiredKey(jobId: string): string {
  return `studio-seed:${jobId}`;
}
