import Link from "next/link";
import { MakerHero } from "@/components/maker-hero";
import { PublishedGrid } from "@/components/published-grid";
import { getDiscoverFeed } from "./d/actions";
import { getActivePromo } from "@/lib/promotion";

export const dynamic = "force-dynamic";

// One layout for all visitors (#75): composer-first hero, Shop feed below.
// No signed-in divergence and no session read: a nav-remap on 2026-09-01
// redirected signed-in users to /studio from here, and the owner reversed it
// on 2026-09-07 — the Studio is one tap away in the header (nav model A),
// and the homepage should be the same page for everyone.
export default async function Home() {
  const [discover, promo] = await Promise.all([
    getDiscoverFeed(12),
    getActivePromo(),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <MakerHero />

      {promo && (
        <section className="py-4 px-4 bg-accent/10 border-y border-accent/20 text-center">
          <p className="text-sm">
            <span className="font-medium">{promo.blurb}</span> with code{" "}
            <code className="px-1.5 py-0.5 bg-accent/20 rounded text-accent font-mono text-xs">
              {promo.code}
            </code>{" "}
            at checkout
          </p>
        </section>
      )}

      {discover.length > 0 && (
        <section className="py-8 sm:py-16 px-4 border-t border-border">
          <div className="max-w-6xl mx-auto">
            <div className="mb-4 sm:mb-8 flex items-baseline justify-between gap-4">
              <h2 className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
                Shop
              </h2>
              <Link
                href="/shop"
                className="text-sm underline underline-offset-[3px] hover:text-text-muted transition-colors"
              >
                See all
              </Link>
            </div>
            {/*
              from="/" records the true origin (previously omitted). It is
              currently inert: src/lib/nav.ts's detailParent() has no case for
              "/" and falls to its Shop default either way, matching what an
              omitted `from` already does. Kept anyway so the link states its
              real origin and a future detailParent case for "/" (routing an
              image-page Escape back to the homepage) is a nav.ts-only change.
            */}
            <PublishedGrid images={discover} from="/" />
          </div>
        </section>
      )}

      <footer className="py-8 px-4 border-t border-border text-center text-sm text-text-faint space-y-2">
        <p>PRNTD</p>
        <p>
          Questions?{" "}
          <a
            href="mailto:hello@prntd.org"
            className="underline hover:text-text-muted"
          >
            hello@prntd.org
          </a>
        </p>
      </footer>
    </div>
  );
}
