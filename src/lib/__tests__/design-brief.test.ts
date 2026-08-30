import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatMessage } from "../db/schema";
import type { DesignImage } from "../design-images";

// Mock the Anthropic SDK before importing — same harness as ai.test.ts.
vi.mock("@anthropic-ai/sdk", () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
    _mockCreate: mockCreate,
  };
});

async function getMockCreate() {
  const mod = (await import("@anthropic-ai/sdk")) as any;
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

function respond(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("constructDesignBrief", () => {
  beforeEach(async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockReset();
  });

  it("1. valid generate: parses spec and preserves message", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue(
      respond(
        JSON.stringify({
          message: "Drawing it",
          operation: "generate",
          spec: {
            subject: "a bear",
            elements: [{ type: "obj", desc: "a bear" }],
          },
        })
      )
    );

    const { constructDesignBrief } = await import("../ai");
    const result = await constructDesignBrief([msg("user", "a bear")], []);

    expect(result.operation).toBe("generate");
    expect(result.message).toBe("Drawing it");
    if (result.operation === "generate") {
      expect(result.spec).toEqual({
        subject: "a bear",
        elements: [{ type: "obj", desc: "a bear" }],
      });
    }
  });

  it("2. generate with invalid spec (subject missing) downgrades to clarify", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue(
      respond(
        JSON.stringify({
          message: "What should the design show?",
          operation: "generate",
          spec: {
            elements: [{ type: "obj", desc: "something" }],
          },
        })
      )
    );

    const { constructDesignBrief } = await import("../ai");
    const result = await constructDesignBrief([msg("user", "make a design")], []);

    expect(result.operation).toBe("clarify");
    expect(result.message).toBe("What should the design show?");
  });

  it("3. valid edit: preserves editInstruction and referenceImage", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue(
      respond(
        JSON.stringify({
          message: "Making the bear larger",
          operation: "edit",
          editInstruction: "make the bear larger",
          referenceImage: 2,
        })
      )
    );

    const { constructDesignBrief } = await import("../ai");
    const result = await constructDesignBrief([msg("user", "make it bigger")], []);

    expect(result.operation).toBe("edit");
    if (result.operation === "edit") {
      expect(result.editInstruction).toBe("make the bear larger");
      expect(result.referenceImage).toBe(2);
    }
  });

  it("4. edit with empty editInstruction downgrades to clarify", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue(
      respond(
        JSON.stringify({
          message: "What should change?",
          operation: "edit",
          editInstruction: "   ",
          referenceImage: 1,
        })
      )
    );

    const { constructDesignBrief } = await import("../ai");
    const result = await constructDesignBrief([msg("user", "change it")], []);

    expect(result.operation).toBe("clarify");
    expect(result.message).toBe("What should change?");
  });

  it("5. explicit clarify carries the model's message", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue(
      respond(
        JSON.stringify({
          message: "What subject?",
          operation: "clarify",
        })
      )
    );

    const { constructDesignBrief } = await import("../ai");
    const result = await constructDesignBrief([msg("user", "something cool")], []);

    expect(result.operation).toBe("clarify");
    expect(result.message).toBe("What subject?");
  });

  it("6. unknown operation value falls back to clarify", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue(
      respond(
        JSON.stringify({
          message: "Not sure what to do",
          operation: "regenerate",
        })
      )
    );

    const { constructDesignBrief } = await import("../ai");
    const result = await constructDesignBrief([msg("user", "hmm")], []);

    expect(result.operation).toBe("clarify");
    expect(result.message).toBe("Not sure what to do");
  });

  it("7. non-JSON prose response clarifies with the prose itself (#137)", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue(respond("Sorry, I got confused"));

    const { constructDesignBrief } = await import("../ai");
    const result = await constructDesignBrief([msg("user", "anything")], []);

    expect(result.operation).toBe("clarify");
    expect(result.message).toBe("Sorry, I got confused");
  });

  it("8. empty response clarifies with the canned message", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue(respond(""));

    const { constructDesignBrief } = await import("../ai");
    const result = await constructDesignBrief([msg("user", "anything")], []);

    expect(result.operation).toBe("clarify");
    expect(result.message).toBe("Tell me what you'd like on the shirt.");
  });

  it("9. code-fenced JSON is unwrapped", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue(
      respond(
        '```json\n' +
          JSON.stringify({
            message: "Drawing it",
            operation: "generate",
            spec: {
              subject: "a bear",
              elements: [{ type: "obj", desc: "a bear" }],
            },
          }) +
          '\n```'
      )
    );

    const { constructDesignBrief } = await import("../ai");
    const result = await constructDesignBrief([msg("user", "a bear")], []);

    expect(result.operation).toBe("generate");
    expect(result.message).toBe("Drawing it");
  });

  it("10. referenceImage absent on an edit defaults to null", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue(
      respond(
        JSON.stringify({
          message: "Making it bigger",
          operation: "edit",
          editInstruction: "make the bear larger",
        })
      )
    );

    const { constructDesignBrief } = await import("../ai");
    const result = await constructDesignBrief([msg("user", "bigger")], []);

    expect(result.operation).toBe("edit");
    if (result.operation === "edit") {
      expect(result.referenceImage).toBeNull();
    }
  });

  it("11. valid JSON that isn't an object (`null`) clarifies without throwing", async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue(respond("null"));

    const { constructDesignBrief } = await import("../ai");
    const result = await constructDesignBrief([msg("user", "anything")], []);

    expect(result.operation).toBe("clarify");
    expect(result.message).toBe("null");
  });
});
