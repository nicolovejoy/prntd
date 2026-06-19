"use client";

import { useEffect, useState } from "react";
import { Button, Badge } from "@/components/ui";
import { ensureGuestSession } from "@/lib/ensure-guest-session";
import {
  getDashboard,
  createStore,
  updateStore,
  type DashboardStore,
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
    if (!trimmed || creating) return;
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
          disabled={creating || !name.trim()}
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
          <StoreCard key={store.id} store={store} onToggleLive={() => toggleLive(store)} />
        ))}
      </div>
    </div>
  );
}

function StoreCard({
  store,
  onToggleLive,
}: {
  store: DashboardStore;
  onToggleLive: () => void;
}) {
  const [copied, setCopied] = useState(false);

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

  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-medium truncate">{store.name}</h2>
            <Badge variant={STATUS_VARIANT[store.status]}>{store.status}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-text-faint truncate">/{store.slug}</p>
          <p className="mt-1 text-xs text-text-muted">
            {store.productCount} {store.productCount === 1 ? "product" : "products"}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
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
          onClick={onToggleLive}
        >
          {store.status === "live" ? "Unpublish" : "Publish"}
        </Button>
      </div>
    </div>
  );
}
