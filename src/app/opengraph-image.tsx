import { ImageResponse } from "next/og";

export const alt = "PRNTD — Your idea, on a shirt";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Branded share card. Mirrors the site palette (near-black bg, white accent)
// from globals.css. Uses next/og's bundled default font (no font file needed).
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "96px",
          background: "#0a0a0a",
          color: "#ededed",
        }}
      >
        <div
          style={{
            fontSize: 220,
            fontWeight: 800,
            letterSpacing: "-0.04em",
            lineHeight: 1,
            color: "#ffffff",
          }}
        >
          PRNTD
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 32,
            fontSize: 52,
            color: "#999999",
          }}
        >
          Your idea, on a shirt.
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontSize: 34,
            color: "#666666",
          }}
        >
          prntd.org
        </div>
        {/* accent underline strip */}
        <div
          style={{
            display: "flex",
            marginTop: 56,
            width: 280,
            height: 10,
            background: "#ffffff",
            borderRadius: 5,
          }}
        />
      </div>
    ),
    { ...size },
  );
}
