"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ensureGuestSession } from "@/lib/ensure-guest-session";
import {
  getComposableDesigns,
  createProductDraft,
  type ComposableDesign,
} from "../../actions";
import { ComposeForm } from "../compose-form";

export default function NewProductPage() {
  return (
    <Suspense fallback={<div className="max-w-2xl mx-auto px-4 py-6 text-sm text-text-faint">Loading…</div>}>
      <NewProductForm />
    </Suspense>
  );
}

function NewProductForm() {
  const router = useRouter();
  const storeId = useSearchParams().get("store");
  const [designs, setDesigns] = useState<ComposableDesign[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await ensureGuestSession();
        setDesigns(await getComposableDesigns());
      } catch {
        setDesigns([]);
      }
    })();
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <button
        onClick={() => router.push("/dashboard")}
        className="text-sm text-text-muted hover:text-foreground"
      >
        ← Dashboard
      </button>
      <h1 className="mt-2 text-xl font-semibold">Add a product</h1>
      <p className="mt-1 text-sm text-text-muted">
        Pick a design, a blank, and a price. Your team gets what&apos;s left after costs.
      </p>

      {designs === null ? (
        <p className="mt-5 text-sm text-text-faint">Loading…</p>
      ) : (
        <ComposeForm
          designs={designs}
          submitLabel="Add to shop"
          onSubmit={async (v) => {
            await createProductDraft({
              designId: v.designId,
              blankId: v.blankId,
              storeId: storeId ?? null,
              placements: v.placements,
              price: v.price,
            });
            router.push("/dashboard");
          }}
        />
      )}
    </div>
  );
}
