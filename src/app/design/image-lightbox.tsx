"use client";

import { useEffect, useCallback, useState } from "react";
import type { DesignImage } from "@/lib/chat-utils";

export function ImageLightbox({
  images,
  currentIndex,
  selectedImage,
  onClose,
  onNavigate,
  onSelect,
  onDelete,
}: {
  images: DesignImage[];
  currentIndex: number;
  selectedImage: string | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onSelect: (imageUrl: string) => void;
  onDelete: (generationNumber: number) => void;
}) {
  const image = images[currentIndex];
  const isSelected = selectedImage === image?.url;
  const [lightBg, setLightBg] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowLeft" && currentIndex > 0) {
        onNavigate(currentIndex - 1);
      } else if (e.key === "ArrowRight" && currentIndex < images.length - 1) {
        onNavigate(currentIndex + 1);
      }
    },
    [currentIndex, images.length, onClose, onNavigate]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center"
      onClick={onClose}
    >
      <div
        className="flex flex-col items-center gap-4 max-w-4xl w-full px-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400 font-mono">
              #{image.number} of {images.length}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setLightBg(false)}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                  !lightBg ? "bg-white text-black" : "text-text-faint hover:text-text-muted"
                }`}
              >
                Dark
              </button>
              <button
                onClick={() => setLightBg(true)}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                  lightBg ? "bg-white text-black" : "text-text-faint hover:text-text-muted"
                }`}
              >
                Light
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Image */}
        <div className="relative flex items-center gap-4 w-full">
          {/* Left arrow */}
          <button
            onClick={() => currentIndex > 0 && onNavigate(currentIndex - 1)}
            disabled={currentIndex === 0}
            className="text-3xl text-gray-400 hover:text-white disabled:opacity-20 shrink-0"
          >
            &lsaquo;
          </button>

          {/* Image container */}
          <div className="flex-1 flex items-center justify-center">
            <img
              src={image.url}
              alt={`Design #${image.number}`}
              className={`max-h-[70vh] max-w-full object-contain rounded-lg ${lightBg ? "bg-white" : ""}`}
            />
          </div>

          {/* Right arrow */}
          <button
            onClick={() =>
              currentIndex < images.length - 1 && onNavigate(currentIndex + 1)
            }
            disabled={currentIndex === images.length - 1}
            className="text-3xl text-gray-400 hover:text-white disabled:opacity-20 shrink-0"
          >
            &rsaquo;
          </button>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={() => onSelect(image.url)}
            className={`px-5 py-2 rounded-md text-sm font-medium transition-colors ${
              isSelected
                ? "bg-gray-700 text-gray-300 cursor-default"
                : "bg-white text-black hover:bg-gray-200"
            }`}
            disabled={isSelected}
          >
            {isSelected ? "Selected for order" : "Use for order"}
          </button>
          <button
            onClick={() => onDelete(image.number)}
            className="px-5 py-2 border border-gray-600 text-gray-400 rounded-md text-sm hover:text-red-400 hover:border-red-400 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
