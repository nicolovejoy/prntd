// Pure prompt helpers, kept out of `design/actions.ts` ("use server": async
// exports only) so they can be tested directly.

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
