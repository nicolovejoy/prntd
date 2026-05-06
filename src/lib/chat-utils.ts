import type { ChatMessage } from "./db/schema";

export type DesignImage = {
  /**
   * design_image row id. Optional for back-compat with the chat-history
   * extraction path; the gallery on /design always supplies it now (so
   * delete and select target the row by id).
   */
  id?: string;
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
