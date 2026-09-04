/**
 * What an image row's `prompt` means, and how to say it to a model (#169).
 *
 * Since edit-as-operation (#168) `image.prompt` is a scene summary for a
 * generate and an edit INSTRUCTION for an edit ("make the bear larger; keep
 * the lettering"). Two consumers used to read it as a scene description: the
 * published-naming call and the chat gallery/history context. Both now go
 * through here.
 *
 * Everything in this module is pure — the caller supplies the rows. The DB
 * side (loading an edit's ancestors) lives in design-images.ts.
 */
import { parseDesignSpec, renderSpecSummary, type DesignSpec } from "./design-spec";

export type ImageOperation = "generate" | "edit" | "upload";

/**
 * The provenance-relevant slice of an `image` row. `operation` null = a row
 * written before #169 (no backfill) — treated as a generate whose spec is
 * unknown, which lands on the legacy prompt-only behaviour everywhere.
 */
export type ProvenanceNode = {
  id: string;
  operation: ImageOperation | null;
  designSpec: DesignSpec | null;
  prompt: string | null;
  parentImageId: string | null;
};

/**
 * How far up the parent chain an edit looks for the generate that started it.
 * A chain longer than this is a user who kept iterating; the older context
 * stops earning its tokens well before then.
 */
export const PROVENANCE_MAX_DEPTH = 10;

/**
 * Validate a spec read back out of `image.design_spec_json`. The column is
 * `.$type<DesignSpec>()`, which is a compile-time claim about rows we wrote —
 * it guarantees nothing about a row hand-edited, half-written by an older
 * shape, or restored from a backup. renderSpecSummary assumes `elements` is
 * an array, so an unvalidated read could throw inside the chat gallery and
 * take out a whole turn. Anything that doesn't parse degrades to null, which
 * is the legacy/prompt-only path everywhere in this module.
 */
export function sanitizeStoredSpec(value: unknown): DesignSpec | null {
  return parseDesignSpec(value);
}

function summarize(node: ProvenanceNode): string | null {
  const spec = sanitizeStoredSpec(node.designSpec);
  return spec ? renderSpecSummary(spec) : null;
}

function legacyPromptContext(prompt: string | null): string | null {
  const text = prompt?.trim();
  return text ? `Prompt used to generate this image:\n${text}` : null;
}

/**
 * The chain of nodes from `startId` up to (and including) the nearest ancestor
 * carrying a design spec, capped at PROVENANCE_MAX_DEPTH nodes. Oldest first.
 *
 * Returns the nodes it could walk even when no spec was found — the caller
 * decides what a spec-less chain degrades to. Cycle-safe (a parent pointer
 * that loops stops the walk).
 */
export function specAncestry(
  startId: string,
  byId: ReadonlyMap<string, ProvenanceNode>
): ProvenanceNode[] {
  const chain: ProvenanceNode[] = [];
  const seen = new Set<string>();
  let current = byId.get(startId);
  while (current && !seen.has(current.id) && chain.length < PROVENANCE_MAX_DEPTH) {
    seen.add(current.id);
    chain.push(current);
    if (sanitizeStoredSpec(current.designSpec)) break;
    current = current.parentImageId
      ? byId.get(current.parentImageId)
      : undefined;
  }
  return chain.reverse();
}

/**
 * The text describing an image to the titling model (generatePublishedNaming).
 *
 *  - generate with a spec → the spec summary;
 *  - edit → the nearest ancestor's spec summary plus every edit instruction
 *    down to this image, oldest first, so the title reflects what the picture
 *    became rather than the last tweak applied to it;
 *  - upload, a legacy row, or an edit whose ancestry is missing or deeper than
 *    the cap → today's behaviour, the row's own prompt.
 *
 * Null when there is nothing worth sending (no spec, no prompt).
 */
export function buildNamingContext(
  startId: string,
  byId: ReadonlyMap<string, ProvenanceNode>
): string | null {
  const node = byId.get(startId);
  if (!node) return null;

  if (node.operation === "edit") {
    const chain = specAncestry(startId, byId);
    const root = chain[0];
    const rootSummary = root ? summarize(root) : null;
    if (rootSummary) {
      const edits = chain
        .slice(1)
        .map((n) => n.prompt?.trim())
        .filter((p): p is string => Boolean(p));
      if (edits.length === 0) return `Original design: ${rootSummary}.`;
      return `Original design: ${rootSummary}. Later edits applied: ${edits.join("; ")}`;
    }
    return legacyPromptContext(node.prompt);
  }

  const summary = summarize(node);
  if (node.operation === "generate" && summary) {
    return `Prompt used to generate this image:\n${summary}`;
  }
  return legacyPromptContext(node.prompt);
}

/**
 * One line of chat context for an image: what it is, not just its prompt
 * string. Fed to the gallery listing and to the assistant turn that produced
 * the image, so a later turn reading "make the bear larger" knows it is an
 * edit instruction and not a description of the picture.
 */
export function imageContextLabel(node: ProvenanceNode): string {
  const prompt = node.prompt?.trim() ?? "";
  if (node.operation === "edit") {
    return prompt ? `Edit applied: ${prompt}` : "Edit applied";
  }
  if (node.operation === "upload") {
    return prompt ? `Uploaded: ${prompt}` : "Uploaded";
  }
  if (node.operation === "generate") {
    const summary = summarize(node) ?? prompt;
    return summary ? `Generated from: ${summary}` : "Generated";
  }
  // Legacy row (operation null): today's wording, unchanged.
  return prompt;
}

/**
 * One "Images so far" line for the chat gallery. Legacy rows keep the exact
 * quoted-prompt shape the prompt has always shown; labelled ones say what the
 * entry is.
 */
export function imageGalleryLine(
  node: ProvenanceNode,
  number: number
): string {
  if (node.operation === null) return `#${number}: "${node.prompt ?? ""}"`;
  return `#${number}: ${imageContextLabel(node)}`;
}

/**
 * The note appended to the assistant turn that produced an image, so history
 * carries what the image is. Null when there is nothing to say.
 */
export function imageHistoryNote(node: ProvenanceNode): string | null {
  if (node.operation === null) {
    const prompt = node.prompt?.trim();
    return prompt ? `Prompt used: ${prompt}` : null;
  }
  return imageContextLabel(node) || null;
}
