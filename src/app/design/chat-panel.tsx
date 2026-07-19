"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Markdown from "react-markdown";
import type { ChatMessage } from "@/lib/db/schema";
import type { ChatOption } from "@/lib/ai";
import type { DesignImage } from "@/lib/design-images";
import { Button, QuickReply } from "@/components/ui";
import { EXAMPLES } from "@/lib/design-examples";

export function ChatPanel({
  messages,
  images,
  loading,
  generating,
  onSend,
  onGenerate,
  readyToGenerate,
  options,
  onUploadImage,
  isEmpty,
}: {
  messages: ChatMessage[];
  images: DesignImage[];
  loading: boolean;
  generating: boolean;
  onSend: (message: string) => void;
  onGenerate: (message?: string) => void;
  readyToGenerate: boolean;
  options: ChatOption[];
  onUploadImage: (base64: string, fileName: string) => void;
  isEmpty: boolean;
}) {
  const urlByImageId = useMemo(
    () => new Map(images.map((img) => [img.id, img.url])),
    [images]
  );
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const engagedRef = useRef(false);
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

  // Auto-focus input on mount and after actions complete
  useEffect(() => {
    if (!loading && !generating) inputRef.current?.focus();
  }, [loading, generating]);

  // Empty state: after 8s of inactivity (input untouched), quietly reveal
  // example chips. The moment the user types, drop them — and don't re-arm
  // once they've engaged.
  useEffect(() => {
    if (!isEmpty) return;
    if (input.length > 0) {
      engagedRef.current = true;
      // Hide immediately on the first keystroke; one extra render is fine.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowSuggestions(false);
      return;
    }
    if (engagedRef.current) return;
    // 8s, not 4s: long enough that someone still reading the hero or composing
    // their first line won't get nudged; short enough to help if they stall.
    const t = setTimeout(() => setShowSuggestions(true), 8000);
    return () => clearTimeout(t);
  }, [isEmpty, input]);

  // "draw it"/"draw" included: chat copy now nudges "tap Draw it", so typing
  // it should behave like tapping it.
  const GENERATE_TRIGGERS = /^(yes|yeah|yep|do it|go|generate|draw it|draw|let'?s do it|go ahead|make it|yes please|sure|ok generate)/i;

  // Shared submit path for both the composer and a tapped quick-reply chip, so
  // generate-intent detection and input clearing behave identically.
  function submitTurn(text: string) {
    const msg = text.trim();
    if (!msg || loading || generating) return;
    setInput("");
    if (GENERATE_TRIGGERS.test(msg) && messages.length > 0) {
      onGenerate(msg);
      return;
    }
    onSend(msg);
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    submitTurn(input);
  }

  function handleGenerate() {
    if (generating) return;
    const msg = input.trim() || undefined;
    if (msg) setInput("");
    onGenerate(msg);
  }

  const busy = loading || generating;
  // Soft nudge: until Claude judges the idea concrete (subject + style),
  // Generate sits as a secondary button and a style hint shows — it pops to
  // primary when ready. Always clickable; the fast thin-check catches a
  // too-thin click in ~1s rather than greying the button into looking broken.
  const notReadyTitle = "Add a style (e.g. watercolor, vintage, bold vector) to sharpen the idea — Draw it still works.";
  const showStyleHint = !readyToGenerate && messages.length > 0;

  if (isEmpty) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-w-0 px-6 text-center">
        <h2 className="text-2xl sm:text-3xl font-semibold text-foreground">
          What shall we draw together?
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          Describe it in plain words. Refine as we go.
        </p>
        <form
          onSubmit={handleSend}
          className="mt-6 w-full max-w-xl flex gap-2"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe your design..."
            className="flex-1 px-3 py-2 bg-surface border border-border rounded-md text-white placeholder:text-text-faint focus:border-border-hover focus:outline-none"
            disabled={loading}
          />
          <Button type="submit" variant="primary" disabled={loading || !input.trim()}>
            Send
          </Button>
        </form>
        {showSuggestions && (
          <div className="mt-6 space-y-2">
            <p className="text-xs text-text-faint">Need a suggestion?</p>
            <div className="flex flex-wrap justify-center gap-2">
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
        )}
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col min-w-0 relative"
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-text-muted mt-20 space-y-4">
            <p className="text-lg">What should your design look like?</p>
            <p className="text-sm">
              Describe a design. Chat to refine the idea, then hit Draw it.
            </p>
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
                    ? "bg-surface-raised text-white"
                    : "text-foreground"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-ol:my-1 prose-ul:my-1 prose-li:my-0.5">
                    <Markdown>{msg.content}</Markdown>
                  </div>
                ) : (
                  <p>{msg.content}</p>
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
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-lg px-4 py-2 text-text-faint">
              Thinking...
            </div>
          </div>
        )}
        {generating && (
          <div className="flex justify-start">
            <div className="rounded-lg px-4 py-2 text-text-muted animate-pulse">
              Drawing your design…
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick-reply chips for the last assistant turn — tap answers the
          question, no "type a number" needed. Hidden while a turn is in flight. */}
      {!busy && options.length > 0 && (
        <div className="px-4 pt-2">
          <QuickReply options={options} onSelect={submitTurn} disabled={busy} />
        </div>
      )}

      {/* Style hint — only when there are no tappable options to offer instead */}
      {showStyleHint && options.length === 0 && (
        <div className="px-4 pt-2 text-xs text-text-muted">
          Add a style — watercolor, vintage, bold vector — to sharpen the idea.
        </div>
      )}

      {/* Composer — phone-first: input on its own row, actions wrap below,
          every control ≥44px. */}
      <form onSubmit={handleSend} className="p-3 sm:p-4 border-t border-border space-y-2">
        <div className="flex gap-2 items-stretch">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="flex items-center justify-center min-h-[44px] min-w-[44px] border border-border rounded-md text-text-muted hover:text-white hover:border-border-hover transition-colors disabled:opacity-50"
            title="Upload image"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe your design or drop an image..."
            className="flex-1 min-h-[44px] px-3 py-2 bg-surface border border-border rounded-md text-white placeholder:text-text-faint focus:border-border-hover focus:outline-none"
            disabled={busy}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="secondary"
            className="min-h-[44px] flex-1"
            disabled={busy || !input.trim()}
          >
            Send
          </Button>
          <Button
            type="button"
            variant={readyToGenerate ? "primary" : "secondary"}
            className="min-h-[44px] flex-1"
            onClick={handleGenerate}
            disabled={busy || (messages.length === 0 && !input.trim())}
            title={readyToGenerate ? undefined : notReadyTitle}
          >
            Draw it
          </Button>
        </div>
      </form>
    </div>
  );
}
