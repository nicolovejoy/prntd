import Link from "next/link";
import { HomeHeader } from "@/components/home-header";
import { HomeHero } from "@/components/home-hero";
import { getUserDesigns } from "./designs/actions";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <HomeHeader />
      <HomeHero getRecentDesigns={getUserDesigns} />

      <section className="py-16 px-4 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-12">How it works</h2>
          <div className="grid md:grid-cols-3 gap-8 text-center">
            <div className="space-y-3">
              <div className="text-3xl font-bold text-text-faint">1</div>
              <h3 className="font-semibold text-lg">Describe</h3>
              <p className="text-text-muted">
                Type what you want on your shirt. A logo, illustration, text —
                whatever.
              </p>
            </div>
            <div className="space-y-3">
              <div className="text-3xl font-bold text-text-faint">2</div>
              <h3 className="font-semibold text-lg">Refine</h3>
              <p className="text-text-muted">
                Preview the design on a shirt. Ask for changes until it looks
                right.
              </p>
            </div>
            <div className="space-y-3">
              <div className="text-3xl font-bold text-text-faint">3</div>
              <h3 className="font-semibold text-lg">Order</h3>
              <p className="text-text-muted">
                Pick size and color. Pay. Shirt shows up.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-surface">
        <div className="max-w-2xl mx-auto text-center space-y-4">
          <h2 className="text-2xl font-bold">Pricing</h2>
          <p className="text-text-muted">
            Designing is free. You pay when you order. Shirts start at{" "}
            <span className="font-semibold text-foreground">$29</span>.
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
      </footer>
    </div>
  );
}
