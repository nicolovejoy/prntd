import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "./db/schema";
import type { DesignImage } from "./design-images";

const anthropic = new Anthropic();

function buildImageGalleryContext(images: DesignImage[]): string {
  if (images.length === 0) return "";
  const lines = images.map((img) => `#${img.number}: "${img.prompt}"`);
  return `\nImages so far:\n${lines.join("\n")}\n\nEntries marked [user upload] are reference images the user provided. Use them as style/content inspiration. When the user references images by number (e.g., "#2"), you know which image they mean.`;
}

const CHAT_SYSTEM_PROMPT = `You are a t-shirt design advisor for PRNTD. Help users refine their design ideas through conversation. You do NOT generate images — the user clicks "Generate" when ready.

Output format — respond with raw JSON only (no markdown fences around the JSON itself):
{
  "message": "Your conversational reply (this is the field the user reads; it may contain markdown — see style rules below)",
  "readyToGenerate": true | false,
  "options": [ { "label": "Watercolor", "value": "Make it a soft watercolor style" } ]
}

Readiness rubric for "readyToGenerate":
- Set true ONLY when the conversation has pinned down BOTH a concrete subject (the WHAT — what's depicted) AND a concrete visual style/medium (the HOW — e.g. clean vector, watercolor, vintage screen-print, hand-drawn ink). A subject with no style is NOT ready — that is the case that produces a clarifying question instead of an image.
- Otherwise set false, and make "message" the question or nudge that moves toward whichever of subject/style is still missing.

The "options" field (tappable quick-replies — THIS is how you offer choices):
- Whenever you ask a multiple-choice question or suggest directions to pick from, put each choice in "options" as { "label": short tappable text, "value": the full message sent as the user's reply if they tap it }.
- "label" is what the user taps — keep it short (1-3 words, e.g. "Watercolor", "Bold vector", "Vintage badge"). "value" is the natural-language turn submitted on tap (e.g. "Let's go with a vintage screen-print look").
- Offer 2-5 options. The user can still type freely instead — options are a shortcut, not the only path.
- Ask ONE question per turn. When several things are still open, pick the single most useful one and ask only that, with its choices as options. Do NOT stack multiple questions, and never put a bulleted or numbered list of choices in "message" — that is the clutter the options buttons replace. Keep "message" to the one question (plus a brief lead-in if needed).
- Omit "options" (or use []) when there's nothing to pick — a plain nudge or acknowledgement.

Style rules for the "message" field:
- Be terse and professional. 2-4 short sentences max.
- Use markdown sparingly: **bold** for emphasis, line breaks between sections. No numbered lists of choices — those go in "options".
- No filler, no flattery, no "great idea!" — just useful input.
- End with a short question or nudge toward Generate.
- Frame your responses as directions to try, not edits to apply. Use "try", "aim for", "this version", "this direction" — not "fix", "remove", "edit".

Handling negations (very important):
The image model is text-to-image. It does not subtract — telling it "no X" tends to surface X. When the user says what they DON'T want, restate the request in affirmative terms before going further.
- "no tongue" / "without his tongue out" → "mouth closed, lips together"
- "no text" / "no words" → "image only, no captions, clean composition"
- "not cartoonish" → ask what they want instead (clean illustration? vintage badge? hand-drawn?), then use that
- "no bubble letters" → "solid filled bold sans-serif lettering"
- "less busy" → "open composition, clear focal point, generous negative space"
Acknowledge the user's request in their words ("Got it — closed mouth, no tongue"), but think in affirmative visual targets. Carry the affirmative target forward when reasoning about follow-ups.

CRITICAL: The "message" field is conversational prose for the user — never put JSON, code blocks, or structured data INSIDE "message". The only JSON is the outer envelope described in Output format.

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
- The design is generated on a transparent background automatically — do NOT mention backgrounds, "white background", or "isolated design" in the prompt.
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

Negations — fluxPrompt must be POSITIVE-ONLY:
The image model does not subtract; "no X" tends to make X show up. The fluxPrompt must describe ONLY what should appear in the image, in affirmative terms. Translate every negation from the conversation into a positive visual target before writing fluxPrompt.
- "no tongue" / "tongue not out" → "mouth closed, lips together, calm expression"
- "no text" / "no words" / "without lettering" → describe the image only; do not mention text at all in fluxPrompt
- "not cartoonish" → use the affirmative style the user wants ("clean vintage badge illustration", "hand-drawn pen-and-ink", etc.)
- "no bubble letters" → "solid filled bold sans-serif block lettering" (or whatever positive shape was discussed)
- "less busy" → "open composition, clear focal point, generous negative space"
- "no background" → say nothing about background, or say "isolated subject on white background" — never write "no background" or "without a background"
Use the negativePrompt field for cases where Ideogram needs an explicit push away from a default it likes (e.g. "smooth digital gradient" when you asked for "raw brush texture"). Negations belong there, not in fluxPrompt.

Refinements:
- When refining a previous design, reference its prompt (shown as "Prompt used: ..." in the gallery context). Make only the specific changes requested. Preserve the rest.
- Set "referenceImage" to the design number being refined — the image will be passed to the model as a visual reference for style and composition consistency.`;

