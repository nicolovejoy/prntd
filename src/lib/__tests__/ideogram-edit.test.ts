import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { editTransparent, EDIT_COST_PER_IMAGE } from "../ideogram";

const ANCHOR_URL = "https://pub-test.r2.dev/images/abc.png";
const ANCHOR_BYTES = new Uint8Array([137, 80, 78, 71]); // PNG magic

function mockFetchSequence(apiResponse: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  anchorOk?: boolean;
}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url) === ANCHOR_URL) {
      return new Response(apiResponse.anchorOk === false ? null : ANCHOR_BYTES, {
        status: apiResponse.anchorOk === false ? 404 : 200,
      });
    }
    return new Response(JSON.stringify(apiResponse.body ?? {}), {
      status: apiResponse.ok === false ? (apiResponse.status ?? 500) : 200,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

describe("editTransparent", () => {
  beforeEach(() => {
    vi.stubEnv("IDEOGRAM_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("posts multipart to /v1/edit with anchor bytes, transparency on, magic prompt off", async () => {
    const { calls } = mockFetchSequence({
      body: { created: "now", data: [{ url: "https://ideogram.ai/out.png" }] },
    });

    const url = await editTransparent("make the bear larger", ANCHOR_URL, "4:5");

    expect(url).toBe("https://ideogram.ai/out.png");
    expect(calls[0].url).toBe(ANCHOR_URL);
    expect(calls[1].url).toBe("https://api.ideogram.ai/v1/edit");
    const headers = calls[1].init?.headers as Record<string, string>;
    expect(headers["Api-Key"]).toBe("test-key");
    const fd = calls[1].init?.body as FormData;
    expect(fd.get("prompt")).toBe("make the bear larger");
    expect(fd.get("aspect_ratio")).toBe("4x5");
    expect(fd.get("magic_prompt")).toBe("OFF");
    expect(fd.get("transparent_background")).toBe("true");
    const image = fd.get("images");
    expect(image).toBeInstanceOf(Blob);
    expect((image as Blob).type).toBe("image/png");
  });

  it("defaults aspect ratio to 1x1", async () => {
    const { calls } = mockFetchSequence({
      body: { created: "now", data: [{ url: "https://ideogram.ai/out.png" }] },
    });
    await editTransparent("edit", ANCHOR_URL);
    const fd = calls[1].init?.body as FormData;
    expect(fd.get("aspect_ratio")).toBe("1x1");
  });

  it("throws when the anchor download fails", async () => {
    mockFetchSequence({ anchorOk: false });
    await expect(editTransparent("edit", ANCHOR_URL)).rejects.toThrow(/anchor/i);
  });

  it("throws with status on a non-OK API response", async () => {
    mockFetchSequence({ ok: false, status: 422, body: { error: "bad" } });
    await expect(editTransparent("edit", ANCHOR_URL)).rejects.toThrow(/422/);
  });

  it("throws when the response has no image URL", async () => {
    mockFetchSequence({ body: { created: "now", data: [] } });
    await expect(editTransparent("edit", ANCHOR_URL)).rejects.toThrow(/URL/i);
  });

  it("throws when IDEOGRAM_API_KEY is missing", async () => {
    vi.stubEnv("IDEOGRAM_API_KEY", "");
    mockFetchSequence({ body: {} });
    await expect(editTransparent("edit", ANCHOR_URL)).rejects.toThrow(/IDEOGRAM_API_KEY/);
  });

  it("exports the per-edit cost for accounting", () => {
    expect(EDIT_COST_PER_IMAGE).toBe(0.2);
  });
});
