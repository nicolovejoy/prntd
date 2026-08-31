// What counts as a typed request to generate. Pure so it can be tested
// directly — `chat-panel.tsx` is a client component and `design/actions.ts`
// is "use server" (async exports only).

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

/**
 * The most recent thing the user actually asked for. Used as the fallback
 * subject when a generate turn carries no message of its own (the Generate
 * button tapped on an empty composer) and the brief declined to produce a
 * spec — their last words are still a concrete request to render.
 *
 * Structurally typed so it works on chat rows without importing the schema.
 */
export function latestUserText(
  messages: { role: string; content: string }[]
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    const content = messages[i].content.trim();
    if (content) return content;
  }
  return null;
}