/** A tappable quick-reply chip: what the user sees vs. the turn sent on tap. */
export type ChatOption = { label: string; value: string };

const MAX_OPTIONS = 5;
const MAX_OPTION_LABEL = 40;

/**
 * Normalize the model's "options" field into clean quick-reply chips. The
 * model can emit junk (missing label, non-string value, too many, over-long
 * labels) — this is the single sanitizer so the UI never has to guard.
 * - drops entries with no usable label;
 * - value defaults to the (full) label when absent;
 * - truncates the displayed label, but keeps the full text as the submitted value;
 * - caps the count.
 */
export function quickReplyFromOptions(raw: unknown): ChatOption[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as { label?: unknown; value?: unknown };
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const value =
      typeof r.value === "string" && r.value.trim() ? r.value.trim() : label;
    if (!label || !value) continue;
    const display =
      label.length > MAX_OPTION_LABEL
        ? label.slice(0, MAX_OPTION_LABEL - 1).trimEnd() + "…"
        : label;
    out.push({ label: display, value });
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

/**
 * Pull the chat JSON envelope out of a reply that mixes prose with JSON. The
 * model occasionally emits its conversational text AND the envelope instead
 * of the envelope alone; the prose is a duplicate of envelope.message, so the
 * envelope wins. Returns null when no parseable envelope is present.
 */
export function extractChatEnvelope(
  text: string
): { message: string; readyToGenerate: boolean; options: ChatOption[] } | null {
  const start = text.search(/\{\s*"message"\s*:/);
  if (start === -1) return null;
  for (const end of [text.length, text.lastIndexOf("}") + 1]) {
    if (end <= start) continue;
    try {
      const parsed = JSON.parse(text.slice(start, end));
      if (typeof parsed.message === "string") {
        return {
          message: parsed.message,
          readyToGenerate: parsed.readyToGenerate === true,
          options: quickReplyFromOptions(parsed.options),
        };
      }
    } catch {
      // try the next candidate slice
    }
  }
  return null;
}

function buildMessages(
  chatHistory: ChatMessage[],
  images: DesignImage[],
  userMessage?: string
) {
  const galleryContext = buildImageGalleryContext(images);

  // Resolve flux prompt for assistant messages via image_id →
  // design_image.prompt (carried on DesignImage entries from
  // getDesignImagesForAIContext).
  const promptByImageId = new Map(images.map((img) => [img.id, img.prompt]));

  const raw = chatHistory.map((msg) => {
    // Heal polluted history: an assistant row saved with an embedded JSON
    // envelope (a past parse failure) teaches the model to imitate the broken
    // prose+JSON format on every later turn — strip it before it goes back in.
    const content =
      msg.role === "assistant"
        ? (extractChatEnvelope(msg.content)?.message ?? msg.content)
        : msg.content;
    const fluxPrompt =
      msg.role === "assistant" && msg.imageId
        ? promptByImageId.get(msg.imageId)
        : null;
    return {
      role: msg.role as "user" | "assistant",
      content: fluxPrompt ? `${content}\n\nPrompt used: ${fluxPrompt}` : content,
    };
  });

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
): Promise<{ message: string; readyToGenerate: boolean; options: ChatOption[] }> {
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

  let text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Strip markdown code fences if present, then parse the JSON envelope.
  // Parse failure (or a non-boolean flag) degrades safely: show the raw
  // text and leave the Generate button greyed (readyToGenerate=false).
  text = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();

  try {
    const parsed = JSON.parse(text);
    return {
      message: typeof parsed.message === "string" ? parsed.message : text,
      readyToGenerate: parsed.readyToGenerate === true,
      options: quickReplyFromOptions(parsed.options),
    };
  } catch {
    // Mixed prose + envelope (the model sometimes emits both) — salvage the
    // envelope rather than showing the user the raw JSON blob.
    const envelope = extractChatEnvelope(text);
    if (envelope) return envelope;
    return { message: text, readyToGenerate: false, options: [] };
  }
}

const READINESS_SYSTEM_PROMPT = `You judge whether a t-shirt design idea is concrete enough to generate an image. Reply with raw JSON only (no markdown fences):
{
  "ready": true | false,
  "question": "if not ready, ONE short question asking for whichever of subject or style is missing; empty string if ready",
  "options": [ { "label": "Watercolor", "value": "Make it a soft watercolor style" } ]
}

Ready ONLY when BOTH are clear:
- SUBJECT — what is depicted.
- STYLE/medium — e.g. clean vector, watercolor, vintage screen-print, hand-drawn ink, bold graphic.
A clear subject with no style is NOT ready: set ready=false and ask for the style. When asking for a style, fill "options" with 3-5 tappable style choices: { "label": short text (e.g. "Bold vector"), "value": the natural-language reply sent on tap (e.g. "Go with a bold flat vector look") }. Do NOT number choices in "question" — they render as tappable buttons. Omit "options" (or use []) when ready. Keep "question" to 1-2 sentences. When genuinely uncertain, lean ready=true — a real idea should never be blocked.`;

/**
 * Fast pre-check used by Generate/Compare to decide "render vs ask" without
 * paying the heavy constructFluxPrompt round-trip. Runs on Haiku with a tiny
 * prompt (~1s) instead of Sonnet + a 45-line system prompt + 1024 tokens
 * (~6s). Fails OPEN: any parse problem or a missing flag resolves to
 * ready=true so a concrete prompt is never blocked by a hiccup —
 * constructFluxPrompt's own clarification guard remains the backstop.
 */
export async function assessReadiness(
  chatHistory: ChatMessage[],
  images: DesignImage[],
  userMessage?: string
): Promise<{ ready: boolean; question: string; options: ChatOption[] }> {
  const { messages, galleryContext } = buildMessages(
    chatHistory,
    images,
    userMessage
  );

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: READINESS_SYSTEM_PROMPT + galleryContext,
      messages,
    });

    let text =
      response.content?.[0]?.type === "text" ? response.content[0].text : "";
    text = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();

    const parsed = JSON.parse(text);
    return {
      ready: parsed.ready !== false,
      question: typeof parsed.question === "string" ? parsed.question : "",
      options: quickReplyFromOptions(parsed.options),
    };
  } catch (err) {
    // Fail open: a parse problem, outage, or model error must never block a
    // real idea. constructFluxPrompt's own guard remains the backstop.
    console.error("assessReadiness failed, treating as ready:", err);
    return { ready: true, question: "", options: [] };
  }
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

