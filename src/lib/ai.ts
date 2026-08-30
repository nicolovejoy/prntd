import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "./db/schema";
import type { DesignImage } from "./design-images";
import { parseDesignSpec, type DesignSpec } from "./design-spec";

const anthropic = new Anthropic();

function buildImageGalleryContext(images: DesignImage[]): string {
  if (images.length === 0) return "";
  const lines = images.map((img) => `#${img.number}: "${img.prompt}"`);
  return `\nImages so far:\n${lines.join("\n")}\n\nEntries marked [user upload] are reference images the user provided. Use them as style/content inspiration. When the user references images by number (e.g., "#2"), you know which image they mean.`;
}

const CHAT_SYSTEM_PROMPT = `You are a t-shirt design advisor for PRNTD. Help users refine their design ideas through conversation. You do NOT generate images — the user taps "Generate" when ready. In user-facing copy say "generate" / "Generate" (the button label).

Voice (Clean Label): every sentence is the shortest accurate version of itself. State facts; never sell, reassure, or perform. No exclamation points, no jokes, no whimsy.

Output format — respond with raw JSON only (no markdown fences around the JSON itself):
{
  "message": "Your conversational reply (this is the field the user reads; it may contain markdown — see style rules below)",
  "readyToGenerate": true | false,
  "options": [ { "label": "Watercolor", "value": "Make it a soft watercolor style" } ]
}

Readiness + pacing for "readyToGenerate":
- Set true as soon as there is a concrete SUBJECT (the WHAT — what's depicted). Style is a refinement, not a gate: when the subject is clear but style is open, set true, nudge toward Generate, and put 3-5 style directions in "options" so picking one stays optional.
- Set false ONLY when the subject itself is too vague to draw anything (e.g. "something cool", "a design for my team") — then "message" is the ONE question that pins it down.
- Ask at most ONE clarifying question per new idea. Never ask two in a row: if the user's answer is still loose, go with your best interpretation and nudge toward Generate instead of asking again.

The "options" field (tappable quick-replies — THIS is how you offer choices):
- Whenever you ask a multiple-choice question or suggest directions to pick from, put each choice in "options" as { "label": short tappable text, "value": the full message sent as the user's reply if they tap it }.
- "label" is what the user taps — keep it short (1-3 words, e.g. "Watercolor", "Bold vector", "Vintage badge"). "value" is the natural-language turn submitted on tap (e.g. "Let's go with a vintage screen-print look").
- Offer 2-5 options. The user can still type freely instead — options are a shortcut, not the only path.
- Ask ONE question per turn. When several things are still open, pick the single most useful one and ask only that, with its choices as options. Do NOT stack multiple questions.
- NEVER enumerate choices in prose — not as a list and not mid-sentence. The chips render each choice once, right under your message; naming them in "message" too shows everything twice. Ask the question WITHOUT naming the choices:
  WRONG: "message": "Is it a situational joke (frog in a funny scenario), a pun caption, or a weird absurdist image?"
  RIGHT: "message": "A funny frog — love it. What's the vibe?" with options Funny scenario / Pun caption / Weird absurdist.
- No "1. / 2. / 3.", no "a) / b)", no hyphen or bullet lists of choices inside "message" — ever. Choices rendered in prose don't become tappable buttons, which breaks the phone UI. Every choice goes in "options"; "message" carries only the one question (plus a brief lead-in if needed).
- Omit "options" (or use []) when there's nothing to pick — a plain nudge or acknowledgement.

Style rules for the "message" field:
- Be terse and professional. 2-4 short sentences max.
- Use markdown sparingly: **bold** for emphasis, line breaks between sections. No numbered lists of choices — those go in "options".
- No filler, no flattery, no "great idea!" — just useful input.
- End with a short question or nudge toward Generate (e.g. "when you're ready, tap Generate").

Handling negations (for fresh designs — not refinements of an existing image):
When generating a design from scratch, the image model is text-to-image and does not subtract — telling it "no X" tends to surface X. When the user says what they DON'T want in a fresh design, restate the request in affirmative terms before going further. A refinement of an existing image instead goes to an instruction-edit model that handles changes and removals directly ("remove the lettering" works as stated), so this restating doesn't apply there.
- "no tongue" / "without his tongue out" → "mouth closed, lips together"
- "no text" / "no words" → "image only, no captions, clean composition"
- "not cartoonish" → ask what they want instead (clean illustration? vintage badge? hand-drawn?), then use that
- "no bubble letters" → "solid filled bold sans-serif lettering"
- "less busy" → "open composition, clear focal point, generous negative space"
Acknowledge the user's request in their words ("Got it — closed mouth, no tongue"), but think in affirmative visual targets. Carry the affirmative target forward when reasoning about follow-ups.

CRITICAL: The "message" field is conversational prose for the user — never put JSON, code blocks, or structured data INSIDE "message". The only JSON is the outer envelope described in Output format.

What the UI actually offers (do NOT invent other features):
- A chat box (this conversation).
- A "Generate" button that acts on the conversation so far — it makes a new image for a fresh idea, or edits the current design when the turn is a refinement of it.
- An image gallery showing past generations.
- Buttons to proceed to product preview / order.
- That's it. There is no "Remove Background" button, no inpainting, no manual editor, no layer tools, no upload-to-edit. If the user asks for something the UI doesn't have, say so plainly — do not invent an interaction. If the user insists a feature exists, do not capitulate; say you don't have a way to do that here.

Background transparency:
- Handled automatically server-side. The user does nothing. Don't tell them to click a button or apply a tool — there isn't one.

Print constraints you know:
- DTG on fabric, 12"x16" print area
- Clean lines, moderate ink, centered compositions
- Flat graphics and illustrations over photographic styles
- Text works well — Ideogram handles typography`;

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

