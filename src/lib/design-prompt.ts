// Guards around generation: what counts as a request to generate, and what
// counts as a prompt worth sending to the image model. Pure so they can be
// tested directly — `design/actions.ts` is "use server" and can only export
// async functions, and `chat-panel.tsx` is a client component.

// "draw it"/"draw" kept for muscle memory from the old button label; typing
// any of these behaves like tapping Generate.
const GENERATE_TRIGGERS =
  /^(yes|yeah|yep|do it|go|generate|draw it|draw|let'?s do it|go ahead|make it|yes please|sure|ok generate)/i;

// A prefix match alone can't tell "make it again" (intent) from "make it
// again, but … name 5 good metaphors" (a question that happens to start the
// same way) — the latter rendered an unwanted image in prod (#137). Real
// generate-intent turns are short and aren't asking anything, so require both
// before routing a turn away from chat.
const MAX_GENERATE_INTENT_LENGTH = 40;

/** True when a typed turn should behave like tapping Generate. */
export function isGenerateIntent(message: string): boolean {
  const msg = message.trim();
  return (
    msg.length <= MAX_GENERATE_INTENT_LENGTH &&
    !msg.includes("?") &&
    GENERATE_TRIGGERS.test(msg)
  );
}

// Style descriptors that say how to render but never what to render. A prompt
// built only from these has no subject, so the image model invents one (#137:
// "graphic design illustration, high quality, printable" → a random flower).
const STYLE_ONLY_TERMS = new Set([
  "graphic",
  "design",
  "graphic design",
  "graphic design illustration",
  "illustration",
  "high quality",
  "printable",
  "white background",
  "isolated design",
  "vector",
  "flat",
]);

/**
 * True when a prompt carries styling but no subject — every comma-separated
 * clause is a generic style descriptor. Sending one to Ideogram burns quota
 * and cost on an image nobody asked for.
 */
export function isSubjectlessPrompt(fluxPrompt: string): boolean {
  const clauses = fluxPrompt
    .toLowerCase()
    .split(",")
    .map((c) => c.trim().replace(/[.!]+$/, ""))
    .filter(Boolean);
  return clauses.length > 0 && clauses.every((c) => STYLE_ONLY_TERMS.has(c));
}

/**
 * Claude declines to generate and asks a clarifying question (e.g. when the
 * user hasn't specified a style) by returning an empty fluxPrompt. Detect
 * that so we surface the question in chat instead of sending an empty prompt
 * to the image model, which 400s.
 *
 * Also catches subjectless style boilerplate (#137) — same outcome wanted
 * (answer in chat, render nothing), different shape of degenerate prompt.
 */
export function isClarificationOnly(
  fluxPrompt: string | null | undefined
): boolean {
  if (!fluxPrompt || fluxPrompt.trim() === "") return true;
  return isSubjectlessPrompt(fluxPrompt);
}
