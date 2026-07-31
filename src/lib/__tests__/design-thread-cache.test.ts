/**
 * The thread-snapshot mapping feeding the /design mount paths (warm #87,
 * server payload, revisit write-back #127). The invariant under test: a
 * snapshot always carries chat AND gallery together, and gallery numbering
 * matches the live refresh path.
 */
import { describe, it, expect } from "vitest";
import { threadToSnapshot } from "@/lib/design-thread-cache";
import type { DesignThreadData } from "@/lib/design-thread";
import type { ChatMessage } from "@/lib/db/schema";
import type { SourceImage } from "@/lib/design-images";

function msg(content: string): ChatMessage {
  return {
    id: `m-${content}`,
    designId: "d1",
    role: "user",
    content,
    imageId: null,
    createdAt: new Date(),
  };
}

function source(id: string, role: "output" | "seed" = "output"): SourceImage {
  return {
    id,
    imageUrl: `https://r2/${id}.png`,
    aspectRatio: "1:1",
    prompt: null,
    createdAt: new Date(),
    publishedAt: null,
    role,
  };
}

describe("threadToSnapshot", () => {
  it("maps chat + sources + groups into the page-state shape", () => {
    const thread: DesignThreadData = {
      design: { displayImageUrl: "https://r2/b.png", closedAt: null },
      chat: [msg("hi")],
      sources: [source("a"), source("b", "seed")],
      productGroups: [],
    };

    const snap = threadToSnapshot(thread);
    expect(snap.chat).toHaveLength(1);
    expect(snap.images).toEqual([
      {
        id: "a",
        number: 1,
        url: "https://r2/a.png",
        prompt: "",
        publishedAt: null,
        role: "output",
      },
      {
        id: "b",
        number: 2,
        url: "https://r2/b.png",
        prompt: "",
        publishedAt: null,
        role: "seed",
      },
    ]);
    expect(snap.displayImageUrl).toBe("https://r2/b.png");
    expect(snap.closed).toBe(false);
  });

  it("flags a closed thread", () => {
    const thread: DesignThreadData = {
      design: { displayImageUrl: null, closedAt: new Date() },
      chat: [],
      sources: [],
      productGroups: [],
    };
    expect(threadToSnapshot(thread).closed).toBe(true);
  });
});
