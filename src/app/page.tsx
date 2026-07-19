import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { HomeHero } from "@/components/home-hero";
import { MakerHero } from "@/components/maker-hero";
import { PublishedGrid } from "@/components/published-grid";
import { getUserDesigns } from "./designs/actions";
import { getDiscoverFeed } from "./d/actions";
import { getActivePromo } from "@/lib/promotion";
import { publishedBackdrop } from "@/lib/blanks";
import { minRetailPrice } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [discover, promo, session] = await Promise.all([
    getDiscoverFeed(12),
    getActivePromo(),
    auth.api.getSession({ headers: await headers() }),
  ]);
  const isLoggedIn = !!session;
  // Proof strip under the signed-out hero: real published designs, framed as
  // what chatting here produces. No invented prompts (recovered designs don't
  // have them); omitted entirely when the feed is empty.
  const proof = discover.slice(0, 2);

  return (
    <div className="min-h-screen flex flex-col">
      {isLoggedIn ? (
        <HomeHero getRecentDesigns={getUserDesigns} />
      ) : (
        <MakerHero />
      )}

      {!isLoggedIn && proof.length > 0 && (
        <section className="py-12 px-4">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-lg font-semibold text-center mb-6">
              Made by chatting here
            </h2>
            <div className="grid grid-cols-2 gap-4">
              {proof.map((img) => {
                const backdrop = publishedBackdrop(img.backgroundColor);
                return (
                  <Link
                    key={img.imageId}
                    href={`/d/${img.imageId}`}
                    className="group block"
                  >
                    <div
                      className={`aspect-square rounded-md overflow-hidden border border-border group-hover:border-accent transition-colors ${backdrop.className}`}
                      style={backdrop.style}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.imageUrl}
                        alt={img.title ?? "Design"}
                        className="w-full h-full object-contain"
                      />
                    </div>
                    {img.title && (
                      <p className="mt-2 text-sm font-medium truncate">
                        {img.title}
                      </p>
                    )}
                    <p className="text-xs text-text-muted truncate">
                      by {img.designerName}
                    </p>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

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
        <section className="py-16 px-4 border-t border-border">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-2xl font-bold text-center mb-2">Shop</h2>
            <p className="text-text-muted text-center mb-8">
              Browse and buy designs other makers have published.
            </p>
            <PublishedGrid images={discover} />
            <div className="text-center mt-8">
              <Link
                href="/prints"
                className="text-sm text-text-muted underline hover:text-foreground transition-colors"
              >
                See the whole Shop →
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
