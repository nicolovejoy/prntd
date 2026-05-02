import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "./db/schema";
import type { DesignImage } from "./chat-utils";

const anthropic = new Anthropic();

function buildImageGalleryContext(images: DesignImage[]): string {
  if (images.length === 0) return "";
  const lines = images.map((img) => `#${img.number}: "${img.prompt}"`);
  return `\nImages so far:\n${lines.join("\n")}\n\nEntries marked [user upload] are reference images the user provided. Use them as style/content inspiration. When the user references images by number (e.g., "#2"), you know which image they mean.`;
}

const CHAT_SYSTEM_PROMPT = `You are a t-shirt design advisor for PRNTD. Help users refine their design ideas through conversation. You do NOT generate images — the user clicks "Generate" when ready.

Style rules for your responses:
- Be terse and professional. 2-4 short sentences max, then options if relevant.
- When suggesting directions, ALWAYS number them for easy reference:
  1. Option one
  2. Option two
- Use markdown: **bold** for emphasis, numbered lists for options, line breaks between sections.
- No filler, no flattery, no "great idea!" — just useful input.
- End with a short question or nudge toward Generate.

CRITICAL: NEVER return JSON, code blocks, or structured data.

Print constraints you know:
- DTG on fabric, 12"x16" print area, white/transparent background
- Clean lines, moderate ink, centered compositions
- Flat graphics and illustrations over photographic styles
- Text works well — Ideogram handles typography`;

const GENERATE_SYSTEM_PROMPT = `You are a t-shirt design assistant for PRNTD. Your job is to translate the user's conversation into a detailed Ideogram image generation prompt.

Read the conversation to understand what the user wants, then respond with raw JSON (no markdown, no code fences):
{
  "message": "Brief acknowledgment of what you're generating",
  "fluxPrompt": "Detailed image generation prompt for Ideogram",
  "referenceImage": null or number (e.g. 2) — set this to the # of a previous design if the user is refining/building on it
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
When refining a previous design, reference its prompt (shown as "Prompt used: ..." or in the gallery context). Make only the specific changes requested. Preserve everything else. Set "referenceImage" to the design number being refined — the image will be passed to the model as a visual reference for style and composition consistency.`;

function buildMessages(
  chatHistory: ChatMessage[],
  images: DesignImage[],
  userMessage?: string
) {
  const galleryContext = buildImageGalleryContext(images);

  const raw = chatHistory.map((msg) => ({
    role: msg.role as "user" | "assistant",
    content:
      msg.role === "assistant" && msg.fluxPrompt
        ? `${msg.content}\n\nPrompt used: ${msg.fluxPrompt}`
        : msg.content,
  }));

  if (userMessage) {
    raw.push({ role: "user" as const, content: userMessage });
  }

  // Merge consecutive same-role messages (Anthropic requires alternating roles)
  const messages: typeof raw = [];
  for (const msg of raw) {
    const prev = messages[messages.length - 1];
    if (prev && prev.role === msg.role) {
      prev.content += "\n\n" + msg.content;
    } else {
      messages.push({ ...msg });
    }
  }

  // Sonnet 4.6 requires messages to end with a user turn (no assistant prefill)
  if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
    messages.push({ role: "user", content: "Generate an image based on this conversation." });
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
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: CHAT_SYSTEM_PROMPT + galleryContext,
    messages,
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  return { message: text };
}

const NAME_SYSTEM_PROMPT = `You name t-shirt designs for an order management system. Look at the image and respond with 2–4 words that identify it at a glance.

Rules:
- If the design contains prominent text, return that text verbatim (trim to 4 words max).
- Otherwise, describe the subject concisely (e.g. "Blue Mountain Landscape", "Skull With Roses").
- Title Case. No quotes, no punctuation, no trailing period.
- Respond with only the name. No preamble, no explanation.`;

export async function generateOrderName(imageUrl: string): Promise<string | null> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 32,
      system: NAME_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "url", url: imageUrl } },
            { type: "text", text: "Name this design." },
          ],
        },
      ],
    });

    const text =
      response.content?.[0]?.type === "text" ? response.content[0].text : "";
    const cleaned = text.trim().replace(/^["']|["']$/g, "").replace(/\.$/, "");
    if (!cleaned) return null;
    // Cap at 60 chars to keep email subjects sane
    return cleaned.length > 60 ? cleaned.slice(0, 60).trim() : cleaned;
  } catch (err) {
    console.error("generateOrderName failed:", err);
    return null;
  }
}

export async function constructFluxPrompt(
  chatHistory: ChatMessage[],
  images: DesignImage[],
  userMessage?: string
): Promise<{ message: string; fluxPrompt: string; referenceImage: number | null }> {
  const { messages, galleryContext } = buildMessages(
    chatHistory,
    images,
    userMessage
  );

  // If no user message and last message is from user, use context as-is
  // If no messages at all, this shouldn't be called

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: GENERATE_SYSTEM_PROMPT + galleryContext,
    messages,
  });

  let text =
    response.content?.[0]?.type === "text" ? response.content[0].text : "";

  if (!text) {
    console.error("constructFluxPrompt: empty response from Claude");
    return {
      message: "Let me generate that for you.",
      fluxPrompt: "graphic design illustration, white background, isolated design, high quality, printable",
      referenceImage: null,
    };
  }

  // Strip markdown code fences if present
  text = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();

  try {
    const parsed = JSON.parse(text);
    return {
      message: parsed.message,
      fluxPrompt: parsed.fluxPrompt,
      referenceImage: parsed.referenceImage ?? null,
    };
  } catch {
    return {
      message: text,
      fluxPrompt: `graphic design illustration, white background, isolated design, high quality, printable`,
      referenceImage: null,
    };
  }
}
