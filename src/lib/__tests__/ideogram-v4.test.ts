import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateTransparentV4, GENERATE_COST_PER_IMAGE, type V4JsonPrompt } from "../ideogram";

const JSON_PROMPT: V4JsonPrompt = {
  high_level_description: "A bear reading a book under a pine tree",
  style_description: { art_style: "woodcut illustration", color_palette: ["#1A2B3C"] },
  compositional_deconstruction: {
    background: "transparent background",
    elements: [
      { type: "obj", desc: "a bear seated with an open book" },
      { type: "text", text: "READ MORE", desc: "curved hand-carved lettering below" },
    ],
  },
};

function mockFetch(apiResponse: { ok?: boolean; status?: number; body?: unknown }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(apiResponse.body ?? {}), {
      status: apiResponse.ok === false ? (apiResponse.status ?? 500) : 200,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

describe("generateTransparentV4", () => {
  beforeEach(() => vi.stubEnv("IDEOGRAM_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("posts json_prompt as a JSON string with TURBO speed and NxM aspect", async () => {
    const { calls } = mockFetch({
      body: { response_type: "generated", created: "now", data: [{ url: "https://ideogram.ai/v4.png" }] },
    });
    const url = await generateTransparentV4(JSON_PROMPT, "4:5");
    expect(url).toBe("https://ideogram.ai/v4.png");
    expect(calls[0].url).toBe("https://api.ideogram.ai/v1/ideogram-v4/generate-transparent");
    expect((calls[0].init?.headers as Record<string, string>)["Api-Key"]).toBe("test-key");
    const fd = calls[0].init?.body as FormData;
    expect(JSON.parse(fd.get("json_prompt") as string)).toEqual(JSON_PROMPT);
    expect(fd.get("aspect_ratio")).toBe("4x5");
    expect(fd.get("rendering_speed")).toBe("TURBO");
    expect(fd.get("magic_prompt")).toBeNull();
    expect(fd.get("negative_prompt")).toBeNull();
  });

  it("defaults aspect to 1x1", async () => {
    const { calls } = mockFetch({
      body: { response_type: "generated", created: "now", data: [{ url: "https://x/y.png" }] },
    });
    await generateTransparentV4(JSON_PROMPT);
    expect(((calls[0].init?.body as FormData).get("aspect_ratio"))).toBe("1x1");
  });

  it("throws with status on non-OK response", async () => {
    mockFetch({ ok: false, status: 422, body: { error: "bad" } });
    await expect(generateTransparentV4(JSON_PROMPT)).rejects.toThrow(/422/);
  });

  it("throws when the response has no URL", async () => {
    mockFetch({ body: { response_type: "generated", created: "now", data: [] } });
    await expect(generateTransparentV4(JSON_PROMPT)).rejects.toThrow(/URL/i);
  });

  it("throws when IDEOGRAM_API_KEY is missing", async () => {
    vi.stubEnv("IDEOGRAM_API_KEY", "");
    mockFetch({ body: {} });
    await expect(generateTransparentV4(JSON_PROMPT)).rejects.toThrow(/IDEOGRAM_API_KEY/);
  });

  it("exports the per-generate cost", () => {
    expect(GENERATE_COST_PER_IMAGE).toBe(0.03);
  });
});