const PROSE_LIST_ITEM = /^\s*(?:\d{1,2}[.)]\s+|[-*•]\s+)(.+)$/;
const MAX_PROSE_OPTION_WORDS = 5;

/**
 * Deterministic fallback for the "numbered list instead of options" failure:
 * despite the prompt, the model sometimes answers a multiple-choice question
 * as a numbered/bulleted list in prose, so no chips render. When a reply's
 * options are empty and the message ENDS with a short list of option-like
 * fragments, convert those lines into options and strip them from the prose.
 *
 * Deliberately conservative — only converts when ALL hold, so numbered
 * instructions or explanatory lists are left alone:
 * - the list is the trailing block of the message (nothing after it);
 * - 2–5 items, every one a short fragment (≤ 40 chars, ≤ 5 words) with no
 *   sentence-ending punctuation — instructions read as sentences, choices
 *   read as labels;
 * - prose remains before the list (the question survives the strip).
 *
 * Returns null when the message shouldn't be converted.
 */
export function extractProseOptions(
  text: string
): { message: string; options: ChatOption[] } | null {
  const lines = text.trimEnd().split("\n");
  const items: string[] = [];
  let i = lines.length - 1;
  while (i >= 0) {
    const m = lines[i].match(PROSE_LIST_ITEM);
    if (!m) break;
    items.unshift(m[1].trim());
    i--;
  }
  if (items.length < 2 || items.length > MAX_OPTIONS) return null;
  for (const item of items) {
    if (
      !item ||
      item.length > MAX_OPTION_LABEL ||
      item.split(/\s+/).length > MAX_PROSE_OPTION_WORDS ||
      /[.!?:;,]$/.test(item)
    ) {
      return null;
    }
  }
  const message = lines.slice(0, i + 1).join("\n").trimEnd();
  if (!message) return null;
  return {
    message,
    options: quickReplyFromOptions(items.map((label) => ({ label }))),
  };
}

/**
 * Apply the prose-list fallback to a parsed envelope: only when the model
 * sent no structured options does the message get scanned for a trailing
 * choice list. Structured options always win untouched.
 */
function withProseOptionsFallback<
  T extends { message: string; options: ChatOption[] },
