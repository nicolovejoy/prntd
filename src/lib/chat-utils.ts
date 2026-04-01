import type { ChatMessage } from "./db/schema";

export type DesignImage = {
  number: number;
  url: string;
  prompt: string;
};

export function extractImagesFromHistory(
  chatHistory: ChatMessage[]
): DesignImage[] {
  let n = 0;
  return chatHistory
    .filter((msg) => msg.imageUrl)
    .map((msg) => ({
      number: msg.generationNumber ?? ++n,
      url: msg.imageUrl!,
      prompt:
        msg.role === "user"
          ? `[user upload] ${msg.content}`
          : msg.fluxPrompt ?? "",
    }));
}
