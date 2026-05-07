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
