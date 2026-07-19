"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Badge, Input } from "@/components/ui";
import { ensureGuestSession } from "@/lib/ensure-guest-session";
import {
  getDashboard,
  createStore,
  updateStore,
  saveProduct,
  type DashboardStore,
  type DashboardProduct,
} from "./actions";

const STATUS_VARIANT: Record<DashboardStore["status"], "draft" | "approved" | "default"> = {
  draft: "draft",
  live: "approved",
  hidden: "default",
};

export default function DashboardPage() {
  const [stores, setStores] = useState<DashboardStore[] | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await ensureGuestSession();
        setStores(await getDashboard());
      } catch {
        setStores([]);
      }
    })();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (creating) return;
    if (!trimmed) {
      setError("Enter a shop name first.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const store = await createStore({ name: trimmed });
      setStores((prev) => [...(prev ?? []), store]);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the shop");
    } finally {
      setCreating(false);
    }
  }

  async function toggleLive(store: DashboardStore) {
    const next = store.status === "live" ? "hidden" : "live";
    setStores((prev) =>
      (prev ?? []).map((s) => (s.id === store.id ? { ...s, status: next } : s))
    );
    try {
      await updateStore(store.id, { status: next });
    } catch {
      // revert on failure
      setStores((prev) =>
        (prev ?? []).map((s) => (s.id === store.id ? { ...s, status: store.status } : s))
      );
    }
  }

  // Persist a name/description/accent edit, then merge the returned row back in
  // (slug + shareUrl + productCount stay put — a rename never changes the slug).
  async function saveEdit(store: DashboardStore, patch: StoreEdit) {
    const updated = await updateStore(store.id, patch);
    setStores((prev) =>
      (prev ?? []).map((s) =>
        s.id === store.id
          ? { ...s, name: updated.name, description: updated.description, accentColor: updated.accentColor }
          : s
      )
    );
  }

  // List ↔ unlist a product. Listed products show on the public storefront (when
  // the store is also live); unlisted (hidden) are owner-only. Optimistic.
  async function toggleListed(storeId: string, product: DashboardProduct) {
    const next = product.status === "listed" ? "hidden" : "listed";
    const patchProduct = (status: DashboardProduct["status"]) =>
      setStores((prev) =>
        (prev ?? []).map((s) =>
          s.id === storeId
            ? {
                ...s,
                products: s.products.map((p) =>
                  p.id === product.id ? { ...p, status } : p
                ),
              }
            : s
        )
      );
    patchProduct(next);
    try {
      await saveProduct(product.id, { status: next });
    } catch {
      patchProduct(product.status); // revert
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-xl font-semibold">Your shops</h1>
      <p className="mt-1 text-sm text-text-muted">
        Name a shop, add designs, share the link.
      </p>

      {/* Create a shop */}
      <form onSubmit={handleCreate} className="mt-5 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Shop name (e.g. Manine's Club)"
          className="flex-1 min-w-[12rem] min-h-[44px] px-3 py-2 bg-surface border border-border rounded-md text-white placeholder:text-text-faint focus:border-border-hover focus:outline-none"
        />
        <Button
          type="submit"
          variant="primary"
          className="min-h-[44px]"
          disabled={creating}
        >
          {creating ? "Creating…" : "Create a shop"}
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      {/* Stores */}
      <div className="mt-6 space-y-3">
        {stores === null && <p className="text-sm text-text-faint">Loading…</p>}
        {stores?.length === 0 && (
          <p className="text-sm text-text-faint">
            No shop yet. Name one above to get a shareable link.
          </p>
        )}
        {stores?.map((store) => (
          <StoreCard
            key={store.id}
            store={store}
            onToggleLive={() => toggleLive(store)}
            onSaveEdit={(patch) => saveEdit(store, patch)}
            onToggleListed={(product) => toggleListed(store.id, product)}
          />
        ))}
      </div>
    </div>
  );
}