const PUBLISH_NAMING_SYSTEM_PROMPT = `You write public listings for t-shirt designs being shared in a discover feed. Look at the image and the prompt that generated it, then return raw JSON (no markdown, no code fences):
{
  "title": "Short, 2-5 words, Title Case, no quotes, no trailing period. If the design has prominent text, you may use that text verbatim.",
  "description": "One to two plain sentences (max ~30 words total) explaining what the design depicts and its style. Human-readable, not a prompt. No filler, no hype, no 'this design features'. Just describe it."
}

The audience is other people browsing for design inspiration. Keep the description concrete (what is in the image, what style) — not aspirational marketing copy.`;

export async function generatePublishedNaming(
  imageUrl: string,
  prompt: string | null
): Promise<{ title: string; description: string }> {
  const fallback = {
    title: "Untitled Design",
    description: prompt ?? "A t-shirt design.",
  };
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 256,
      system: PUBLISH_NAMING_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "url", url: imageUrl } },
            {
              type: "text",
              text: prompt
                ? `Prompt used to generate this image:\n${prompt}\n\nWrite the listing.`
                : "Write the listing.",
            },
          ],
        },
      ],
    });

    let text =
      response.content?.[0]?.type === "text" ? response.content[0].text : "";
    text = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();

    const parsed = JSON.parse(text);
    const title =
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim().slice(0, 80)
        : fallback.title;
    const description =
      typeof parsed.description === "string" && parsed.description.trim()
        ? parsed.description.trim().slice(0, 400)
        : fallback.description;
    return { title, description };
  } catch (err) {
    console.error("generatePublishedNaming failed:", err);
    return fallback;
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
      fluxPrompt: "graphic design illustration, high quality, printable",
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
      fluxPrompt: `graphic design illustration, high quality, printable`,
      negativePrompt: null,
      referenceImage: null,
    };
  }
}
