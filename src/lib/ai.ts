import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "./db/schema";
import type { DesignImage } from "./chat-utils";

const anthropic = new Anthropic();

function buildImageGalleryContext(images: DesignImage[]): string {
  if (images.length === 0) return "";
  const lines = images.map((img) => `#${img.number}: "${img.prompt}"`);
  return `\nGenerated designs so far:\n${lines.join("\n")}\n\nWhen the user references images by number (e.g., "#2"), you know which design and prompt they mean.`;
}

const CHAT_SYSTEM_PROMPT = `You are a t-shirt design advisor for PRNTD. Help users refine their design ideas through conversation. You discuss concepts, styles, colors, typography, and composition — but you do NOT generate images yourself. The user will click a separate "Generate" button when they're ready to create an image.

Keep responses concise and helpful. If the user seems ready to generate, encourage them to hit Generate.

CRITICAL: Respond in plain text only. NEVER return JSON, code blocks, or structured data. You are having a conversation, not generating prompts.

Print constraints to keep in mind when advising:
- DTG printing on fabric, 12" x 16" print area
- Designs need white/transparent backgrounds
- Clean lines, moderate ink coverage, centered compositions print best
- Flat graphics and illustrations work better than photographic styles

Text in designs:
- Text works well — Ideogram handles typography
- Suggest clean, legible fonts when text is involved`;

const GENERATE_SYSTEM_PROMPT = `You are a t-shirt design assistant for PRNTD. Your job is to translate the user's conversation into a detailed Ideogram image generation prompt.

Read the conversation to understand what the user wants, then respond with raw JSON (no markdown, no code fences):
{
  "message": "Brief acknowledgment of what you're generating",
  "fluxPrompt": "Detailed image generation prompt for Ideogram"
}

Print specifications (always follow these):
- DTG printing, 12" x 16" print area
- Design should work on a plain white background (background will be removed)
- Always include "white background, isolated design" in the prompt
- Favor open, breathable compositions — avoid dense block prints
- Moderate ink coverage, clean lines, high contrast

Guidelines for Ideogram prompts:
- CRITICAL: Output must be flat graphic/artwork only — NOT a picture of a t-shirt. Never include "t-shirt" in the prompt. Use "graphic design", "illustration", "artwork", or "print design"
- Default to illustration, vector art, or clean graphic styles
- Favor clean, wearable aesthetics
- Centered compositions with breathing room
- Stay faithful to what the user asked for

Text in designs:
- Ideogram handles text well — include when requested
- Specify exact text in quotes with "clean, legible typography"

IMPORTANT — Refinements:
When refining a previous design, reference its prompt (shown as "Prompt used: ..." or in the gallery context). Make only the specific changes requested. Preserve everything else.`;

function buildMessages(
  chatHistory: ChatMessage[],
  images: DesignImage[],
  userMessage?: string
) {
  const galleryContext = buildImageGalleryContext(images);

  const messages = chatHistory.map((msg) => ({
    role: msg.role as "user" | "assistant",
    content:
      msg.role === "assistant" && msg.fluxPrompt
        ? `${msg.content}\n\nPrompt used: ${msg.fluxPrompt}`
        : msg.content,
  }));

  if (userMessage) {
    messages.push({ role: "user" as const, content: userMessage });
  }

  return { messages, galleryContext };
}

export async function chatAboutDesign(
  userMessage: string,
  chatHistory: ChatMessage[],
  images: DesignImage[]
): Promise<{ message: string }> {
  const { messages, galleryContext } = buildMessages(
    chatHistory,
    images,
    userMessage
  );

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: CHAT_SYSTEM_PROMPT + galleryContext,
    messages,
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  return { message: text };
}

export async function constructFluxPrompt(
  chatHistory: ChatMessage[],
  images: DesignImage[],
  userMessage?: string
): Promise<{ message: string; fluxPrompt: string }> {
  const { messages, galleryContext } = buildMessages(
    chatHistory,
    images,
    userMessage
  );

  // If no user message and last message is from user, use context as-is
  // If no messages at all, this shouldn't be called

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: GENERATE_SYSTEM_PROMPT + galleryContext,
    messages,
  });

  let text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Strip markdown code fences if present
  text = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();

  try {
    const parsed = JSON.parse(text);
    return {
      message: parsed.message,
      fluxPrompt: parsed.fluxPrompt,
    };
  } catch {
    return {
      message: text,
      fluxPrompt: `graphic design illustration, white background, isolated design, high quality, printable`,
    };
  }
}
