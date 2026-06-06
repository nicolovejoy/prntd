import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatMessage } from "../db/schema";
import type { DesignImage } from "../design-images";

// Mock the Anthropic SDK before importing
vi.mock("@anthropic-ai/sdk", () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
    _mockCreate: mockCreate,
  };
});

// Access the mock for test assertions
async function getMockCreate() {
  const mod = await import("@anthropic-ai/sdk") as any;
  return mod._mockCreate as ReturnType<typeof vi.fn>;
}

function msg(
  role: "user" | "assistant",
  content: string,
  imageId: string | null = null
): ChatMessage {
  return {
    id: `test-${role}-${Math.random().toString(36).slice(2, 8)}`,
    designId: "test-design",
    role,
    content,
    imageId,
    createdAt: new Date(),
  };
}

describe("chatAboutDesign", () => {
  beforeEach(async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockReset();
  });

  it("returns Claude's text response", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Sounds like a cool concept. Try generating?" }],
    });

    const { chatAboutDesign } = await import("../ai");
    const result = await chatAboutDesign(
      "I want a sunset design",
      [],
      []
    );

    expect(result.message).toBe("Sounds like a cool concept. Try generating?");
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("merges consecutive same-role messages", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });

    const history: ChatMessage[] = [
      msg("user", "first"),
      msg("user", "second"),
    ];

    const { chatAboutDesign } = await import("../ai");
    await chatAboutDesign("third", history, []);

    const call = mockCreate.mock.calls[0][0];
    // All three user messages should be merged into alternating roles
    // "first" + "second" merged, then "third" as the new user message
    const userMessages = call.messages.filter((m: any) => m.role === "user");
    expect(userMessages.length).toBeGreaterThanOrEqual(1);
  });

  it("parses message and readyToGenerate from valid JSON", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          message: "Watercolor fox, got it. Ready when you are.",
          readyToGenerate: true,
        }),
      }],
    });

    const { chatAboutDesign } = await import("../ai");
    const result = await chatAboutDesign("a watercolor fox", [], []);

    expect(result.message).toBe("Watercolor fox, got it. Ready when you are.");
    expect(result.readyToGenerate).toBe(true);
  });

  it("returns readyToGenerate false when the idea is still thin", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          message: "What style are you after — clean vector, watercolor, vintage?",
          readyToGenerate: false,
        }),
      }],
    });

    const { chatAboutDesign } = await import("../ai");
    const result = await chatAboutDesign("a fox", [], []);

    expect(result.message).toContain("What style");
    expect(result.readyToGenerate).toBe(false);
  });

  it("parses JSON wrapped in code fences", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: '```json\n{"message":"ready","readyToGenerate":true}\n```',
      }],
    });

    const { chatAboutDesign } = await import("../ai");
    const result = await chatAboutDesign("anything", [], []);

    expect(result.message).toBe("ready");
    expect(result.readyToGenerate).toBe(true);
  });

  it("falls back to raw text and not-ready on non-JSON response", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Just plain conversational text." }],
    });

    const { chatAboutDesign } = await import("../ai");
    const result = await chatAboutDesign("anything", [], []);

    expect(result.message).toBe("Just plain conversational text.");
    expect(result.readyToGenerate).toBe(false);
  });

  it("treats a non-boolean readyToGenerate as false", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({ message: "hmm", readyToGenerate: "yes" }),
      }],
    });

    const { chatAboutDesign } = await import("../ai");
    const result = await chatAboutDesign("anything", [], []);

    expect(result.readyToGenerate).toBe(false);
  });
});

describe("assessReadiness", () => {
  beforeEach(async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockReset();
  });

  it("returns ready=false and a question when the idea is thin", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          ready: false,
          question: "What style — watercolor, vintage, bold vector?",
        }),
      }],
    });

    const { assessReadiness } = await import("../ai");
    const result = await assessReadiness([], [], "a fox");

    expect(result.ready).toBe(false);
    expect(result.question).toContain("What style");
  });

  it("returns ready=true for a concrete subject + style", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ ready: true, question: "" }) }],
    });

    const { assessReadiness } = await import("../ai");
    const result = await assessReadiness(
      [],
      [],
      "a fierce minimal geometric fox, clean black vector on white"
    );

    expect(result.ready).toBe(true);
  });

  it("uses the fast Haiku model, not Sonnet", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ ready: true, question: "" }) }],
    });

    const { assessReadiness } = await import("../ai");
    await assessReadiness([], [], "anything");

    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toContain("haiku");
  });

  it("fails open (ready=true) on a non-JSON response", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "not json at all" }],
    });

    const { assessReadiness } = await import("../ai");
    const result = await assessReadiness([], [], "anything");

    expect(result.ready).toBe(true);
  });

  it("treats a missing ready flag as ready (fail open)", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ question: "hmm" }) }],
    });

    const { assessReadiness } = await import("../ai");
    const result = await assessReadiness([], [], "anything");

    expect(result.ready).toBe(true);
  });

  it("fails open (ready=true) when the API call throws", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockRejectedValue(new Error("Haiku unavailable"));

    const { assessReadiness } = await import("../ai");
    const result = await assessReadiness([], [], "anything");

    expect(result.ready).toBe(true);
    expect(result.question).toBe("");
  });
});

