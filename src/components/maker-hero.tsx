"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { EXAMPLES } from "@/lib/design-examples";

/**
 * Signed-out landing hero — the composer IS the landing. Typing an idea (or
 * tapping a chip) navigates to /design?prompt=…, which auto-fires Draw-it.
 * Unlike the in-chat chips (which prefill), landing chips navigate
 * immediately: here they demo the product.
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
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-16 text-center">
      <div className="w-full max-w-2xl space-y-6">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
          Type an idea. Wear it.
        </h1>
        <p className="text-lg text-text-muted max-w-lg mx-auto">
          AI draws your design in seconds. Free to try — pay only if you
          order.
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
            placeholder="Describe your design..."
            className="flex-1 min-h-[44px] px-3 py-2 bg-surface border border-border rounded-md text-white placeholder:text-text-faint focus:border-border-hover focus:outline-none"
          />
          <Button
            type="submit"
            variant="primary"
            className="min-h-[44px]"
            disabled={!input.trim()}
          >
            Draw it
          </Button>
        </form>
        <div className="flex flex-wrap justify-center gap-2">
          {EXAMPLES.slice(0, 3).map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => go(example)}
              className="text-xs px-3 py-2 min-h-[44px] border border-border rounded-full text-text-muted hover:text-foreground hover:border-border-hover transition-colors"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
