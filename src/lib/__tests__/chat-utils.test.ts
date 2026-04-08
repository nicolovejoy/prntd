import { describe, it, expect } from "vitest";
import { extractImagesFromHistory } from "../chat-utils";
import type { ChatMessage } from "../db/schema";

describe("extractImagesFromHistory", () => {
  it("returns empty array for empty history", () => {
    expect(extractImagesFromHistory([])).toEqual([]);
  });

  it("returns empty array when no messages have images", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "A sunset design" },
      { role: "assistant", content: "Sounds great!" },
    ];
    expect(extractImagesFromHistory(history)).toEqual([]);
  });

  it("extracts images with generation numbers", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "A sunset" },
      {
        role: "assistant",
        content: "Here it is",
        imageUrl: "https://example.com/1.png",
        generationNumber: 1,
        fluxPrompt: "sunset prompt",
      },
    ];
    const result = extractImagesFromHistory(history);
    expect(result).toEqual([
      { number: 1, url: "https://example.com/1.png", prompt: "sunset prompt" },
    ]);
  });

  it("auto-numbers images without generationNumber", () => {
    const history: ChatMessage[] = [
      {
        role: "assistant",
        content: "Generated",
        imageUrl: "https://example.com/a.png",
      },
      {
        role: "assistant",
        content: "Another one",
        imageUrl: "https://example.com/b.png",
      },
    ];
    const result = extractImagesFromHistory(history);
    expect(result[0].number).toBe(1);
    expect(result[1].number).toBe(2);
  });

  it("handles user-uploaded images", () => {
    const history: ChatMessage[] = [
      {
        role: "user",
        content: "reference.jpg",
        imageUrl: "https://example.com/ref.png",
      },
    ];
    const result = extractImagesFromHistory(history);
    expect(result[0].prompt).toBe("[user upload] reference.jpg");
  });

  it("uses fluxPrompt for assistant images, empty string if missing", () => {
    const history: ChatMessage[] = [
      {
        role: "assistant",
        content: "Here",
        imageUrl: "https://example.com/1.png",
        generationNumber: 1,
      },
    ];
    const result = extractImagesFromHistory(history);
    expect(result[0].prompt).toBe("");
  });

  it("preserves order across mixed messages", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "idea" },
      { role: "assistant", content: "ok", imageUrl: "https://example.com/1.png", generationNumber: 1 },
      { role: "user", content: "tweak it" },
      { role: "assistant", content: "no image" },
      { role: "assistant", content: "done", imageUrl: "https://example.com/2.png", generationNumber: 2 },
    ];
    const result = extractImagesFromHistory(history);
    expect(result).toHaveLength(2);
    expect(result[0].number).toBe(1);
    expect(result[1].number).toBe(2);
  });
});
