"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { EXAMPLES } from "@/lib/design-examples";
import { minRetailPrice } from "@/lib/pricing";

/**
 * Landing hero for all visitors — the composer IS the landing. Typing an
 * idea (or tapping a chip) navigates to /design?prompt=…, which auto-fires a
 * generation. Unlike the in-chat chips (which prefill), landing chips
 * navigate immediately: here they demo the product. The sub-line is the
 * one-line basics of the offer (#75); price comes from minRetailPrice().
 */
export function MakerHero() {
  const router = useRouter();
  const [input, setInput] = useState("");

  function go(text: string) {
    const msg = text.trim();
    if (!msg) return;
    router.push(`/design?prompt=${encodeURIComponent(msg)}`);
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-6 sm:py-16 text-center">
      <div className="w-full max-w-2xl space-y-4 sm:space-y-6">
        <h1 className="text-2xl sm:text-5xl font-bold tracking-tight">
          Design a shirt by describing it.
        </h1>
        <p className="text-base sm:text-lg text-text-muted max-w-lg mx-auto">
          Free to design. Generated in seconds. Printed and shipped from $
          {minRetailPrice().toFixed(2)}.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe a design"
            className="flex-1 min-h-[44px] px-3 py-2 bg-surface border border-border rounded-md text-white placeholder:text-text-faint focus:border-border-hover focus:outline-none"
          />
          <Button
            type="submit"
            variant="primary"
            className="min-h-[44px]"
            disabled={!input.trim()}
          >
            Generate
          </Button>
        </form>
        {/* Mobile: one horizontally scrollable row (bleeds to the screen edge);
            desktop: centered wrap. Keeps the hero short enough that the Shop
            feed's first cards stay above the fold on a phone. */}
        <div className="flex flex-nowrap overflow-x-auto -mx-4 px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-x-visible sm:mx-0 sm:px-0 sm:justify-center gap-2">
          {EXAMPLES.slice(0, 3).map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => go(example)}
              className="shrink-0 whitespace-nowrap text-xs px-3 py-2 min-h-[44px] border border-border rounded-full text-text-muted hover:text-foreground hover:border-border-hover transition-colors"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
