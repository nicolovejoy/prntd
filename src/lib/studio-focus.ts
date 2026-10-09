import type { StudioCell, StudioLane } from "@/lib/studio";

/**
 * The focused stage's address (#188 slice 4): which conversation and which
 * of its cells is shown. Both ids are needed — a seed image is a link, so
 * one image id can be a cell of two conversations.
 */
export type StudioFocus = { designId: string; imageId: string };

export const BENCH_HREF = "/studio";

type ParamSource =
  | { conversation?: string | string[]; image?: string | string[] }
  | URLSearchParams;

function one(source: ParamSource, key: "conversation" | "image"): string | null {
  if (source instanceof URLSearchParams) {
    const all = source.getAll(key);
    return all.length === 1 && all[0] !== "" ? all[0] : null;
  }
  const v = source[key];
  return typeof v === "string" && v !== "" ? v : null;
}

/** Both params present exactly once and non-empty, else null (the bench). */
export function parseFocus(source: ParamSource): StudioFocus | null {
  const designId = one(source, "conversation");
  const imageId = one(source, "image");
  return designId && imageId ? { designId, imageId } : null;
}

export function focusHref(focus: StudioFocus): string {
  const params = new URLSearchParams();
  params.set("conversation", focus.designId);
  params.set("image", focus.imageId);
  return `${BENCH_HREF}?${params.toString()}`;
}

/** The lane and cell index a focus names, or null when it names nothing on
 * the bench (closed conversation, foreign id, deleted image). */
export function resolveFocus(
  lanes: StudioLane[],
  focus: StudioFocus | null
): { lane: StudioLane; index: number } | null {
  if (!focus) return null;
  const lane = lanes.find((l) => l.designId === focus.designId);
  if (!lane) return null;
  const index = lane.cells.findIndex((c) => c.imageId === focus.imageId);
  return index === -1 ? null : { lane, index };
}

/** Where a lane's title links: the stage on its primary cell, else its newest
 * cell; null for a lane with no cells yet. */
export function laneStageHref(lane: StudioLane): string | null {
  const target = lane.cells.find((c) => c.isPrimary) ?? lane.cells[lane.cells.length - 1];
  return target ? focusHref({ designId: lane.designId, imageId: target.imageId }) : null;
}

/** "You" / "PRNTD", with " · Result N" when the turn's image is cell N. */
export function historyTurnLabel(
  turn: { role: "user" | "assistant"; imageId: string | null },
  cells: { imageId: string }[]
): string {
  const who = turn.role === "user" ? "You" : "PRNTD";
  if (!turn.imageId) return who;
  const n = cells.findIndex((c) => c.imageId === turn.imageId);
  return n === -1 ? who : `${who} · Result ${n + 1}`;
}

/** The newest cell the stage has not shown yet — a landed result to follow. */
export function newestUnseenCell(
  lane: StudioLane,
  seen: ReadonlySet<string>
): StudioCell | null {
  for (let i = lane.cells.length - 1; i >= 0; i--) {
    const c = lane.cells[i];
    if (!seen.has(c.imageId)) return c;
  }
  return null;
}
