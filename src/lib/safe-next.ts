const BASE = "http://prntd.invalid";

/**
 * Turns a user-supplied `?next=` into a same-origin relative path, or returns
 * `fallback`. The value ends up in `window.location.href`, so it must never
 * navigate off-site.
 *
 * A prefix check alone is not enough: browsers read `\` as `/`, and the URL
 * parser drops tab and newline, so `/\evil.example` and `/<TAB>/evil.example`
 * both mean `//evil.example`. Dot segments can also collapse into a
 * protocol-relative path (`/.//evil.example` resolves to `//evil.example`).
 * So the value is resolved against a dummy origin, and only the resolved
 * origin and path are trusted: the origin must be unchanged, and the resolved
 * path must not start with `//`.
 */
export function safeNextPath(
  raw: string | null | undefined,
  fallback = "/studio"
): string {
  if (!raw || raw[0] !== "/") return fallback;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE || url.pathname.startsWith("//")) return fallback;
  return url.pathname + url.search + url.hash;
}

/**
 * `path` with `?next=<next>` appended when `next` is a safe path; `path`
 * unchanged otherwise. For links that carry the post-auth destination along.
 */
export function withNext(
  path: string,
  next: string | null | undefined
): string {
  const safe = safeNextPath(next, "");
  return safe ? `${path}?next=${encodeURIComponent(safe)}` : path;
}
