// Provider-neutral structured design brief. A spec REQUIRES a concrete
// subject and at least one element, which makes the #137 failure class
// (style boilerplate with no subject reaching the image model)
// unrepresentable instead of guarded against. Rendering to a provider's
// wire format lives in that provider's adapter, not here.

export type DesignSpecElement =
  | { type: "obj"; desc: string; colorPalette?: string[] }
  | { type: "text"; text: string; desc?: string; colorPalette?: string[] };

export type DesignSpecStyle = {
  aesthetics?: string;
  artStyle?: string;
  medium?: string;
  lighting?: string;
  colorPalette?: string[];
};

export type DesignSpec = {
  subject: string;
  style?: DesignSpecStyle;
  elements: DesignSpecElement[];
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Cap on a fallback subject: a pasted essay is not a subject line. */
const MAX_FALLBACK_SUBJECT = 400;

/** A prompt at or under this many words is treated as lettering, not a scene to draw (#206). */
const MAX_SLOGAN_WORDS = 8;

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanPalette(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const hexes = value.filter((v): v is string => typeof v === "string" && HEX_COLOR.test(v));
  return hexes.length > 0 ? hexes : undefined;
}

function parseElement(input: unknown): DesignSpecElement | null {
  if (typeof input !== "object" || input === null) return null;
  const el = input as Record<string, unknown>;
  const palette = cleanPalette(el.colorPalette);
  if (el.type === "obj") {
    const desc = cleanString(el.desc);
    if (!desc) return null;
    return { type: "obj", desc, ...(palette ? { colorPalette: palette } : {}) };
  }
  if (el.type === "text") {
    const text = cleanString(el.text);
    if (!text) return null;
    const desc = cleanString(el.desc);
    return {
      type: "text",
      text,
      ...(desc ? { desc } : {}),
      ...(palette ? { colorPalette: palette } : {}),
    };
  }
  return null;
}

/** Validate an untrusted candidate (Claude output) into a DesignSpec, or null. */
export function parseDesignSpec(input: unknown): DesignSpec | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  const subject = cleanString(raw.subject);
  if (!subject) return null;
  if (!Array.isArray(raw.elements) || raw.elements.length === 0) return null;
  const elements: DesignSpecElement[] = [];
  for (const candidate of raw.elements) {
    const el = parseElement(candidate);
    if (!el) return null;
    elements.push(el);
  }
  let style: DesignSpecStyle | undefined;
  if (typeof raw.style === "object" && raw.style !== null) {
    const s = raw.style as Record<string, unknown>;
    const built: DesignSpecStyle = {};
    const aesthetics = cleanString(s.aesthetics);
    const artStyle = cleanString(s.artStyle);
    const medium = cleanString(s.medium);
    const lighting = cleanString(s.lighting);
    const colorPalette = cleanPalette(s.colorPalette);
    if (aesthetics) built.aesthetics = aesthetics;
    if (artStyle) built.artStyle = artStyle;
    if (medium) built.medium = medium;
    if (lighting) built.lighting = lighting;
    if (colorPalette) built.colorPalette = colorPalette;
    if (Object.keys(built).length > 0) style = built;
  }
  return { subject, ...(style ? { style } : {}), elements };
}

/**
 * The last-resort spec, built from the user's own words. Generate always
 * generates (studio slice 1): the fallback fires only when the brief
 * declined to produce a spec — it found nothing drawable — and the literal
 * request is still something concrete to render, alongside whatever
 * question the brief wanted to ask.
 *
 * For a short prompt (at most MAX_SLOGAN_WORDS words, one line) the words
 * ARE the design — a slogan, a quip — so they render as bold lettering
 * rather than as an object description of a sentence (#206). A prompt that
 * had to be truncated to MAX_FALLBACK_SUBJECT is never treated as a slogan:
 * quoting a cut-off fragment as the literal design text would be worse than
 * describing it as an object.
 *
 * Returns null only when there are no words at all to render.
 */
export function fallbackSpec(text: string | null | undefined): DesignSpec | null {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return null;
  const subject = trimmed.slice(0, MAX_FALLBACK_SUBJECT);
  const wasTruncated = subject.length < trimmed.length;
  const wordCount = subject.split(/\s+/).filter(Boolean).length;
  if (!wasTruncated && wordCount <= MAX_SLOGAN_WORDS && !subject.includes("\n")) {
    const words = subject;
    return {
      subject: `Bold lettering reading "${words}"`,
      elements: [
        {
          type: "text",
          text: words,
          desc: "bold lettering, the user's words exactly, centered",
        },
      ],
    };
  }
  return { subject, elements: [{ type: "obj", desc: subject }] };
}

/**
 * Human-readable one-liner for storage/display ("Prompt used:" context,
 * published-naming input). The structured spec itself is not persisted in
 * this slice.
 */
export function renderSpecSummary(spec: DesignSpec): string {
  const parts: string[] = [spec.subject];
  const styleBits = [
    spec.style?.artStyle,
    spec.style?.medium,
    spec.style?.aesthetics,
  ].filter((s): s is string => Boolean(s));
  if (styleBits.length > 0) parts.push(styleBits.join(", "));
  const texts = spec.elements
    .filter((el): el is Extract<DesignSpecElement, { type: "text" }> => el.type === "text")
    .map((el) => `text: "${el.text}"`);
  parts.push(...texts);
  return parts.join(" — ");
}
