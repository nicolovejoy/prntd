import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { MakerHero } from "@/components/maker-hero";
import { PublishedGrid } from "@/components/published-grid";
import { getDiscoverFeed } from "./d/actions";
import { getActivePromo } from "@/lib/promotion";
import { minRetailPrice } from "@/lib/pricing";
import { auth, isAnonymousUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// One layout for all visitors (#75): composer-first hero (with the one-line
// basics of the offer), Shop feed below. No signed-in divergence — the old
// proof strip is gone too (it duplicated the feed two sections down).
//
// The session read below reverses that, on purpose (nav-remap, 2026-09-01):
// #75 killed a divergence between two different *homepages*; this is a
// redirect to a different surface entirely (the Studio, where a signed-in
// user's work actually lives — studio-plan.md slice 5's landing
// recommendation, pulled forward). Anonymous guest-funnel sessions are
// excluded — requireRealUser would bounce them straight to /sign-in, which
// is a worse landing than the composer they already have here.
export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session && !isAnonymousUser(session.user)) redirect("/studio");

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
            <h2 className="text-2xl font-bold text-center mb-4 sm:mb-8">Shop</h2>
            <PublishedGrid images={discover} />
            <div className="text-center mt-8">
              <Link
                href="/prints"
                className="text-sm text-text-muted underline hover:text-foreground transition-colors"
              >
                See all →
              </Link>
            </div>
          </div>
        </section>
      )}

      <section className="py-16 px-4 bg-surface">
        <div className="max-w-2xl mx-auto text-center space-y-4">
          <h2 className="text-2xl font-bold">Pricing</h2>
          <p className="text-text-muted">
            Designing is free. You pay when you order. Tees from{" "}
            <span className="font-semibold text-foreground">
              ${minRetailPrice().toFixed(2)}
            </span>
            .
          </p>
        </div>
      </section>

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
        <p>
          <Link href="/dashboard" className="underline hover:text-text-muted">
            Open a shop →
          </Link>
        </p>
      </footer>
    </div>
  );
}
