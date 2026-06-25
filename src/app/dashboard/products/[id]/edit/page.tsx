"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ensureGuestSession } from "@/lib/ensure-guest-session";
import { getProductForEdit, saveProduct, type EditableProduct } from "../../../actions";
import { ComposeForm } from "../../compose-form";

export default function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  // undefined = loading, null = not found / not yours.
  const [product, setProduct] = useState<EditableProduct | null | undefined>(undefined);

  useEffect(() => {
    (async () => {
      try {
        await ensureGuestSession();
        setProduct(await getProductForEdit(id));
      } catch {
        setProduct(null);
      }
    })();
  }, [id]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <button
        onClick={() => router.push("/dashboard")}
        className="text-sm text-text-muted hover:text-foreground"
      >
        ← Dashboard
      </button>
      <h1 className="mt-2 text-xl font-semibold">Edit product</h1>
      <p className="mt-1 text-sm text-text-muted">
        The design stays put. Change the blank, placement, or price.
      </p>

      {product === undefined && <p className="mt-5 text-sm text-text-faint">Loading…</p>}
      {product === null && (
        <p className="mt-5 text-sm text-text-faint">
          This product isn&apos;t available to edit.
        </p>
      )}
      {product && (
        <ComposeForm
          designs={[product.design]}
          lockDesignId={product.design.designId}
          initialBlankId={product.blankId}
          initialPlacementId={Object.keys(product.placements)[0]}
          initialPrice={product.price}
          submitLabel="Save changes"
          onSubmit={async (v) => {
            await saveProduct(product.id, {
              blankId: v.blankId,
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
