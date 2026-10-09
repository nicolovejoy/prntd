import { describe, it, expect } from "vitest";
import type { StudioLane } from "@/lib/studio";
import {
  BENCH_HREF,
  focusHref,
  historyTurnLabel,
  laneStageHref,
  newestUnseenCell,
  parseFocus,
  resolveFocus,
} from "@/lib/studio-focus";

function cell(imageId: string, isPrimary = false) {
  return { imageId, imageUrl: `https://cdn.example/${imageId}.png`, isPrimary, createdAt: new Date(), backdropColor: null };
}
function lane(designId: string, cells: ReturnType<typeof cell>[]): StudioLane {
  return { designId, title: null, lastActiveAt: new Date(), messageCount: 0, cells, pending: [] };
}

describe("parseFocus", () => {
  it("reads both params from a searchParams object", () => {
    expect(parseFocus({ conversation: "d1", image: "i1" })).toEqual({ designId: "d1", imageId: "i1" });
  });
  it("reads both params from URLSearchParams", () => {
    expect(parseFocus(new URLSearchParams("conversation=d1&image=i1"))).toEqual({ designId: "d1", imageId: "i1" });
  });
  it("is null when either is missing, empty, or repeated", () => {
    expect(parseFocus({ conversation: "d1" })).toBeNull();
    expect(parseFocus({ image: "i1" })).toBeNull();
    expect(parseFocus({ conversation: "", image: "i1" })).toBeNull();
    expect(parseFocus({ conversation: ["d1", "d2"], image: "i1" })).toBeNull();
    expect(parseFocus({})).toBeNull();
  });
});

describe("focusHref", () => {
  it("builds the stage URL, encoded", () => {
    expect(focusHref({ designId: "d 1", imageId: "i&1" })).toBe("/studio?conversation=d+1&image=i%261");
    expect(BENCH_HREF).toBe("/studio");
  });
});

describe("resolveFocus", () => {
  it("finds the cell in the named conversation, not the first lane holding the image", () => {
    const seed = cell("shared");
    const lanes = [lane("d1", [seed, cell("a")]), lane("d2", [seed])];
    expect(resolveFocus(lanes, { designId: "d2", imageId: "shared" })).toEqual({ lane: lanes[1], index: 0 });
    expect(resolveFocus(lanes, { designId: "d1", imageId: "a" })).toEqual({ lane: lanes[0], index: 1 });
  });
  it("is null for a missing lane, a missing cell, or no focus", () => {
    const lanes = [lane("d1", [cell("a")])];
    expect(resolveFocus(lanes, { designId: "d9", imageId: "a" })).toBeNull();
    expect(resolveFocus(lanes, { designId: "d1", imageId: "zz" })).toBeNull();
    expect(resolveFocus(lanes, null)).toBeNull();
  });
});

describe("laneStageHref", () => {
  it("prefers the primary cell, else the newest, else null", () => {
    expect(laneStageHref(lane("d1", [cell("a"), cell("b", true), cell("c")]))).toBe("/studio?conversation=d1&image=b");
    expect(laneStageHref(lane("d1", [cell("a"), cell("c")]))).toBe("/studio?conversation=d1&image=c");
    expect(laneStageHref(lane("d1", []))).toBeNull();
  });
});

describe("historyTurnLabel", () => {
  const cells = [cell("a"), cell("b"), cell("c")];
  it("names the speaker and the result the turn carries", () => {
    expect(historyTurnLabel({ role: "user", imageId: null }, cells)).toBe("You");
    expect(historyTurnLabel({ role: "assistant", imageId: null }, cells)).toBe("PRNTD");
    expect(historyTurnLabel({ role: "assistant", imageId: "c" }, cells)).toBe("PRNTD · Result 3");
    expect(historyTurnLabel({ role: "user", imageId: "a" }, cells)).toBe("You · Result 1");
  });
  it("ignores an image that is not a cell of this conversation", () => {
    expect(historyTurnLabel({ role: "assistant", imageId: "gone" }, cells)).toBe("PRNTD");
  });
});

describe("newestUnseenCell", () => {
  it("returns the last cell whose id is not in `seen`, else null", () => {
    const l = lane("d1", [cell("a"), cell("b"), cell("c")]);
    expect(newestUnseenCell(l, new Set(["a", "b"]))?.imageId).toBe("c");
    expect(newestUnseenCell(l, new Set(["a", "b", "c"]))).toBeNull();
    expect(newestUnseenCell(l, new Set())?.imageId).toBe("c");
  });
});
