"use client";

import { Suspense, useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { sendMessage, getDesign, chooseOption } from "./actions";
import type { ChatMessage } from "@/lib/db/schema";

export default function DesignPage() {
  return (
    <Suspense>
      <DesignPageInner />
    </Suspense>
  );
}

function DesignPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const designId = useRef(searchParams.get("id") ?? crypto.randomUUID());

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [pendingChoice, setPendingChoice] = useState<{
    imageA: string;
    imageB: string;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load existing design if resuming
  useEffect(() => {
    const id = searchParams.get("id");
    if (id) {
      getDesign(id).then((design) => {
        if (design) {
          const history = (design.chatHistory as ChatMessage[]) ?? [];
          setMessages(history);
          setCurrentImage(design.currentImageUrl);

          // If the last message has an unresolved A/B choice, restore it
          const lastMsg = history[history.length - 1];
          if (
            lastMsg?.role === "assistant" &&
            lastMsg.imageUrlAlt &&
            !lastMsg.modelChosen
          ) {
            setPendingChoice({
              imageA: lastMsg.imageUrl!,
              imageB: lastMsg.imageUrlAlt,
            });
          }
        }
      });
    }
  }, [searchParams]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    setLoading(true);
    setPendingChoice(null);

    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    try {
      const result = await sendMessage(designId.current, userMessage);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.message,
          imageUrl: result.imageUrl,
          imageUrlAlt: result.imageUrlAlt,
          modelA: result.modelA,
          modelB: result.modelB,
        },
      ]);

      if (result.imageUrlAlt) {
        setPendingChoice({
          imageA: result.imageUrl,
          imageB: result.imageUrlAlt,
        });
      } else {
        setCurrentImage(result.imageUrl);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Something went wrong generating your design. Try again?",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleChoice(choice: "a" | "b") {
    if (!pendingChoice) return;
    const chosenUrl = choice === "a" ? pendingChoice.imageA : pendingChoice.imageB;
    setCurrentImage(chosenUrl);
    setPendingChoice(null);
    await chooseOption(designId.current, choice);
  }

  function handleApprove() {
    router.push(`/preview?id=${designId.current}`);
  }

  const hasDesign = currentImage && !pendingChoice;

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Chat panel */}
      <div className="flex-1 flex flex-col border-r">
        <div className="p-4 border-b">
          <Link href="/designs" className="text-sm text-gray-500 hover:underline">
            &larr; My Designs
          </Link>
          <h1 className="text-lg font-semibold mt-1">Design your shirt</h1>
          <p className="text-sm text-gray-500">
            {hasDesign
              ? "Keep refining, or use your design when you're happy."
              : "Describe an image — we'll generate two options to pick from."}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 mt-20 space-y-4">
              <p className="text-lg">What should your shirt look like?</p>
              <p className="text-sm">
                Works best with visual concepts. Text on shirts may need a few tries.
              </p>
              <div className="flex flex-wrap justify-center gap-2 mt-4">
                {[
                  "A minimalist mountain landscape in blue and white",
                  "A retro sunset with palm tree silhouettes",
                  "An abstract geometric wolf head",
                  "A simple line drawing of a coffee cup",
                ].map((example) => (
                  <button
                    key={example}
                    onClick={() => setInput(example)}
                    className="text-xs px-3 py-1.5 border rounded-full text-gray-500 hover:text-black hover:border-black transition-colors"
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
                    ? "bg-black text-white"
                    : "bg-gray-100 text-gray-900"
                }`}
              >
                <p>{msg.content}</p>
                {msg.imageUrl && (
                  <img
                    src={msg.imageUrl}
                    alt="Generated design"
                    className="mt-2 rounded-md max-w-full"
                  />
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-lg px-4 py-2 text-gray-500">
                Generating two options...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSend} className="p-4 border-t flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              hasDesign
                ? "Refine your design... (e.g. 'make the colors bolder')"
                : "Describe your design..."
            }
            className="flex-1 px-3 py-2 border rounded-md"
            disabled={loading || !!pendingChoice}
          />
          <button
            type="submit"
            disabled={loading || !input.trim() || !!pendingChoice}
            className="px-4 py-2 bg-black text-white rounded-md disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>

      {/* Preview panel */}
      <div className="w-full md:w-96 p-4 flex flex-col items-center justify-center bg-gray-50">
        {pendingChoice ? (
          <div className="space-y-4 w-full max-w-sm">
            <p className="text-sm text-gray-500 text-center font-medium">
              Pick your favorite
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleChoice("a")}
                className="group relative aspect-square bg-white rounded-lg shadow-sm overflow-hidden border-2 border-transparent hover:border-black transition-colors"
              >
                <img
                  src={pendingChoice.imageA}
                  alt="Option A"
                  className="w-full h-full object-cover"
                />
                <span className="absolute top-2 left-2 text-xs font-medium bg-white/80 px-2 py-0.5 rounded">
                  A
                </span>
              </button>
              <button
                onClick={() => handleChoice("b")}
                className="group relative aspect-square bg-white rounded-lg shadow-sm overflow-hidden border-2 border-transparent hover:border-black transition-colors"
              >
                <img
                  src={pendingChoice.imageB}
                  alt="Option B"
                  className="w-full h-full object-cover"
                />
                <span className="absolute top-2 left-2 text-xs font-medium bg-white/80 px-2 py-0.5 rounded">
                  B
                </span>
              </button>
            </div>
            <p className="text-xs text-gray-400 text-center">
              Pick one, then refine it or use it as-is
            </p>
          </div>
        ) : currentImage ? (
          <div className="space-y-4 flex flex-col items-center">
            <div className="relative w-72 h-72 bg-white rounded-lg shadow-sm flex items-center justify-center">
              <img
                src={currentImage}
                alt="Current design"
                className="max-w-[90%] max-h-[90%] object-contain"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleApprove}
                className="px-6 py-2 bg-black text-white rounded-md"
              >
                Use this design
              </button>
            </div>
            <p className="text-xs text-gray-400 text-center">
              Or keep chatting to refine it
            </p>
          </div>
        ) : (
          <div className="text-gray-400 text-center">
            <p>Your design will appear here</p>
          </div>
        )}
      </div>
    </div>
  );
}
