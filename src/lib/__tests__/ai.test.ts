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
    // "first", "second" (history) and "third" (the new turn) are all user
    // role with nothing in between, so buildMessages must collapse them into
    // a single alternating-role message — Anthropic rejects consecutive
    // same-role messages.
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0].role).toBe("user");
    expect(call.messages[0].content).toBe("first\n\nsecond\n\nthird");
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

  it("salvages the envelope when the model emits prose followed by JSON", async () => {
    const mockCreate = await getMockCreate();
    const prose = "Got it — yin-yang floss dance.\n\nWhat **style**?";
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: `${prose}\n\n${JSON.stringify({ message: prose, readyToGenerate: true })}`,
      }],
    });

    const { chatAboutDesign } = await import("../ai");
    const result = await chatAboutDesign("anything", [], []);

    // The envelope's message only — never the doubled prose+JSON blob.
    expect(result.message).toBe(prose);
    expect(result.readyToGenerate).toBe(true);
  });

  it("strips an embedded envelope from assistant history before resending", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: '{"message":"ok","readyToGenerate":false}',
      }],
    });

    // A polluted row: a past parse failure stored prose + raw envelope.
    const polluted = `Pick a style.\n\n{ "message": "Pick a style.", "readyToGenerate": false }`;
    const { chatAboutDesign } = await import("../ai");
    await chatAboutDesign(
      "vintage",
      [msg("user", "a wolf"), msg("assistant", polluted)],
      []
    );

    const sent = mockCreate.mock.calls[0][0].messages;
    const assistant = sent.find((m: { role: string }) => m.role === "assistant");
    expect(assistant.content).toBe("Pick a style.");
    expect(assistant.content).not.toContain("readyToGenerate");
  });
});

describe("chatAboutDesign options", () => {
  beforeEach(async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockReset();
  });

  it("parses tappable options from the envelope", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          message: "What style?",
          readyToGenerate: false,
          options: [
            { label: "Watercolor", value: "Make it watercolor" },
            { label: "Bold vector", value: "Go bold vector" },
          ],
        }),
      }],
    });

    const { chatAboutDesign } = await import("../ai");
    const result = await chatAboutDesign("a fox", [], []);

    expect(result.options).toEqual([
      { label: "Watercolor", value: "Make it watercolor" },
      { label: "Bold vector", value: "Go bold vector" },
    ]);
  });

  it("returns empty options when the field is absent (back-compat)", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ message: "ok", readyToGenerate: true }) }],
    });

    const { chatAboutDesign } = await import("../ai");
    const result = await chatAboutDesign("anything", [], []);
    expect(result.options).toEqual([]);
  });

  it("salvages chips when the model lists choices in prose with empty options", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          message: "Nice — a fox it is. What style are you after?\n\n1. Watercolor\n2. Vintage\n3. Bold vector",
          readyToGenerate: false,
          options: [],
        }),
      }],
    });

    const { chatAboutDesign } = await import("../ai");
    const result = await chatAboutDesign("a fox", [], []);

    expect(result.options).toEqual([
      { label: "Watercolor", value: "Watercolor" },
      { label: "Vintage", value: "Vintage" },
      { label: "Bold vector", value: "Bold vector" },
    ]);
    // The list is stripped from the prose; the question survives.
    expect(result.message).toBe("Nice — a fox it is. What style are you after?");
  });

  it("never overrides structured options with the prose fallback", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          message: "Pick one:\n1. Watercolor\n2. Vintage",
          readyToGenerate: false,
          options: [{ label: "Halftone", value: "Halftone screen-print" }],
        }),
      }],
    });

    const { chatAboutDesign } = await import("../ai");
    const result = await chatAboutDesign("a fox", [], []);

    expect(result.options).toEqual([
      { label: "Halftone", value: "Halftone screen-print" },
    ]);
    expect(result.message).toContain("1. Watercolor");
  });
});

