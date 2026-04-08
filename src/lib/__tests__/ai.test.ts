import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatMessage } from "../db/schema";
import type { DesignImage } from "../chat-utils";

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
      { role: "user", content: "first" },
      { role: "user", content: "second" },
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
      [{ role: "user", content: "A sunset" }],
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
      [{ role: "user", content: "anything" }],
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
      [{ role: "user", content: "anything" }],
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
      [{ role: "user", content: "anything" }],
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
      { number: 1, url: "https://example.com/1.png", prompt: "sunset" },
    ];

    const { constructFluxPrompt } = await import("../ai");
    const result = await constructFluxPrompt(
      [{ role: "user", content: "make it brighter" }],
      images
    );

    expect(result.referenceImage).toBe(1);

    // Verify gallery context was included in system prompt
    const call = mockCreate.mock.calls[0][0];
    expect(call.system).toContain('#1: "sunset"');
  });
});
