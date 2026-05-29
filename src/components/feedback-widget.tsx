"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import {
  buildFeedbackPayload,
  validateFeedbackInput,
  MAX_FEEDBACK_BODY_CHARS,
  type FeedbackContext,
  type FeedbackType,
} from "@/lib/feedback/payload";

const TYPES: ReadonlyArray<{ value: FeedbackType; label: string }> = [
  { value: "bug", label: "Bug" },
  { value: "idea", label: "Idea" },
  { value: "other", label: "Other" },
];

type Status = "idle" | "submitting" | "sent" | "error";

interface FeedbackWidgetProps {
  projectId: string;
  // Absolute endpoint — the widget is embedded off the ibuild4you domain.
  endpoint?: string;
  defaultType?: FeedbackType;
  // Called after a successful send (e.g. to close a launcher panel).
  onSent?: () => void;
}

export function FeedbackWidget({
  projectId,
  endpoint = "https://ibuild4you.com/api/feedback",
  defaultType = "bug",
  onSent,
}: FeedbackWidgetProps) {
  const [type, setType] = useState<FeedbackType>(defaultType);
  const [body, setBody] = useState("");
  const [submitterEmail, setSubmitterEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — must stay empty
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const renderedAtRef = useRef<number>(0);

  // Capture render time once. Server rejects submissions younger than ~2s
  // (bot-fast) or older than 24h (replays).
  useEffect(() => {
    renderedAtRef.current = Date.now();
  }, []);

  const reset = () => {
    setBody("");
    setSubmitterEmail("");
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validation = validateFeedbackInput({ projectId, type, body, submitterEmail });
    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    const ctx: FeedbackContext = {
      pageUrl: typeof window !== "undefined" ? window.location.href : "",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      viewport:
        typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "",
      renderedAt: renderedAtRef.current || Date.now(),
    };
    const payload = {
      ...buildFeedbackPayload({ projectId, type, body, submitterEmail }, ctx),
      website, // honeypot — sourced from state so a bot filling it gets caught
    };

    setStatus("submitting");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      setStatus("sent");
      reset();
      onSent?.();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  if (status === "sent") {
    return (
      <div className="space-y-2" role="status">
        <p className="text-sm text-foreground">Thanks — got it.</p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="text-xs text-text-muted hover:text-foreground"
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" aria-label="Send feedback">
      <div className="flex gap-1">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setType(t.value)}
            aria-pressed={type === t.value}
            className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors ${
              type === t.value
                ? "border-accent bg-accent text-accent-fg"
                : "border-border text-text-muted hover:border-border-hover hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="sr-only">Feedback</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What's up?"
          rows={4}
          maxLength={MAX_FEEDBACK_BODY_CHARS}
          className="w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground placeholder:text-text-muted focus:outline-none focus:border-border-hover"
        />
      </label>

      <label className="block">
        <span className="sr-only">Email (optional)</span>
        <input
          type="email"
          value={submitterEmail}
          onChange={(e) => setSubmitterEmail(e.target.value)}
          placeholder="Email (optional, for follow-up)"
          className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground placeholder:text-text-muted focus:outline-none focus:border-border-hover"
        />
      </label>

      {/*
        Honeypot — visually + accessibility hidden. Real users don't fill it;
        bots usually do. Submissions with a non-empty `website` are silently
        accepted (200) by the server and dropped.
      */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px", opacity: 0 }}
      />

      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={status === "submitting"} className="w-full">
        {status === "submitting" ? "Sending…" : "Send feedback"}
      </Button>
    </form>
  );
}

export default FeedbackWidget;
