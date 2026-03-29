"use client";

import { Suspense, useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  sendChatMessage,
  generateDesign,
  selectImage,
  deleteGeneration,
  getDesign,
  approveDesign,
} from "./actions";
import { extractImagesFromHistory } from "@/lib/chat-utils";
import type { ChatMessage } from "@/lib/db/schema";
import type { DesignImage } from "@/lib/chat-utils";
import { ChatPanel } from "./chat-panel";
import { ImageGallery } from "./image-gallery";
import { ImageLightbox } from "./image-lightbox";

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
  const [images, setImages] = useState<DesignImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Load existing design if resuming
  useEffect(() => {
    const id = searchParams.get("id");
    if (id) {
      getDesign(id).then((design) => {
        if (design) {
          const history = (design.chatHistory as ChatMessage[]) ?? [];
          setMessages(history);
          setImages(extractImagesFromHistory(history));
          setSelectedImage(design.currentImageUrl);
        }
      });
    }
  }, [searchParams]);

  async function handleSend(userMessage: string) {
    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    try {
      const result = await sendChatMessage(designId.current, userMessage);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.message },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Something went wrong. Try again?",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate(userMessage?: string) {
    setGenerating(true);
    if (userMessage) {
      setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    }

    try {
      const result = await generateDesign(designId.current, userMessage);
      const newImage: DesignImage = {
        number: result.generationNumber,
        url: result.imageUrl,
        prompt: "",
      };
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.message,
          imageUrl: result.imageUrl,
          generationNumber: result.generationNumber,
        },
      ]);
      setImages((prev) => [...prev, newImage]);
      setSelectedImage(result.imageUrl);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Image generation failed. Try again?",
        },
      ]);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSelectImage(imageUrl: string) {
    setSelectedImage(imageUrl);
    await selectImage(designId.current, imageUrl);
  }

  async function handleDeleteImage(generationNumber: number) {
    await deleteGeneration(designId.current, generationNumber);
    setImages((prev) => prev.filter((img) => img.number !== generationNumber));
    // Close lightbox if no images left, or navigate
    const remaining = images.filter(
      (img) => img.number !== generationNumber
    );
    if (remaining.length === 0) {
      setLightboxIndex(null);
      setSelectedImage(null);
    } else {
      // If deleted image was selected, pick the last remaining
      const deleted = images.find((img) => img.number === generationNumber);
      if (deleted && selectedImage === deleted.url) {
        const last = remaining[remaining.length - 1];
        setSelectedImage(last.url);
        await selectImage(designId.current, last.url);
      }
      // Adjust lightbox index
      if (lightboxIndex !== null) {
        const newIndex = Math.min(lightboxIndex, remaining.length - 1);
        setLightboxIndex(newIndex);
      }
    }
  }

  function handleUseDesign() {
    if (!selectedImage) return;
    approveDesign(designId.current).then(() => {
      router.push(`/preview?id=${designId.current}`);
    });
  }

  return (
    <div className="h-[calc(100vh-41px)] flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-700 flex items-center justify-between">
        <div>
          <Link
            href="/designs"
            className="text-sm text-gray-500 hover:underline"
          >
            &larr; My Designs
          </Link>
          <h1 className="text-lg font-semibold mt-1">Design your shirt</h1>
        </div>
      </div>

      {/* Two-column body */}
      <div className="flex-1 flex overflow-hidden">
        <ChatPanel
          messages={messages}
          loading={loading}
          generating={generating}
          onSend={handleSend}
          onGenerate={handleGenerate}
        />
        <ImageGallery
          images={images}
          selectedImage={selectedImage}
          generating={generating}
          onClickImage={(i) => setLightboxIndex(i)}
          onUseDesign={handleUseDesign}
        />
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && images.length > 0 && (
        <ImageLightbox
          images={images}
          currentIndex={lightboxIndex}
          selectedImage={selectedImage}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          onSelect={handleSelectImage}
          onDelete={handleDeleteImage}
        />
      )}
    </div>
  );
}
