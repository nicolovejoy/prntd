"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Markdown from "react-markdown";
import type { ChatMessage } from "@/lib/db/schema";
import { Button } from "@/components/ui";

const GENERATING_MESSAGES = [
  "Mixing paints...",
  "Sketching ideas...",
  "Arguing about fonts...",
  "Consulting the muse...",
  "Inking the lines...",
  "Choosing colors...",
  "Almost there...",
  "Adding finishing touches...",
  "Stepping back to admire...",
  "One more brushstroke...",
];

function useRotatingMessage(messages: string[], intervalMs: number, active: boolean) {
  const [index, setIndex] = useState(0);
  const startIndex = useMemo(
    () => Math.floor(Math.random() * messages.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active]
  );

  useEffect(() => {
    if (!active) return;
    setIndex(startIndex);
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % messages.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, messages.length, intervalMs, startIndex]);

  return messages[index];
}

const EXAMPLES = [
  "A minimalist mountain landscape in blue and white",
  "A retro sunset with palm tree silhouettes",
  "An abstract geometric wolf head",
  'Bold text saying "HELLO" in a graffiti style',
];

export function ChatPanel({
  messages,
  loading,
  generating,
  onSend,
  onGenerate,
}: {
  messages: ChatMessage[];
  loading: boolean;
  generating: boolean;
  onSend: (message: string) => void;
  onGenerate: (message?: string) => void;
}) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const generatingMsg = useRotatingMessage(GENERATING_MESSAGES, 2000, generating);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, generating, generatingMsg]);

  // Auto-focus input on mount and after actions complete
  useEffect(() => {
    if (!loading && !generating) inputRef.current?.focus();
  }, [loading, generating]);

  const GENERATE_TRIGGERS = /^(yes|yeah|yep|do it|go|generate|let'?s do it|go ahead|make it|yes please|sure|ok generate)/i;

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading || generating) return;
    const msg = input.trim();
    // Auto-detect generation intent
    if (GENERATE_TRIGGERS.test(msg) && messages.length > 0) {
      setInput("");
      onGenerate(msg);
      return;
    }
    onSend(msg);
    setInput("");
  }

  function handleGenerate() {
    if (generating) return;
    const msg = input.trim() || undefined;
    if (msg) setInput("");
    onGenerate(msg);
  }

  const busy = loading || generating;

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-20 space-y-4">
            <p className="text-lg">What should your shirt look like?</p>
            <p className="text-sm">
              Describe a design. Chat to refine the idea, then hit Generate.
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
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === "user"
                  ? "bg-gray-800 text-white"
                  : "text-gray-100"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-ol:my-1 prose-ul:my-1 prose-li:my-0.5">
                  <Markdown>{msg.content}</Markdown>
                </div>
              ) : (
                <p>{msg.content}</p>
              )}
              {msg.generationNumber && (
                <p className="text-xs text-gray-500 mt-1">
                  Generated #{msg.generationNumber}
                </p>
              )}
              {/* Backward compat: old messages with imageUrl but no generationNumber */}
              {msg.imageUrl && !msg.generationNumber && (
                <img
                  src={msg.imageUrl}
                  alt="Generated design"
                  className="mt-2 rounded-md max-w-[200px]"
                />
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-lg px-4 py-2 text-gray-500">
              Thinking...
            </div>
          </div>
        )}
        {generating && (
          <div className="flex justify-start">
            <div className="rounded-lg px-4 py-2 text-text-muted animate-pulse">
              {generatingMsg}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="p-4 border-t border-border flex gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe your design or ask a question..."
          className="flex-1 px-3 py-2 bg-surface border border-border rounded-md text-white placeholder:text-gray-500 focus:border-border-hover focus:outline-none"
          disabled={busy}
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={busy || !input.trim()}
        >
          Send
        </Button>
        <Button
          type="button"
          onClick={handleGenerate}
          disabled={busy || (messages.length === 0 && !input.trim())}
        >
          Generate
        </Button>
      </form>
    </div>
  );
}
