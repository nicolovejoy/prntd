"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Markdown from "react-markdown";
import type { ChatMessage } from "@/lib/db/schema";
import type { ChatOption } from "@/lib/ai";
import type { DesignImage } from "@/lib/design-images";
import { Button, Input, QuickReply } from "@/components/ui";
import { EXAMPLES } from "@/lib/design-examples";
import { isGenerateIntent } from "@/lib/design-prompt";
import { shouldClampMessage } from "@/lib/design-view";

// A long pasted prompt used to fill the page (#147). Past the threshold the
// message collapses to four lines behind a Show more toggle.
function UserMessageText({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!shouldClampMessage(content)) return <p>{content}</p>;
  return (
    <>
      <p className={expanded ? undefined : "line-clamp-4"}>{content}</p>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 text-xs text-text-muted hover:text-foreground underline"
        data-testid="message-clamp-toggle"
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </>
  );
}

// Waiting states name the operation and stop (Clean Label): one static line,
// no rotation.
function DrawingStatus() {
  return (
    <div
      className="rounded-lg px-4 py-2 text-text-muted animate-pulse"
      data-testid="drawing-status"
    >
      Generating…
    </div>
  );
}

export function ChatPanel({
  messages,
  images,
  loading,
  generating,
  runningJobs,
  atCapacity,
  generationError,
  onDismissGenerationError,
  onSend,
  onGenerate,
  onCancelJob,
  readyToGenerate,
  options,
  onUploadImage,
  isEmpty,
  mobileGalleryStrip,
  closed = false,
  onReopen,
  className,
}: {
  messages: ChatMessage[];
  images: DesignImage[];
  loading: boolean;
  /** True while anything is generating — drives the composer's busy copy. */
  generating: boolean;
  /** One row per live generation; several can run at once now. */
  runningJobs: { jobId: string; generationNumber: number }[];
  /** At the concurrency cap — the only reason Generate is refused. */
  atCapacity: boolean;
  /** Last failed generation, surfaced inline rather than as a chat turn. */
  generationError: string | null;
  onDismissGenerationError: () => void;
  onSend: (message: string) => void;
  onGenerate: (message?: string) => void;
  onCancelJob: (jobId: string) => void;
  readyToGenerate: boolean;
  options: ChatOption[];
  onUploadImage: (base64: string, fileName: string) => void;
  isEmpty: boolean;
  // Mobile-only thumbnail strip, docked directly above the composer so it
  // reserves layout space instead of floating over content.
  mobileGalleryStrip?: React.ReactNode;
  // Closed conversation (slice 3): history stays viewable, the composer is
  // swapped for a closed notice + Reopen.
  closed?: boolean;
  onReopen?: () => void;
  /** Overrides the working-layout root class (the empty state stays centered
   * and full-width regardless). */
  className?: string;
}) {
  const urlByImageId = useMemo(
    () => new Map(images.map((img) => [img.id, img.url])),
    [images]
  );
  const [input, setInput] = useState("");
  const [dragging, setDragging] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        onUploadImage(base64, file.name);
      };
      reader.readAsDataURL(file);
    }
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current++;
    setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, generating]);

  // Auto-focus input on mount and after actions complete. A running
  // generation doesn't lock the composer (#59), so focus stays available.
  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [loading, generating]);


  // A tapped quick-reply chip answers the assistant's question, so it goes to
  // chat — the one gesture that still does. Text that reads as a bare "go
  // ahead" is routed to Generate instead: answering "yes" with more prose is
  // the non-event this slice exists to remove.
  function submitTurn(text: string) {
    const msg = text.trim();
    if (!msg || loading) return;
    setInput("");
    if (!atCapacity && isGenerateIntent(msg) && messages.length > 0) {
      onGenerate(msg);
      return;
    }
    onSend(msg);
  }

  // The composer has exactly ONE submit control and it generates (studio
  // slice 1). Enter, the empty state's button and the working composer's
  // primary all land here, so the gesture and the outcome never disagree.
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (atCapacity || loading) return;
    const msg = input.trim() || undefined;
    // Mirrors the button's disabled state: Enter on an empty composer with no
    // conversation behind it has nothing to generate from, and would burn a
    // brief call plus a consume/refund cycle to say so.
    if (!msg && messages.length === 0) return;
    if (msg) setInput("");
    onGenerate(msg);
  }

  // Chat is still reachable, but never by the submit gesture: it needs its own
  // deliberate tap, and its label states what comes back (an answer, not an
  // image).
  function handleAsk() {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput("");
    onSend(msg);
  }

  // Soft nudge only. Generate is always primary and always generates now, so
  // readiness colours a hint, never the button.
  const showStyleHint = !readyToGenerate && messages.length > 0;

  if (isEmpty) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-w-0 px-6 text-center">
        <h2 className="text-2xl sm:text-3xl font-semibold text-foreground">
          Describe a design
        </h2>
        <form
          onSubmit={handleSubmit}
          className="mt-6 w-full max-w-xl flex gap-2"
        >
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="Describe a design"
            className="flex-1"
            disabled={loading}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={loading || atCapacity || !input.trim()}
            title={atCapacity ? "Three designs are already generating." : undefined}
          >
            Generate
          </Button>
        </form>
        {/* Chips always visible, catalog-style (no reveal delay). */}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {EXAMPLES.slice(0, 3).map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setInput(example)}
              className="text-xs px-3 py-1.5 border border-border rounded-full text-text-muted hover:text-foreground hover:border-border-hover transition-colors"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={className ?? "flex-1 flex flex-col min-w-0 relative"}
      onDragEnter={handleDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      {dragging && (
        <div className="absolute inset-0 z-20 bg-surface/90 border-2 border-dashed border-accent rounded-lg flex items-center justify-center pointer-events-none">
          <p className="text-accent font-medium">Drop image here</p>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Messages — laid out naturally from the top; the composer stays
          pinned at the bottom, but content is never spread to fill the gap. */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4" data-testid="chat-messages">
        {messages.length === 0 && (
          <div className="text-center text-text-muted mt-20 space-y-4">
            <p className="text-lg">Describe a design</p>
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  onClick={() => setInput(example)}
                  className="text-xs px-3 py-1.5 border border-border rounded-full text-text-muted hover:text-foreground hover:border-border-hover transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg) => {
          const imageUrl = msg.imageId ? urlByImageId.get(msg.imageId) : undefined;
          return (
            <div
              key={msg.id}
              data-testid={`chat-message-${msg.role}`}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  msg.role === "user"
                    ? "bg-surface-raised text-foreground"
                    : "text-foreground"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm max-w-none prose-p:my-1 prose-ol:my-1 prose-ul:my-1 prose-li:my-0.5">
                    <Markdown>{msg.content}</Markdown>
                  </div>
                ) : (
                  <UserMessageText content={msg.content} />
                )}
                {imageUrl && (
                  <img
                    src={imageUrl}
                    alt={msg.role === "user" ? "Uploaded reference" : "Generated design"}
                    className="mt-2 rounded-md max-w-[200px]"
                  />
                )}
              </div>
            </div>
          );
        })}
        {/* Quick-reply chips for the latest assistant turn — rendered in the
            message flow, directly under the question they answer (options
            state only ever holds the latest turn's chips, so older messages
            never re-show theirs). Tap answers the question, no "type a
            number" needed. Hidden while a chat turn is in flight; a running
            generation doesn't hide them (#59) — the composer stays usable. */}
        {!loading && options.length > 0 && (
          <div className="flex justify-start" data-testid="chat-options">
            <div className="max-w-[80%] px-4">
              <QuickReply options={options} onSelect={submitTurn} disabled={loading} />
            </div>
          </div>
        )}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-lg px-4 py-2 text-text-faint">
              Thinking…
            </div>
          </div>
        )}
        {runningJobs.map((job) => (
          <div
            key={job.jobId}
            className="flex justify-start items-center gap-2"
            data-testid="generating-row"
          >
            <DrawingStatus />
            <Button
              type="button"
              variant="secondary"
              className="min-h-[44px]"
              onClick={() => onCancelJob(job.jobId)}
              data-testid="cancel-generation"
            >
              Cancel
            </Button>
          </div>
        ))}
        {/* A generation that failed in the background: the job row carries the
            reason, so it is reported here rather than faked as a chat turn. */}
        {generationError && (
          <div
            className="flex justify-start items-center gap-2 text-sm text-negative"
            data-testid="generation-error"
          >
            <span>{generationError}</span>
            <button
              type="button"
              onClick={onDismissGenerationError}
              className="text-text-muted hover:text-foreground"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Not-ready hint — only when there are no tappable options to offer instead */}
      {!closed && showStyleHint && options.length === 0 && (
        <div className="px-4 pt-2 text-xs text-text-muted">
          Add more detail, or tap Generate.
        </div>
      )}

      {mobileGalleryStrip}

      {/* Closed conversation: the composer is replaced. The images remain
          usable everywhere else — start a new design from one to keep going. */}
      {closed ? (
        <div
          className="p-3 sm:p-4 border-t border-border flex flex-wrap items-center gap-3"
          data-testid="closed-notice"
        >
          <p className="text-sm text-text-muted">
            This design is closed. Start a new design from any image, or
            reopen.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-[44px]"
            onClick={onReopen}
            data-testid="reopen-design"
          >
            Reopen
          </Button>
        </div>
      ) : (
      /* Composer — phone-first: input on its own row, actions wrap below,
          every control ≥44px. */
      <form onSubmit={handleSubmit} className="p-3 sm:p-4 border-t border-border space-y-2">
        <div className="flex gap-2 items-stretch">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="flex items-center justify-center min-h-[44px] min-w-[44px] border border-border rounded-md text-text-muted hover:text-foreground hover:border-border-hover transition-colors disabled:opacity-50"
            title="Upload image"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe a design or drop an image"
            className="flex-1 min-h-[44px]"
            disabled={loading}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            className="min-h-[44px] flex-1"
            disabled={
              loading || atCapacity || (messages.length === 0 && !input.trim())
            }
            title={
              atCapacity ? "Three designs are already generating." : undefined
            }
            data-testid="composer-generate"
          >
            {generating ? "Generating…" : "Generate"}
          </Button>
          {/* Deliberately not the submit control, and deliberately not the
              same weight: this returns an answer, Generate returns a design. */}
          <Button
            type="button"
            variant="ghost"
            className="min-h-[44px]"
            onClick={handleAsk}
            disabled={loading || !input.trim()}
            data-testid="composer-ask"
          >
            Ask
          </Button>
        </div>
      </form>
      )}
    </div>
  );
}
