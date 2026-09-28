/**
 * Builds `path` plus the query string carried by a Next `searchParams`
 * object, for the retired routes that 308 to their replacement and must
 * preserve whatever query string a caller had attached (nav model A).
 */
export function pathWithSearch(
  path: string,
  searchParams: Record<string, string | string[] | undefined>
): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) usp.append(key, v);
    } else {
      usp.append(key, value);
    }
  }
  const qs = usp.toString();
  return qs ? `${path}?${qs}` : path;
}
