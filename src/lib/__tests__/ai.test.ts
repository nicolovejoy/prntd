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

describe("history sent to the model (constructDesignBrief)", () => {
  beforeEach(async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"operation":"clarify","message":"ok"}' }],
    });
  });

  it("merges consecutive same-role messages", async () => {
    const mockCreate = await getMockCreate();
    const history: ChatMessage[] = [
      msg("user", "first"),
      msg("user", "second"),
    ];

    const { constructDesignBrief } = await import("../ai");
    await constructDesignBrief(history, [], "third");

    const call = mockCreate.mock.calls[0][0];
    // "first", "second" (history) and "third" (the new turn) are all user
    // role with nothing in between, so buildMessages must collapse them into
    // a single alternating-role message — Anthropic rejects consecutive
    // same-role messages.
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0].role).toBe("user");
    expect(call.messages[0].content).toBe("first\n\nsecond\n\nthird");
  });

  it("strips an embedded envelope from assistant history before resending", async () => {
    const mockCreate = await getMockCreate();
    // A polluted row: a past parse failure stored prose + raw envelope.
    const polluted = `Pick a style.\n\n{ "message": "Pick a style.", "readyToGenerate": false }`;
    const { constructDesignBrief } = await import("../ai");
    await constructDesignBrief(
      [msg("user", "a wolf"), msg("assistant", polluted)],
      [],
      "vintage"
    );

    const sent = mockCreate.mock.calls[0][0].messages;
    const assistant = sent.find((m: { role: string }) => m.role === "assistant");
    expect(assistant.content).toBe("Pick a style.");
    expect(assistant.content).not.toContain("readyToGenerate");
  });

  it("ends on a user turn when the history ends on an assistant turn", async () => {
    const mockCreate = await getMockCreate();
    const { constructDesignBrief } = await import("../ai");
    await constructDesignBrief([msg("user", "a wolf"), msg("assistant", "Noted.")], []);

    const sent = mockCreate.mock.calls[0][0].messages as { role: string }[];
    expect(sent[sent.length - 1].role).toBe("user");
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

describe("image context in design brief calls (#169)", () => {
  beforeEach(async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });
  });

  function image(over: Partial<DesignImage> & { id: string; number: number }): DesignImage {
    return {
      url: `https://r2/${over.id}.png`,
      prompt: "",
      publishedAt: null,
      ...over,
    };
  }

  it("labels the gallery per operation and keeps legacy rows verbatim", async () => {
    const mockCreate = await getMockCreate();
    const { constructDesignBrief } = await import("../ai");
    await constructDesignBrief(
      [],
      [
        image({
          id: "a",
          number: 1,
          operation: "generate",
          designSpec: {
            subject: "A bear on a unicycle",
            elements: [{ type: "obj", desc: "bear" }],
          },
          prompt: "A bear on a unicycle",
        }),
        image({
          id: "b",
          number: 2,
          operation: "edit",
          prompt: "make the bear larger",
          parentImageId: "a",
        }),
        image({ id: "c", number: 3, operation: "upload", prompt: "[user upload] logo.png" }),
        image({ id: "d", number: 4, prompt: "an old prompt" }),
      ],
      "what next?"
    );

    const system = mockCreate.mock.calls[0][0].system as string;
    expect(system).toContain("#1: Generated from: A bear on a unicycle");
    expect(system).toContain("#2: Edit applied: make the bear larger");
    expect(system).toContain("#3: Uploaded: [user upload] logo.png");
    expect(system).toContain('#4: "an old prompt"');
  });

  it("annotates an assistant turn with what its image is", async () => {
    const mockCreate = await getMockCreate();
    const { constructDesignBrief } = await import("../ai");
    await constructDesignBrief(
      [msg("assistant", "Here it is.", "b")],
      [image({ id: "b", number: 1, operation: "edit", prompt: "make the bear larger" })],
      "now what"
    );

    const messages = mockCreate.mock.calls[0][0].messages as {
      role: string;
      content: string;
    }[];
    expect(messages[0].content).toContain("Edit applied: make the bear larger");
    expect(messages[0].content).not.toContain("Prompt used:");
  });

  it("keeps the legacy 'Prompt used:' annotation for a pre-#169 row", async () => {
    const mockCreate = await getMockCreate();
    const { constructDesignBrief } = await import("../ai");
    await constructDesignBrief(
      [msg("assistant", "Here it is.", "d")],
      [image({ id: "d", number: 1, prompt: "an old prompt" })],
      "now what"
    );

    const messages = mockCreate.mock.calls[0][0].messages as {
      role: string;
      content: string;
    }[];
    expect(messages[0].content).toContain("Prompt used: an old prompt");
  });
});

describe("generatePublishedNaming (#169)", () => {
  beforeEach(async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"title":"Big Bear"}' }],
    });
  });

  it("sends the provenance context it is handed, verbatim", async () => {
    const mockCreate = await getMockCreate();
    const { generatePublishedNaming } = await import("../ai");
    const context =
      "Original design: A bear on a unicycle. Later edits applied: make the bear larger";
    const result = await generatePublishedNaming("https://r2/b.png", context);

    expect(result.title).toBe("Big Bear");
    const content = mockCreate.mock.calls[0][0].messages[0].content as {
      type: string;
      text?: string;
    }[];
    const text = content.find((c) => c.type === "text")?.text ?? "";
    expect(text).toContain(context);
  });

  it("asks for a title with no context when there is none", async () => {
    const mockCreate = await getMockCreate();
    const { generatePublishedNaming } = await import("../ai");
    await generatePublishedNaming("https://r2/b.png", null);
    const content = mockCreate.mock.calls[0][0].messages[0].content as {
      type: string;
      text?: string;
    }[];
    expect(content.find((c) => c.type === "text")?.text).toBe("Write the title.");
  });
});

describe("DESIGN_BRIEF_SYSTEM_PROMPT", () => {
  it("treats a short subjectless phrase as lettering, not a clarify", async () => {
    const { DESIGN_BRIEF_SYSTEM_PROMPT } = await import("../ai");
    expect(DESIGN_BRIEF_SYSTEM_PROMPT).toContain("it is lettering");
  });

  it("instructs the model not to paraphrase literal text", async () => {
    const { DESIGN_BRIEF_SYSTEM_PROMPT } = await import("../ai");
    expect(DESIGN_BRIEF_SYSTEM_PROMPT).toContain(
      "Do not paraphrase, shorten, or replace"
    );
  });
});
