/**
 * Client-side product silhouette with print area overlay.
 * Shows a t-shirt or phone case shape tinted to the selected color,
 * with a dashed rectangle marking the printable area and the design
 * image scaled within it.
 */

type Props = {
  productType: "shirt" | "phone-case";
  color: string;
  designImageUrl: string | null;
  scale: number;
  printArea: { width: number; height: number };
};

export function ProductSilhouette({
  productType,
  color,
  designImageUrl,
  scale,
  printArea,
}: Props) {
  return (
    <div className="flex flex-col items-center">
      {productType === "shirt" ? (
        <ShirtSilhouette
          color={color}
          designImageUrl={designImageUrl}
          scale={scale}
        />
      ) : (
        <PhoneCaseSilhouette
          color={color}
          designImageUrl={designImageUrl}
          scale={scale}
        />
      )}
      <span className="text-[11px] text-text-muted mt-1.5">
        {printArea.width} &times; {printArea.height} in print area
      </span>
    </div>
  );
}

function ShirtSilhouette({
  color,
  designImageUrl,
  scale,
}: {
  color: string;
  designImageUrl: string | null;
  scale: number;
}) {
  // ViewBox: 200 x 240
  // Print area: 12:16 aspect ratio → 75 x 100, centered horizontally at x=62.5, y=68
  const printW = 75;
  const printH = 100;
  const printX = 62.5;
  const printY = 68;

  const designW = printW * scale;
  const designH = printH * scale;
  const designX = printX + (printW - designW) / 2;
  const designY = printY + (printH - designH) / 2;

  return (
    <svg viewBox="0 0 200 240" className="w-full h-full" aria-label="T-shirt preview">
      {/* Shirt shape */}
      <path
        d={`
          M 70 30
          C 70 20, 80 12, 100 12
          C 120 12, 130 20, 130 30
          L 160 45
          L 175 42
          L 182 65
          L 165 70
          L 150 62
          L 150 220
          C 150 224, 148 226, 144 226
          L 56 226
          C 52 226, 50 224, 50 220
          L 50 62
          L 35 70
          L 18 65
          L 25 42
          L 40 45
          Z
        `}
        fill={color}
        stroke="rgba(255,255,255,0.15)"
        strokeWidth="1"
      />
      {/* Collar */}
      <ellipse
        cx="100" cy="25"
        rx="14" ry="8"
        fill="none"
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="1.5"
      />

      {/* Print area boundary */}
      <rect
        x={printX} y={printY}
        width={printW} height={printH}
        fill="none"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="0.8"
        strokeDasharray="3 2.5"
        rx="1"
      />

      {/* Design image */}
      {designImageUrl && (
        <image
          href={designImageUrl}
          x={designX} y={designY}
          width={designW} height={designH}
          preserveAspectRatio="xMidYMid meet"
        />
      )}
    </svg>
  );
}

function PhoneCaseSilhouette({
  color,
  designImageUrl,
  scale,
}: {
  color: string;
  designImageUrl: string | null;
  scale: number;
}) {
  // ViewBox: 120 x 240
  // Phone body fills most of the space
  const phoneX = 15;
  const phoneY = 10;
  const phoneW = 90;
  const phoneH = 220;

  // Print area: nearly full bleed with some padding
  const printX = 22;
  const printY = 30;
  const printW = 76;
  const printH = 180;

  const designW = printW * scale;
  const designH = printH * scale;
  const designX = printX + (printW - designW) / 2;
  const designY = printY + (printH - designH) / 2;

  return (
    <svg viewBox="0 0 120 240" className="w-full h-full" aria-label="Phone case preview">
      {/* Phone body */}
      <rect
        x={phoneX} y={phoneY}
        width={phoneW} height={phoneH}
        rx="12" ry="12"
        fill={color}
        stroke="rgba(255,255,255,0.15)"
        strokeWidth="1"
      />
      {/* Camera cutout */}
      <rect
        x={38} y={18}
        width={44} height={16}
        rx="6" ry="6"
        fill="rgba(0,0,0,0.3)"
      />

      {/* Print area boundary */}
      <rect
        x={printX} y={printY}
        width={printW} height={printH}
        fill="none"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="0.8"
        strokeDasharray="3 2.5"
        rx="1"
      />

      {/* Design image */}
      {designImageUrl && (
        <image
          href={designImageUrl}
          x={designX} y={designY}
          width={designW} height={designH}
          preserveAspectRatio="xMidYMid meet"
        />
      )}
    </svg>
  );
}