describe("extractProseOptions", () => {
  it("converts a trailing numbered list of short choices", async () => {
    const { extractProseOptions } = await import("../ai");
    const result = extractProseOptions(
      "What style do you want?\n\n1. Watercolor\n2. Vintage\n3. Bold vector"
    );
    expect(result?.message).toBe("What style do you want?");
    expect(result?.options).toEqual([
      { label: "Watercolor", value: "Watercolor" },
      { label: "Vintage", value: "Vintage" },
      { label: "Bold vector", value: "Bold vector" },
    ]);
  });

  it("converts hyphen bullets", async () => {
    const { extractProseOptions } = await import("../ai");
    const result = extractProseOptions(
      "Which direction?\n- Hand-drawn ink\n- Vintage screen-print"
    );
    expect(result?.message).toBe("Which direction?");
    expect(result?.options).toEqual([
      { label: "Hand-drawn ink", value: "Hand-drawn ink" },
      { label: "Vintage screen-print", value: "Vintage screen-print" },
    ]);
  });

  it('accepts the "1)" marker style', async () => {
    const { extractProseOptions } = await import("../ai");
    const result = extractProseOptions("Pick a mood\n1) Playful\n2) Moody");
    expect(result?.options).toEqual([
      { label: "Playful", value: "Playful" },
      { label: "Moody", value: "Moody" },
    ]);
  });

  it("leaves numbered instructions alone (sentence-like items)", async () => {
    const { extractProseOptions } = await import("../ai");
    // Instruction steps: long, verb-led sentences with punctuation — must NOT
    // become chips.
    expect(
      extractProseOptions(
        "Here's how it works:\n1. Describe your idea in the chat below.\n2. Tap Draw it to see the first render.\n3. Head to preview once you like it."
      )
    ).toBeNull();
    // Even without terminal periods, long items are not chips.
    expect(
      extractProseOptions(
        "Next steps\n1. Describe the fox you have in mind\n2. Tap the Draw it button when ready"
      )
    ).toBeNull();
  });

  it("returns null for plain prose", async () => {
    const { extractProseOptions } = await import("../ai");
    expect(extractProseOptions("A watercolor fox sounds great. Ready?")).toBeNull();
  });

  it("returns null when the message is nothing but a list", async () => {
    const { extractProseOptions } = await import("../ai");
    expect(extractProseOptions("1. Watercolor\n2. Vintage")).toBeNull();
  });

  it("returns null for a single list line", async () => {
    const { extractProseOptions } = await import("../ai");
    expect(extractProseOptions("Try this:\n1. Watercolor")).toBeNull();
  });

  it("returns null for more than 5 items", async () => {
    const { extractProseOptions } = await import("../ai");
    const items = Array.from({ length: 6 }, (_, i) => `${i + 1}. Style ${i + 1}`);
    expect(extractProseOptions(`Pick one\n${items.join("\n")}`)).toBeNull();
  });

  it("ignores a list followed by more prose (not trailing)", async () => {
    const { extractProseOptions } = await import("../ai");
    expect(
      extractProseOptions(
        "Options:\n1. Watercolor\n2. Vintage\nBut honestly the vintage one prints better."
      )
    ).toBeNull();
  });
});

describe("extractChatEnvelope", () => {
  it("returns null for plain prose", async () => {
    const { extractChatEnvelope } = await import("../ai");
    expect(extractChatEnvelope("No JSON here, just chat.")).toBeNull();
  });

  it("parses an envelope whose message contains braces", async () => {
    const { extractChatEnvelope } = await import("../ai");
    const envelope = JSON.stringify({
      message: "Use {curly} accents",
      readyToGenerate: false,
    });
    const result = extractChatEnvelope(`Lead-in text.\n${envelope}`);
    expect(result?.message).toBe("Use {curly} accents");
    expect(result?.options).toEqual([]);
  });

  it("salvages options from mixed prose + JSON", async () => {
    const { extractChatEnvelope } = await import("../ai");
    const envelope = JSON.stringify({
      message: "Pick a style.",
      readyToGenerate: false,
      options: [{ label: "Vintage", value: "Vintage screen-print" }],
    });
    const result = extractChatEnvelope(`Pick a style.\n\n${envelope}`);
    expect(result?.options).toEqual([{ label: "Vintage", value: "Vintage screen-print" }]);
  });
});

describe("quickReplyFromOptions", () => {
  it("returns [] for non-arrays", async () => {
    const { quickReplyFromOptions } = await import("../ai");
    expect(quickReplyFromOptions(undefined)).toEqual([]);
    expect(quickReplyFromOptions(null)).toEqual([]);
    expect(quickReplyFromOptions("nope")).toEqual([]);
  });

  it("drops entries with no usable label", async () => {
    const { quickReplyFromOptions } = await import("../ai");
    const result = quickReplyFromOptions([
      { label: "", value: "x" },
      { value: "no label" },
      { label: "Keep", value: "keep me" },
    ]);
    expect(result).toEqual([{ label: "Keep", value: "keep me" }]);
  });

  it("defaults value to the label when value is missing", async () => {
    const { quickReplyFromOptions } = await import("../ai");
    expect(quickReplyFromOptions([{ label: "Watercolor" }])).toEqual([
      { label: "Watercolor", value: "Watercolor" },
    ]);
  });

  it("truncates an over-long display label but keeps the full value", async () => {
    const { quickReplyFromOptions } = await import("../ai");
    const long = "x".repeat(60);
    const [opt] = quickReplyFromOptions([{ label: long }]);
    expect(opt.label.length).toBeLessThanOrEqual(40);
    expect(opt.label.endsWith("…")).toBe(true);
    expect(opt.value).toBe(long);
  });

  it("caps the number of options at 5", async () => {
    const { quickReplyFromOptions } = await import("../ai");
    const many = Array.from({ length: 9 }, (_, i) => ({ label: `o${i}` }));
    expect(quickReplyFromOptions(many)).toHaveLength(5);
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

  it("salvages chips from a numbered-list clarifying question", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          ready: false,
          question: "What style?\n1. Watercolor\n2. Vintage\n3. Bold vector",
          options: [],
        }),
      }],
    });

    const { assessReadiness } = await import("../ai");
    const result = await assessReadiness([], [], "a fox");

    expect(result.ready).toBe(false);
    expect(result.question).toBe("What style?");
    expect(result.options).toEqual([
      { label: "Watercolor", value: "Watercolor" },
      { label: "Vintage", value: "Vintage" },
      { label: "Bold vector", value: "Bold vector" },
    ]);
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

    expect(result.message).toBe("Let me draw that for you.");
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
      { id: "img-1", number: 1, url: "https://example.com/1.png", prompt: "sunset", publishedAt: null },
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
