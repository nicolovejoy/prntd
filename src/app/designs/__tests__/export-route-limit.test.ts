// @vitest-environment node
/**
 * GET /designs/export when loadExportRows returns more than MAX_EXPORT_IMAGES
 * rows: the route must refuse with 413 before touching R2.
 */
import { describe, it, expect, vi } from "vitest";

const getObjectByKey = vi.fn(async (_key: string) => Buffer.from("x"));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({ user: { id: "u1", isAnonymous: false } }),
    },
  },
  isAnonymousUser: (user: { isAnonymous?: boolean }) => user.isAnonymous === true,
}));
vi.mock("@/lib/r2", () => ({
  getObjectByKey: (key: string) => getObjectByKey(key),
  imageKeyFromUrl: (url: string) => url.replace("https://r2/", ""),
}));
vi.mock("@/lib/design-export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/design-export")>();
  return {
    ...actual,
    loadExportRows: async () =>
      Array.from({ length: actual.MAX_EXPORT_IMAGES + 1 }, (_, i) => ({
        imageId: `img-${i}`,
        imageUrl: `https://r2/images/img-${i}.png`,
        r2Key: null,
        operation: "generate" as const,
        prompt: null,
        aspectRatio: "1:1",
        createdAt: new Date(),
      })),
  };
});

const { GET } = await import("../export/route");

const request = () => new Request("http://localhost/designs/export");

describe("GET /designs/export over the row limit", () => {
  it("answers 413 without reading R2", async () => {
    const res = await GET(request());
    expect(res.status).toBe(413);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(getObjectByKey).not.toHaveBeenCalled();
  });
});
