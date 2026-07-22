"use client";

import { useEffect, useRef } from "react";
import { getDesign, getDesignChat } from "@/app/design/actions";
import { warmDesignThread } from "@/lib/design-thread-cache";

/**
 * Wraps a /designs card and prefetches its design thread (#87) when the card
 * scrolls into view, or on touch/hover intent — so tapping through to
 * /design?id= hydrates from cache instead of flashing an empty composer.
 *
 * Renders the card's own container element (no extra DOM) so grid layout is
 * unchanged. Warming is deduped in the cache and fired at most once per mount;
 * only viewport-visible/intended cards warm, which caps volume on long lists.
 */
export function WarmOnView({
  designId,
  className,
  children,
}: {
  designId: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const warmed = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const warm = () => {
      if (warmed.current) return;
      warmed.current = true;
      warmDesignThread(designId, async () => {
        const [design, chat] = await Promise.all([
          getDesign(designId),
          getDesignChat(designId),
        ]);
        return {
          design: design
            ? { displayImageUrl: design.displayImageUrl }
            : null,
          chat,
        };
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          warm();
          observer.disconnect();
        }
      },
      // Warm a little before the card is fully on screen.
      { rootMargin: "200px" }
    );
    observer.observe(el);

    // Phone-first: touchstart is the tap precursor (no hover on touch);
    // mouseenter covers pointer devices.
    el.addEventListener("touchstart", warm, { passive: true });
    el.addEventListener("mouseenter", warm);

    return () => {
      observer.disconnect();
      el.removeEventListener("touchstart", warm);
      el.removeEventListener("mouseenter", warm);
    };
  }, [designId]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
