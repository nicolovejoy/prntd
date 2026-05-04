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

What the UI actually offers (do NOT invent other features):
- A chat box (this conversation).
- A "Generate" button that triggers a new image from the conversation so far.
- An image gallery showing past generations, each with a "Use as reference" action to feed it back into the next generation.
- Buttons to proceed to product preview / order.
- That's it. There is no "Remove Background" button, no inpainting, no manual editor, no layer tools, no upload-to-edit. If the user asks for something the UI doesn't have, say so plainly — do not invent an interaction. If the user insists a feature exists, do not capitulate; say you don't have a way to do that here.

Background transparency:
- Handled automatically server-side. The user does nothing. Don't tell them to click a button or apply a tool — there isn't one.

Print constraints you know:
- DTG on fabric, 12"x16" print area
- Clean lines, moderate ink, centered compositions
- Flat graphics and illustrations over photographic styles
- Text works well — Ideogram handles typography`;

const GENERATE_SYSTEM_PROMPT = `You are a t-shirt design assistant for PRNTD. Your job is to translate the user's conversation into an Ideogram image generation prompt.

Read the conversation to understand what the user wants — both the SUBJECT and the AESTHETIC — then respond with raw JSON (no markdown, no code fences):
{
  "message": "Brief acknowledgment of what you're generating",
  "fluxPrompt": "Detailed image generation prompt for Ideogram",
  "negativePrompt": "Optional. Things to push the model AWAY from. Use when the user asks for an aesthetic the model tends to ignore (see Style section below). Empty string if not needed.",
  "referenceImage": null or number (e.g. 2) — set this to the # of a previous design if the user is refining/building on it
}

Print specifications (always follow these — these are physics, not taste):
- DTG printing, 12" x 16" print area
- Design renders on a plain white background (background will be removed before printing)
- Always include "white background, isolated design" in the prompt
- Favor open, breathable compositions — avoid dense block prints (technical: ink coverage matters for DTG)
- Output must be a flat graphic / artwork only — NEVER a picture of a t-shirt. Never include "t-shirt" or "shirt" or "mockup" in the prompt. Use "graphic design", "illustration", "artwork", "print design", or the user's stated medium.

Style — be faithful to the user's intent:
- DO NOT default to clean / vector / digital illustration unless the user asks for it.
- If the user asks for hand-painted, brushy, watercolor, distressed, screen-print, sumi-e, pen-and-ink, charcoal, vintage, handmade, scratchy, woodcut, lithograph, halftone, riso, zine, etc. — write that into the prompt with concrete texture cues, and use the negativePrompt field to push AWAY from "clean vector, smooth gradients, digital font, polished illustration, perfect curves".
- If the user asks for clean / minimal / vector / flat / modern / corporate — write that.
- If the user is silent on style, ASK before generating rather than guessing.
- Style vocabulary translation tips:
  - "brushy" / "hand-painted" → "sumi-e brush strokes, uneven ink pressure, ink pooling at stroke ends, raw bristle texture, imperfect edges"
  - "distressed" / "vintage" → "halftone screen-print, deliberate ink gaps, slight registration offset, worn texture, faded mid-tones"
  - "hand-drawn" → "pencil or pen lines with slight wobble, no perfect curves, visible mark-making"
  - "punk zine" → "cut-and-paste collage, photocopied texture, deliberate misalignment, stark high contrast"
- Never override the user's stated style because you think a different style would print better. The user gets what they asked for. If a style genuinely conflicts with print constraints (e.g. fine photographic gradients on DTG), explain that to the user in the chat — don't silently re-style.

Text in designs:
- Ideogram handles text well — include when requested.
- Specify exact text in quotes. For typography, MATCH THE USER'S STYLE INTENT — if they want hand-painted, write "hand-lettered brush calligraphy with uneven ink pressure", not "clean legible typography".

Refinements:
- When refining a previous design, reference its prompt (shown as "Prompt used: ..." in the gallery context). Make only the specific changes requested. Preserve the rest.
- Set "referenceImage" to the design number being refined — the image will be passed to the model as a visual reference for style and composition consistency.`;

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
): Promise<{
  message: string;
  fluxPrompt: string;
  negativePrompt: string | null;
  referenceImage: number | null;
}> {
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
      negativePrompt: null,
      referenceImage: null,
    };
  }

  // Strip markdown code fences if present
  text = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();

  try {
    const parsed = JSON.parse(text);
    const negative = typeof parsed.negativePrompt === "string" && parsed.negativePrompt.trim()
      ? parsed.negativePrompt.trim()
      : null;
    return {
      message: parsed.message,
      fluxPrompt: parsed.fluxPrompt,
      negativePrompt: negative,
      referenceImage: parsed.referenceImage ?? null,
    };
  } catch {
    return {
      message: text,
      fluxPrompt: `graphic design illustration, white background, isolated design, high quality, printable`,
      negativePrompt: null,
      referenceImage: null,
    };
  }
}
