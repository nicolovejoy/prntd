"use client";

import { Suspense, useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { sendMessage, getDesign } from "./actions";
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load existing design if resuming
  useEffect(() => {
    const id = searchParams.get("id");
    if (id) {
      getDesign(id).then((design) => {
        if (design) {
          setMessages((design.chatHistory as ChatMessage[]) ?? []);
          setCurrentImage(design.currentImageUrl);
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

    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    try {
      const result = await sendMessage(designId.current, userMessage);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.message,
          imageUrl: result.imageUrl,
        },
      ]);
      setCurrentImage(result.imageUrl);
    } catch (err) {
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

  function handleApprove() {
    router.push(`/preview?id=${designId.current}`);
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Chat panel */}
      <div className="flex-1 flex flex-col border-r">
        <div className="p-4 border-b">
          <h1 className="text-lg font-semibold">Design your shirt</h1>
          <p className="text-sm text-gray-500">
            Describe what you want — I&apos;ll generate it for you.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 mt-20">
              <p className="text-lg">What should your shirt look like?</p>
              <p className="text-sm mt-2">
                Try: &quot;A minimalist mountain landscape in blue and white&quot;
              </p>
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
                Generating your design...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSend} className="p-4 border-t flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe your design..."
            className="flex-1 px-3 py-2 border rounded-md"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-black text-white rounded-md disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>

      {/* Preview panel */}
      <div className="w-full md:w-96 p-4 flex flex-col items-center justify-center bg-gray-50">
        {currentImage ? (
          <>
            <div className="relative w-72 h-72 bg-white rounded-lg shadow-sm flex items-center justify-center">
              <img
                src={currentImage}
                alt="Current design"
                className="max-w-[90%] max-h-[90%] object-contain"
              />
            </div>
            <button
              onClick={handleApprove}
              className="mt-4 px-6 py-2 bg-black text-white rounded-md"
            >
              Use this design
            </button>
          </>
        ) : (
          <div className="text-gray-400 text-center">
            <p>Your design will appear here</p>
          </div>
        )}
      </div>
    </div>
  );
}