>(envelope: T): T {
  if (envelope.options.length > 0) return envelope;
  const salvaged = extractProseOptions(envelope.message);
  return salvaged
    ? { ...envelope, message: salvaged.message, options: salvaged.options }
    : envelope;
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

  // Resolve the stored prompt for assistant messages via image_id →
  // design_image.prompt (carried on DesignImage entries from
  // getDesignImagesForAIContext). This is a spec summary for a generation or
  // an edit instruction for an edit — whichever produced that image.
  const promptByImageId = new Map(images.map((img) => [img.id, img.prompt]));

  const raw = chatHistory.map((msg) => {
    // Heal polluted history: an assistant row saved with an embedded JSON
    // envelope (a past parse failure) teaches the model to imitate the broken
    // prose+JSON format on every later turn — strip it before it goes back in.
    const content =
      msg.role === "assistant"
        ? (extractChatEnvelope(msg.content)?.message ?? msg.content)
        : msg.content;
    const storedPrompt =
      msg.role === "assistant" && msg.imageId
        ? promptByImageId.get(msg.imageId)
        : null;
    return {
      role: msg.role as "user" | "assistant",
      content: storedPrompt ? `${content}\n\nPrompt used: ${storedPrompt}` : content,
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
    return withProseOptionsFallback({
      message: typeof parsed.message === "string" ? parsed.message : text,
      readyToGenerate: parsed.readyToGenerate === true,
      options: quickReplyFromOptions(parsed.options),
    });
  } catch {
    // Mixed prose + envelope (the model sometimes emits both) — salvage the
    // envelope rather than showing the user the raw JSON blob.
    const envelope = extractChatEnvelope(text);
    if (envelope) return withProseOptionsFallback(envelope);
    return withProseOptionsFallback({
      message: text,
      readyToGenerate: false,
      options: [],
    });
  }
}

const READINESS_SYSTEM_PROMPT = `You judge whether a t-shirt design idea is concrete enough to draw. Reply with raw JSON only (no markdown fences):
{
  "ready": true | false,
  "question": "if not ready, ONE short question pinning down the subject; empty string if ready",
  "options": [ { "label": "Funny scenario", "value": "A frog in a funny scenario" } ]
}

Ready as soon as the SUBJECT (what is depicted) is concrete. Style/medium is NOT required — when it's unstated, the drawing step picks a fitting style the user can refine afterward. Not ready ONLY when the subject is too vague to draw anything (e.g. "something cool", "a shirt for my team"): then ask ONE question, with 2-5 likely directions in "options" as tappable chips { "label": short text, "value": the natural-language reply sent on tap }.
NEVER name the choices inside "question" — not as a numbered/bulleted list and not mid-sentence. "Is it a funny scenario, a pun caption, or something absurdist?" is WRONG; "What's the vibe?" with those three in "options" is RIGHT — chips render each choice once, and prose repeats them.
Ask at most one clarifying question per idea: if the conversation shows one was already asked, lean ready=true rather than asking another. Omit "options" (or use []) when ready. Keep "question" to 1-2 sentences; in user-facing copy say "generate" / "Generate" (the button label). When genuinely uncertain, lean ready=true — a real idea should never be blocked. When there are already images in this conversation and the turn reads as a refinement of one of them (e.g. "make it bigger", "different color"), always answer ready=true — the brief step handles edits, not this check.`;

/**
 * Fast pre-check used by Generate/Compare to decide "render vs ask" without
 * paying the heavy constructDesignBrief round-trip. Runs on Haiku with a tiny
 * prompt (~1s) instead of Sonnet + a 45-line system prompt + 1024 tokens
 * (~6s). Fails OPEN: any parse problem or a missing flag resolves to
 * ready=true so a concrete prompt is never blocked by a hiccup —
 * constructDesignBrief's own clarify path remains the backstop.
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
    const result = {
      ready: parsed.ready !== false,
      question: typeof parsed.question === "string" ? parsed.question : "",
      options: quickReplyFromOptions(parsed.options),
    };
    // Same prose-list fallback as chat: a clarifying question that enumerates
    // its choices as a numbered/bulleted list still renders tappable chips.
    if (!result.ready && result.options.length === 0 && result.question) {
      const salvaged = extractProseOptions(result.question);
      if (salvaged) {
        result.question = salvaged.message;
        result.options = salvaged.options;
      }
    }
    return result;
  } catch (err) {
    // Fail open: a parse problem, outage, or model error must never block a
    // real idea. constructDesignBrief's own clarify path remains the backstop.
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

const PUBLISH_NAMING_SYSTEM_PROMPT = `You title t-shirt designs being shared in a discover feed. Look at the image and the prompt that generated it, then return raw JSON (no markdown, no code fences):
{
  "title": "Short, 2-5 words, Title Case, no quotes, no trailing period. If the design has prominent text, you may use that text verbatim."
}`;

/**
 * Proposes a listing title for a published image. Descriptions are no
 * longer generated (2026-07-29 review: they read as AI filler).
 */
export async function generatePublishedNaming(
  imageUrl: string,
  prompt: string | null
): Promise<{ title: string }> {
  const fallback = { title: "Untitled Design" };
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
                ? `Prompt used to generate this image:\n${prompt}\n\nWrite the title.`
                : "Write the title.",
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
    return { title };
  } catch (err) {
    console.error("generatePublishedNaming failed:", err);
    return fallback;
  }
}

const DESIGN_BRIEF_SYSTEM_PROMPT = `You are a t-shirt design assistant for PRNTD. Translate the user's conversation into a structured design brief.

Respond with raw JSON only (no markdown, no code fences):
{
  "message": "Brief factual acknowledgment shown to the user (plain, no exclamation points)",
  "operation": "generate" | "edit" | "clarify",
  "spec": { ... },                 // required when operation is "generate"
  "editInstruction": "...",        // required when operation is "edit"
  "referenceImage": null or number // edit only: the # of the design being refined
}

Choosing the operation:
- "generate": the user wants a new design, or a different take on the idea (new subject, changed style, another version of the same concept).
- "edit": the user is refining an existing design — changing, adding, removing, or adjusting parts while keeping the rest ("make the bear larger", "remove the lettering", "different font"). The referenced image is sent to an instruction-edit model together with your editInstruction.
- "clarify": the subject is too vague to draw anything; put the single question in "message". Only a missing subject warrants clarify — if style is unstated, pick one that suits the subject and say which you chose in "message".

The spec (operation "generate"):
{
  "subject": "One or two sentences describing the whole design.",
  "style": {
    "aesthetics": "mood, vibe, texture cues",
    "artStyle": "e.g. woodcut illustration, sumi-e brush painting",
    "medium": "e.g. screen print, pen and ink",
    "lighting": "only when it matters",
    "colorPalette": ["#RRGGBB"]    // only when the user expressed color intent; soft bias, not a lock
  },
  "elements": [
    { "type": "obj", "desc": "a concrete visual element" },
    { "type": "text", "text": "LITERAL TEXT TO RENDER", "desc": "typography style and placement notes" }
  ]
}
"subject" and at least one element are required — never emit a spec without a concrete subject.

Print specifications (physics, not taste):
- DTG printing, 12" x 16" print area.
- The design is generated on a transparent background automatically — never mention backgrounds in any field.
- Favor open, breathable compositions — avoid dense block prints (ink coverage matters for DTG).
- Flat graphic / artwork only — NEVER a picture of a t-shirt. Never the words "t-shirt", "shirt", or "mockup" in any field.

Style — be faithful to the user's intent:
- DO NOT default to clean / vector / digital illustration unless asked.
- Hand-painted, brushy, distressed, vintage, zine etc.: write concrete texture cues into "artStyle"/"aesthetics" and element descs ("sumi-e brush strokes, uneven ink pressure, ink pooling at stroke ends", "halftone screen-print, deliberate ink gaps, slight registration offset").
- If the user is silent on style, pick one that suits the subject and say which you chose in "message" — do not stop to ask.
- Never override the user's stated style because you think a different style would print better; if a style genuinely conflicts with print constraints, explain in "message".
- Style vocabulary translation tips:
  - "brushy" / "hand-painted" → "sumi-e brush strokes, uneven ink pressure, ink pooling at stroke ends, raw bristle texture, imperfect edges"
  - "distressed" / "vintage" → "halftone screen-print, deliberate ink gaps, slight registration offset, worn texture, faded mid-tones"
  - "hand-drawn" → "pencil or pen lines with slight wobble, no perfect curves, visible mark-making"
  - "punk zine" → "cut-and-paste collage, photocopied texture, deliberate misalignment, stark high contrast"

Affirmative-only fields:
- There is no negative-prompt channel. Every spec field describes only what SHOULD appear. Translate negations into positive targets ("mouth closed, calm expression" not "no tongue"; "solid filled bold block lettering" not "no bubble letters"; "open composition, clear focal point, generous negative space" not "less busy").
- To push away from a default the model likes, state the desired quality concretely in "aesthetics" ("raw bristle texture, uneven ink pressure" rather than "not smooth").

Text in designs:
- Put literal text in a text element's "text" field exactly as it should render; typography intent goes in that element's "desc" and must match the user's style intent.
- If the user wants no text, emit no text elements and never mention text anywhere.

Edits (operation "edit"):
- editInstruction states what should change and what must stay ("make the bear larger; keep the lettering, colors, and composition unchanged"). Do not re-describe the whole design.
- The edit model handles removal instructions directly: "remove the lettering under the figure" is correct here.
- Set "referenceImage" to the # of the design being refined (from the gallery context); null if the user didn't say — the latest design is assumed.`;

export type DesignBrief =
  | { operation: "clarify"; message: string }
  | { operation: "generate"; message: string; spec: DesignSpec }
  | { operation: "edit"; message: string; editInstruction: string; referenceImage: number | null };

export async function constructDesignBrief(
  chatHistory: ChatMessage[],
  images: DesignImage[],
  userMessage?: string
): Promise<DesignBrief> {
  const { messages, galleryContext } = buildMessages(chatHistory, images, userMessage);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: DESIGN_BRIEF_SYSTEM_PROMPT + galleryContext,
    messages,
  });

  let text = response.content?.[0]?.type === "text" ? response.content[0].text : "";
  if (!text) {
    console.error("constructDesignBrief: empty response from Claude");
    return { operation: "clarify", message: "Tell me what you'd like on the shirt." };
  }
  text = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Prose means Claude answered in chat, not with a brief (#137): surface
    // it and render nothing.
    return { operation: "clarify", message: text };
  }

  // Valid JSON can still be non-object (e.g. `null`, `42`) — parsed.message
  // would throw on null. Treat it the same as unparseable prose.
  if (typeof parsed !== "object" || parsed === null) {
    return { operation: "clarify", message: text };
  }

  const message =
    typeof parsed.message === "string" && parsed.message.trim()
      ? parsed.message.trim()
      : "Tell me what you'd like on the shirt.";

  if (parsed.operation === "generate") {
    const spec = parseDesignSpec(parsed.spec);
    if (!spec) {
      console.error("constructDesignBrief: generate with invalid spec, downgrading to clarify");
      return { operation: "clarify", message };
    }
    return { operation: "generate", message, spec };
  }

  if (parsed.operation === "edit") {
    const editInstruction =
      typeof parsed.editInstruction === "string" && parsed.editInstruction.trim()
        ? parsed.editInstruction.trim()
        : null;
    if (!editInstruction) {
      console.error("constructDesignBrief: edit with empty instruction, downgrading to clarify");
      return { operation: "clarify", message };
    }
    const referenceImage =
      typeof parsed.referenceImage === "number" ? parsed.referenceImage : null;
    return { operation: "edit", message, editInstruction, referenceImage };
  }

  return { operation: "clarify", message };
}
