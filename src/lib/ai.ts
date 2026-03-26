import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "./db/schema";

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `You are a t-shirt design assistant for PRNTD. Your job is to help users create t-shirt designs by understanding their ideas and translating them into detailed image generation prompts for Flux.

When the user describes what they want, respond with:
1. A brief, friendly acknowledgment of their idea
2. A detailed Flux prompt optimized for t-shirt design generation

Format your response as JSON:
{
  "message": "Your friendly response to the user",
  "fluxPrompt": "Detailed image generation prompt for Flux"
}

Guidelines for Flux prompts:
- Always include "t-shirt design" or "graphic for t-shirt" in the prompt
- Specify style (vector, illustration, photographic, etc.)
- Include "transparent background" or "solid background" as appropriate
- Be specific about colors, composition, and style
- For text on shirts, specify the exact text and font style
- Keep designs printable — high contrast, clear shapes

IMPORTANT — Refinements:
When the user asks to refine or change an existing design, your previous assistant messages will include the Flux prompt that generated the current image (marked as "Flux prompt used: ..."). You MUST take that exact prompt and make only the specific changes the user requested. Do not rewrite the prompt from scratch. Preserve everything the user hasn't asked to change — style, composition, colors, and all other details should stay the same unless explicitly requested otherwise.`;

export async function constructFluxPrompt(
  userMessage: string,
  chatHistory: ChatMessage[]
): Promise<{ message: string; fluxPrompt: string }> {
  const messages = chatHistory.map((msg) => ({
    role: msg.role as "user" | "assistant",
    content:
      msg.role === "assistant" && msg.fluxPrompt
        ? `${msg.content}\n\nFlux prompt used: ${msg.fluxPrompt}`
        : msg.content,
  }));

  messages.push({ role: "user", content: userMessage });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages,
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    const parsed = JSON.parse(text);
    return {
      message: parsed.message,
      fluxPrompt: parsed.fluxPrompt,
    };
  } catch {
    return {
      message: text,
      fluxPrompt: `t-shirt design, ${userMessage}, high quality, printable graphic, solid background`,
    };
  }
}
