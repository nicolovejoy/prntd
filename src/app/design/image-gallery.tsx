"use client";

import { useState } from "react";
import type { DesignImage } from "@/lib/chat-utils";
import type { ProductVersionGroup } from "@/lib/design-images";
import { Button } from "@/components/ui";

const BG_OPTIONS = [
  { label: "Dark", value: "bg-gray-900" },
  { label: "Light", value: "bg-white" },
];

export function ImageGallery({
  images,
  productGroups,
  selectedImage,
  generating,
  onClickImage,
  onMakeProducts,
  onSelectProductVersion,
  className,
}: {
  images: DesignImage[];
  productGroups: ProductVersionGroup[];
  selectedImage: string | null;
  generating: boolean;
  onClickImage: (index: number) => void;
  onMakeProducts: () => void;
  onSelectProductVersion: (productId: string) => void;
  className?: string;
}) {
  const [bgClass, setBgClass] = useState("bg-gray-900");

  return (
    <div className={className ?? "w-80 border-l border-border hidden md:flex flex-col"}>
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-300">
          Generations{images.length > 0 && ` (${images.length})`}
        </h2>
        {images.length > 0 && (
          <div className="flex gap-1">
            {BG_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setBgClass(opt.value)}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                  bgClass === opt.value
                    ? "bg-white text-black"
                    : "text-text-faint hover:text-text-muted"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Thumbnails */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-3">
          {images.length === 0 && !generating && (
            <p className="text-xs text-gray-500 text-center mt-8">
              No images yet. Chat about your idea, then hit Generate.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {images.map((img, i) => (
              <button
                key={img.id ?? img.number}
                onClick={() => onClickImage(i)}
                className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${
                  selectedImage === img.url
                    ? "border-accent"
                    : "border-border hover:border-border-hover"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={`Design #${img.number}`}
                  className={`w-full h-full object-contain ${bgClass}`}
                />
                <span className="absolute top-1 left-1 bg-black/70 text-white text-[10px] font-mono px-1.5 py-0.5 rounded">
                  #{img.number}
                </span>
              </button>
            ))}
            {generating && (
              <div className="aspect-square rounded-lg border-2 border-border flex items-center justify-center bg-surface">
                <div className="text-[10px] text-text-faint animate-pulse text-center px-2">
                  Painting...
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Product versions — placement-targeted renders, grouped by product */}
        {productGroups.length > 0 && (
          <div className="border-t border-border p-3">
            <h3 className="text-xs font-medium text-gray-400 mb-2">
              Product versions
            </h3>
            <div className="space-y-3">
              {productGroups.map((group) => (
                <div key={group.productId}>
                  <button
                    onClick={() => onSelectProductVersion(group.productId)}
                    className="text-[11px] text-text-muted hover:text-text-base mb-1"
                  >
                    {group.productName} &rarr;
                  </button>
                  <div className="grid grid-cols-3 gap-1.5">
                    {group.images.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => onSelectProductVersion(group.productId)}
                        className="relative aspect-square rounded overflow-hidden border border-border hover:border-border-hover bg-gray-900"
                        title={`${group.productName} (${v.aspectRatio})`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={v.imageUrl}
                          alt={`${group.productName} render`}
                          className="w-full h-full object-contain"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {images.length > 0 && (
        <div className="p-3 border-t border-border">
          <Button
            onClick={onMakeProducts}
            disabled={!selectedImage}
            className="w-full"
            size="sm"
          >
            Make Products &rarr;
          </Button>
        </div>
      )}
    </div>
  );
}
