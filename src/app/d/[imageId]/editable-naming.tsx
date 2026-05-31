"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updatePublishedNaming } from "@/app/designs/actions";
import { Button } from "@/components/ui";
import { BACKGROUND_PALETTE } from "@/lib/products";

type Props = {
  imageId: string;
  title: string | null;
  description: string | null;
  backgroundColor: string | null;
  canEdit: boolean;
};

export function EditableNaming({
  imageId,
  title,
  description,
  backgroundColor,
  canEdit,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title ?? "");
  const [descDraft, setDescDraft] = useState(description ?? "");
  const [bgDraft, setBgDraft] = useState<string | null>(backgroundColor);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <>
        {(title || canEdit) && (
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-bold">{title ?? "Untitled"}</h1>
            {canEdit && (
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-text-muted underline hover:no-underline"
              >
                Edit
              </button>
            )}
          </div>
        )}
        {description && (
          <p className="text-base leading-relaxed pt-2">{description}</p>
        )}
      </>
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updatePublishedNaming(imageId, {
        title: titleDraft,
        description: descDraft,
        backgroundColor: bgDraft,
      });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 pt-2">
      <input
        type="text"
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        placeholder="Title"
        maxLength={80}
        className="w-full bg-surface border border-border rounded px-3 py-2 text-2xl font-bold"
      />
      <textarea
        value={descDraft}
        onChange={(e) => setDescDraft(e.target.value)}
        placeholder="Description"
        maxLength={400}
        rows={3}
        className="w-full bg-surface border border-border rounded px-3 py-2 text-base leading-relaxed"
      />

      <BackgroundPicker value={bgDraft} onChange={setBgDraft} />

      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          onClick={() => {
            setEditing(false);
            setTitleDraft(title ?? "");
            setDescDraft(description ?? "");
            setBgDraft(backgroundColor);
            setError(null);
          }}
          variant="ghost"
          size="sm"
          disabled={saving}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Backdrop swatches for the published listing. "None" clears back to the
 * checkerboard; the rest are shirt colors from the default product palette.
 * Phone-first: 40px touch targets.
 */
function BackgroundPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-2">
        Background — {value ?? "None"}
      </label>
      <div className="flex flex-wrap gap-2.5 md:gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          title="None (checkerboard)"
          aria-label="No background"
          aria-pressed={value === null}
          className={`w-10 h-10 md:w-8 md:h-8 rounded-full border-2 bg-checkerboard transition-colors ${
            value === null
              ? "border-accent ring-2 ring-offset-1 ring-accent ring-offset-background"
              : "border-border"
          }`}
        />
        {BACKGROUND_PALETTE.map((c) => (
          <button
            key={c.name}
            type="button"
            onClick={() => onChange(c.name)}
            title={c.name}
            aria-label={c.name}
            aria-pressed={value === c.name}
            className={`w-10 h-10 md:w-8 md:h-8 rounded-full border-2 transition-colors ${
              value === c.name
                ? "border-accent ring-2 ring-offset-1 ring-accent ring-offset-background"
                : "border-border"
            }`}
            style={{ backgroundColor: c.value }}
          />
        ))}
      </div>
    </div>
  );
}
