"use client";

import { useEffect, useState } from "react";
import { EXAMPLE_CATEGORIES, pickExamplePrompts } from "@/lib/design-examples";

/**
 * Deterministic trio for SSR and first paint: the first prompt of the first
 * `count` categories. Picking randomly during render would make the server
 * HTML and the client's first render disagree (hydration mismatch), so this
 * has to be pure and stable across server and client.
 */
function deterministicPrompts(count: number): string[] {
  return EXAMPLE_CATEGORIES.slice(0, count).map((category) => category.prompts[0]);
}

/**
 * `count` example prompts, one per distinct category. Renders the same
 * deterministic trio on the server and on first client paint, then re-picks
 * randomly once mounted — after hydration has already reconciled, so the
 * randomized set never causes a mismatch.
 */
export function useExamplePrompts(count: number): string[] {
  const [prompts, setPrompts] = useState<string[]>(() => deterministicPrompts(count));

  useEffect(() => {
    setPrompts(pickExamplePrompts(count));
    // count is expected to be a stable literal per call site; re-running on
    // every render would defeat the point of picking once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return prompts;
}
