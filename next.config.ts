import type { NextConfig } from "next";

// R2 hosts next/image is allowed to fetch + optimize (#127 slice 3). The
// public bucket is normally a Cloudflare-issued pub-xxx.r2.dev subdomain
// (wildcard below); NEXT_PUBLIC_R2_PUBLIC_URL can also point at a custom
// domain (e.g. a CNAME'd bucket), which isn't covered by the wildcard, so add
// it explicitly when present.
const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
let r2CustomHostname: string | undefined;
if (r2PublicUrl) {
  try {
    const hostname = new URL(r2PublicUrl).hostname;
    if (!hostname.endsWith(".r2.dev")) {
      r2CustomHostname = hostname;
    }
  } catch {
    // Malformed value — the r2.dev wildcard below still covers the default host.
  }
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.r2.dev" },
      ...(r2CustomHostname
        ? [{ protocol: "https" as const, hostname: r2CustomHostname }]
        : []),
    ],
    // Next.js 16 requires an explicit allowlist; 75 is next/image's own default.
    qualities: [75],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  env: {
    NEXT_PUBLIC_BUILD_DATE: new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }) + " PST",
  },
};

export default nextConfig;
