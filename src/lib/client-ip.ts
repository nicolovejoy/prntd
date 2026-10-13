/** First IP from the forwarded-for chain (the client), or null. */
export function clientIp(hdrs: Headers): string | null {
  return hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}