function StoreCard({
  store,
  onToggleLive,
  onSaveEdit,
  onToggleListed,
}: {
  store: DashboardStore;
  onToggleLive: () => void;
  onSaveEdit: (patch: StoreEdit) => Promise<void>;
  onToggleListed: (product: DashboardProduct) => void;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(store.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — surface the URL so it can be copied manually
      window.prompt("Copy your shop link:", store.shareUrl);
    }
  }

  if (editing) {
    return (
      <StoreEditPanel
        store={store}
        onCancel={() => setEditing(false)}
        onSave={async (patch) => {
          await onSaveEdit(patch);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="border border-border rounded-lg p-4" data-testid="store-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {store.accentColor && (
              <span
                className="inline-block w-3 h-3 rounded-full border border-border shrink-0"
                style={{ backgroundColor: store.accentColor }}
                aria-hidden
              />
            )}
            <h2 className="font-medium truncate">{store.name}</h2>
            <Badge variant={STATUS_VARIANT[store.status]}>{store.status}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-text-faint truncate">/{store.slug}</p>
          {store.description && (
            <p className="mt-1 text-xs text-text-muted line-clamp-2">{store.description}</p>
          )}
          <p className="mt-1 text-xs text-text-muted">
            {store.productCount} {store.productCount === 1 ? "product" : "products"}
          </p>
        </div>
      </div>

      {store.products.length > 0 && (
        <ul className="mt-3 divide-y divide-border border-y border-border">
          {store.products.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2">
              <span className="text-sm truncate">
                {p.blankName}
                {p.price != null && (
                  <span className="ml-2 text-text-muted">${p.price.toFixed(2)}</span>
                )}
                {p.status !== "listed" && (
                  <span className="ml-2 text-xs text-text-faint">({p.status})</span>
                )}
              </span>
              <span className="shrink-0 flex items-center gap-3">
                <button
                  onClick={() => onToggleListed(p)}
                  className="text-sm text-text-muted hover:text-foreground underline"
                >
                  {p.status === "listed" ? "Unlist" : "List"}
                </button>
                <button
                  onClick={() => router.push(`/dashboard/products/${p.id}/edit`)}
                  className="text-sm text-text-muted hover:text-foreground underline"
                >
                  Edit
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          className="min-h-[44px]"
          onClick={() => router.push(`/dashboard/products/new?store=${store.id}`)}
        >
          Add product
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="min-h-[44px]"
          onClick={copyLink}
        >
          {copied ? "Copied!" : "Copy link"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-[44px]"
          onClick={() => setEditing(true)}
        >
          Edit shop
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-[44px]"
          onClick={onToggleLive}
        >
          {store.status === "live" ? "Unpublish" : "Publish"}
        </Button>
      </div>
    </div>
  );
}

type StoreEdit = { name: string; description: string | null; accentColor: string | null };

function StoreEditPanel({
  store,
  onSave,
  onCancel,
}: {
  store: DashboardStore;
  onSave: (patch: StoreEdit) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(store.name);
  const [description, setDescription] = useState(store.description ?? "");
  const [accentColor, setAccentColor] = useState<string | null>(store.accentColor);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a shop name.");
      return;
    }
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: trimmed,
        description: description.trim() || null,
        accentColor,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save changes");
      setSaving(false);
    }
  }

  return (
    <div
      className="border border-border rounded-lg p-4 space-y-3"
      data-testid="store-edit-panel"
    >
      <div>
        <label className="block text-sm font-medium mb-1">Shop name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full min-h-[44px]"
        />
        {/* Slug stays fixed across a rename so any shared links keep working. */}
        <p className="mt-1 text-xs text-text-faint">Link stays /{store.slug}</p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="What's this shop about? (optional)"
          className="w-full px-3 py-2 bg-surface border border-border rounded-md text-foreground placeholder:text-text-faint focus:outline-none focus:border-border-hover"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Accent color</label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={accentColor ?? "#000000"}
            onChange={(e) => setAccentColor(e.target.value)}
            className="w-11 h-11 rounded-md border border-border bg-surface cursor-pointer"
            aria-label="Accent color"
          />
          {accentColor ? (
            <button
              type="button"
              onClick={() => setAccentColor(null)}
              className="text-xs text-text-muted hover:text-foreground underline"
            >
              Clear
            </button>
          ) : (
            <span className="text-xs text-text-faint">No accent — uses the default chrome.</span>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          type="button"
          variant="primary"
          className="min-h-[44px]"
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-[44px]"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