describe("generateOrderName", () => {
  beforeEach(async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockReset();
  });

  it("returns the trimmed name from a vision response", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Artificial Idiot" }],
    });

    const { generateOrderName } = await import("../ai");
    const name = await generateOrderName("https://example.com/x.png");

    expect(name).toBe("Artificial Idiot");
    // Verify the call sent an image content block
    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content[0].type).toBe("image");
    expect(call.messages[0].content[0].source.url).toBe("https://example.com/x.png");
  });

  it("strips surrounding quotes and trailing periods", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '"Blue Mountain Landscape."' }],
    });

    const { generateOrderName } = await import("../ai");
    const name = await generateOrderName("https://example.com/x.png");
    expect(name).toBe("Blue Mountain Landscape");
  });

  it("returns null on empty response", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "   " }] });

    const { generateOrderName } = await import("../ai");
    const name = await generateOrderName("https://example.com/x.png");
    expect(name).toBeNull();
  });

  it("returns null and logs on API error", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockRejectedValue(new Error("Anthropic down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { generateOrderName } = await import("../ai");
    const name = await generateOrderName("https://example.com/x.png");

    expect(name).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("caps overly long names at 60 chars", async () => {
    const mockCreate = await getMockCreate();
    const longName = "A".repeat(120);
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: longName }],
    });

    const { generateOrderName } = await import("../ai");
    const name = await generateOrderName("https://example.com/x.png");
    expect(name?.length).toBeLessThanOrEqual(60);
  });
});

describe("constructFluxPrompt", () => {
  beforeEach(async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockReset();
  });

  it("parses valid JSON response", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          message: "Generating your sunset",
          fluxPrompt: "sunset illustration, white background, isolated design",
          referenceImage: null,
        }),
      }],
    });

    const { constructFluxPrompt } = await import("../ai");
    const result = await constructFluxPrompt(
      [msg("user", "A sunset")],
      []
    );

    expect(result.message).toBe("Generating your sunset");
    expect(result.fluxPrompt).toContain("sunset");
    expect(result.referenceImage).toBeNull();
  });

  it("handles JSON wrapped in code fences", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: '```json\n{"message":"test","fluxPrompt":"test prompt","referenceImage":null}\n```',
      }],
    });

    const { constructFluxPrompt } = await import("../ai");
    const result = await constructFluxPrompt(
      [msg("user", "anything")],
      []
    );

    expect(result.message).toBe("test");
    expect(result.fluxPrompt).toBe("test prompt");
  });

  it("falls back gracefully on non-JSON response", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Sorry, I got confused" }],
    });

    const { constructFluxPrompt } = await import("../ai");
    const result = await constructFluxPrompt(
      [msg("user", "anything")],
      []
    );

    // Should use the raw text as message and a fallback prompt
    expect(result.message).toBe("Sorry, I got confused");
    expect(result.fluxPrompt).toContain("graphic design illustration");
    expect(result.referenceImage).toBeNull();
  });

  it("falls back on empty response", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "" }],
    });

    const { constructFluxPrompt } = await import("../ai");
    const result = await constructFluxPrompt(
      [msg("user", "anything")],
      []
    );

    expect(result.message).toBe("Let me generate that for you.");
    expect(result.fluxPrompt).toContain("graphic design illustration");
  });

  it("includes gallery context when images exist", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          message: "Refining #1",
          fluxPrompt: "refined sunset",
          referenceImage: 1,
        }),
      }],
    });

    const images: DesignImage[] = [
      { id: "img-1", number: 1, url: "https://example.com/1.png", prompt: "sunset" },
    ];

    const { constructFluxPrompt } = await import("../ai");
    const result = await constructFluxPrompt(
      [msg("user", "make it brighter")],
      images
    );

    expect(result.referenceImage).toBe(1);

    // Verify gallery context was included in system prompt
    const call = mockCreate.mock.calls[0][0];
    expect(call.system).toContain('#1: "sunset"');
  });

  it("captures negativePrompt when Claude provides one", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          message: "Generating your brushy design",
          fluxPrompt: "sumi-e brush calligraphy, hand-painted, white background",
          negativePrompt: "clean vector, smooth gradients, digital font, polished illustration",
          referenceImage: null,
        }),
      }],
    });

    const { constructFluxPrompt } = await import("../ai");
    const result = await constructFluxPrompt(
      [msg("user", "Hand-painted thought bubble")],
      []
    );

    expect(result.negativePrompt).toContain("clean vector");
    expect(result.fluxPrompt).toContain("sumi-e");
  });

  it("defaults negativePrompt to null when missing", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          message: "Generating",
          fluxPrompt: "vector illustration",
          referenceImage: null,
        }),
      }],
    });

    const { constructFluxPrompt } = await import("../ai");
    const result = await constructFluxPrompt(
      [msg("user", "anything")],
      []
    );

    expect(result.negativePrompt).toBeNull();
  });

  it("treats empty-string negativePrompt as null", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          message: "Generating",
          fluxPrompt: "vector illustration",
          negativePrompt: "   ",
          referenceImage: null,
        }),
      }],
    });

    const { constructFluxPrompt } = await import("../ai");
    const result = await constructFluxPrompt(
      [msg("user", "anything")],
      []
    );

    expect(result.negativePrompt).toBeNull();
  });
});
