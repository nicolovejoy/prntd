import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "./db/schema";
import type { DesignImage } from "./design-images";
import { parseDesignSpec, type DesignSpec } from "./design-spec";
import { DESIGN_BRIEF_TIMEOUT_MS } from "./lost-submit";
import {
  imageGalleryLine,
  imageHistoryNote,
  type ProvenanceNode,
} from "./image-provenance";

const anthropic = new Anthropic();

/**
 * A gallery entry as the provenance helper sees it (#169). `image.prompt` is a
 * scene summary for a generate and an edit INSTRUCTION for an edit, so the
 * context has to say which; rows written before #169 carry no operation and
 * keep the old wording.
 */
function toProvenanceNode(img: DesignImage): ProvenanceNode {
  return {
    id: img.id,
    operation: img.operation ?? null,
    designSpec: img.designSpec ?? null,
    prompt: img.prompt,
    parentImageId: img.parentImageId ?? null,
  };
}

function buildImageGalleryContext(images: DesignImage[]): string {
  if (images.length === 0) return "";
  const lines = images.map((img) =>
    imageGalleryLine(toProvenanceNode(img), img.number)
  );
  return `\nImages so far:\n${lines.join("\n")}\n\nEntries marked [user upload] are reference images the user provided. Use them as style/content inspiration; a photo anchored on this turn is described in a "generate" spec, never edited. When the user references images by number (e.g., "#2"), you know which image they mean.`;
}

/**
 * Pull the stored reply out of an old assistant chat row that mixes prose with
 * a JSON envelope. Ask-era turns were written that way when a parse failed;
 * `buildMessages` strips the envelope before the history goes back to the
 * model, and scripts/clean-chat-envelopes.ts rewrites the stored rows. The
 * prose is a duplicate of envelope.message, so the envelope wins. Returns null
 * when no parseable envelope is present.
 */
export function extractChatEnvelope(text: string): { message: string } | null {
  const start = text.search(/\{\s*"message"\s*:/);
  if (start === -1) return null;
  for (const end of [text.length, text.lastIndexOf("}") + 1]) {
    if (end <= start) continue;
    try {
      const parsed = JSON.parse(text.slice(start, end));
      if (typeof parsed.message === "string") {
        return { message: parsed.message };
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
  userMessage?: string,
  anchor?: DesignImage | null
) {
  const galleryContext = buildImageGalleryContext(images);

  // Resolve what each assistant message's image actually is, via image_id →
  // the image row's operation + prompt/spec (carried on DesignImage entries
  // from getDesignImagesForAIContext). #169: a bare prompt string is a scene
  // summary for a generate and an edit instruction for an edit, so the note
  // says which.
  const noteByImageId = new Map(
    images.map((img) => [img.id, imageHistoryNote(toProvenanceNode(img))])
  );

  const raw = chatHistory.map((msg) => {
    // Heal polluted history: an assistant row saved with an embedded JSON
    // envelope (a past parse failure) teaches the model to imitate the broken
    // prose+JSON format on every later turn — strip it before it goes back in.
    const content =
      msg.role === "assistant"
        ? (extractChatEnvelope(msg.content)?.message ?? msg.content)
        : msg.content;
    const note =
      msg.role === "assistant" && msg.imageId
        ? noteByImageId.get(msg.imageId)
        : null;
    return {
      role: msg.role as "user" | "assistant",
      content: note ? `${content}\n\n${note}` : content,
    };
  });

  if (userMessage) {
    raw.push({ role: "user" as const, content: userMessage });
  }

  // Merge consecutive same-role messages (Anthropic requires alternating roles)
  const merged: typeof raw = [];
  for (const msg of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role) {
      prev.content += "\n\n" + msg.content;
    } else {
      merged.push({ ...msg });
    }
  }
  const messages: Anthropic.MessageParam[] = merged;

  // Sonnet 4.6 requires messages to end with a user turn (no assistant prefill)
  if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
    messages.push({ role: "user", content: "Generate an image based on this conversation." });
  }

  // A photo anchor goes to the model as an image so the spec is written from
  // what the photo shows (#356). The photo is described, never edited.
  const lastMessage = messages[messages.length - 1];
  if (
    anchor?.operation === "upload" &&
    lastMessage?.role === "user" &&
    typeof lastMessage.content === "string"
  ) {
    lastMessage.content = [
      { type: "image", source: { type: "url", url: anchor.url } },
      { type: "text", text: lastMessage.content },
    ];
  }

  return { messages, galleryContext };
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
  /**
   * Pre-rendered provenance text (#169) — the design brief for a generate, or
   * the original brief plus the edits applied since. Built by
   * getImageNamingContext; null when the image has nothing recorded.
   */
  promptContext: string | null
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
              text: promptContext
                ? `${promptContext}\n\nWrite the title.`
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

export const DESIGN_BRIEF_SYSTEM_PROMPT = `You are a t-shirt design assistant for PRNTD. Translate the user's conversation into a structured design brief.

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
- A photo the user attached to this turn is never edited: emit "generate" and write a spec that describes what is in the photo (subject, composition, what to keep) in the style the user asked for, as a cut-out shirt graphic with no background. Never emit "edit" for a photo.
- "clarify": ONLY when the conversation contains no design request at all to interpret. This is close to never.
- A short phrase with no drawable subject — a slogan, a quip, a sentence — IS a design request: it is lettering. Emit a text element carrying the user's exact words, add an illustration only if one follows naturally from the words, and never answer it with "clarify".

A generate request always produces an image. A thin or ambiguous idea is not a reason to withhold one: commit to your best interpretation, emit the spec, and put your question in "message" — the user sees the image and the question together, and answers it on the next turn. "Something with a dog" is enough; "dog doing calisthenics" is more than enough. Never answer a request for a design with a question instead of a design.

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
"subject" and at least one element are required — never emit a spec without a concrete subject. When the user was vague, invent the concrete detail rather than asking for it, and say in "message" what you chose.

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
- When the user's turn reads as the text to print, the text element's "text" is those words unchanged (letter case may follow the typography). Do not paraphrase, shorten, or replace them with your own phrasing.
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
  userMessage?: string,
  anchor?: DesignImage | null
): Promise<DesignBrief> {
  const { messages, galleryContext } = buildMessages(chatHistory, images, userMessage, anchor);

  const response = await anthropic.messages.create(
    {
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: DESIGN_BRIEF_SYSTEM_PROMPT + galleryContext,
      messages,
    },
    // Bounds the only slow step before generateDesign writes its job row
    // (#245): the Studio's lost-submit reconcile window is finite only
    // because this call can't hang past it (the SDK default is 10 minutes
    // across 3 retries, with no bound of its own).
    { signal: AbortSignal.timeout(DESIGN_BRIEF_TIMEOUT_MS) }
  );

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
