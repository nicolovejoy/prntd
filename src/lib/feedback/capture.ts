// Widget-side page capture for Loop — mirrors ibuild4you's lib/feedback/capture.ts.
//
// A pure DOM walk that turns the page the user is looking at into a small
// structural outline the intake agent can reason over: route, title, headings,
// nav links, button/field labels, and counts for repeated structures. It is
// deliberately structure-only — the privacy contract is that user-typed values,
// non-heading body text, and query strings NEVER appear in the output. Any
// subtree with a `data-loop-redact` attribute is excluded entirely.

export interface PageCapture {
  v: 1;
  route: string; // location.pathname only — host + query stripped
  title: string;
  outline: string;
}

// Server-side caps mirror these (ibuild4you app/api/feedback/route.ts).
export const ROUTE_MAX_CHARS = 300;
export const TITLE_MAX_CHARS = 200;
export const OUTLINE_MAX_CHARS = 4000;

const ITEM_MAX_CHARS = 80;
const MAX_HEADINGS = 30;
const MAX_LABELS_PER_LINE = 15;

function clean(s: string | null | undefined): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= ITEM_MAX_CHARS ? t : t.slice(0, ITEM_MAX_CHARS - 1).trimEnd() + "…";
}

// Excluded: redacted subtrees (host escape hatch), hidden/aria-hidden elements.
// closest() checks the element itself and its ancestors.
function isExcluded(el: Element): boolean {
  return el.closest('[data-loop-redact],[hidden],[aria-hidden="true"]') !== null;
}

function joinLabels(prefix: string, labels: string[]): string | null {
  const seen = new Set<string>();
  const unique = labels.filter((l) => {
    if (!l || seen.has(l)) return false;
    seen.add(l);
    return true;
  });
  if (unique.length === 0) return null;
  return `${prefix}: ${unique.slice(0, MAX_LABELS_PER_LINE).join(" | ")}`;
}

function buttonLabel(el: Element): string {
  if (el instanceof HTMLInputElement) return clean(el.value); // submit/button inputs label via value
  return clean(el.getAttribute("aria-label") || el.textContent);
}

function fieldLabel(el: Element): string {
  // .labels covers both <label for=…> and wrapping <label> associations.
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length > 0) {
    // Label text minus the control's own value/content.
    const copy = labels[0].cloneNode(true) as HTMLElement;
    copy.querySelectorAll("input,select,textarea").forEach((c) => c.remove());
    const text = clean(copy.textContent);
    if (text) return text;
  }
  return clean(el.getAttribute("aria-label") || el.getAttribute("placeholder"));
}

// Build the structural outline of the current page. `loc` is passed in (rather
// than read from a global) so this stays pure and unit-testable.
export function buildPageCapture(doc: Document, loc: { pathname: string }): PageCapture {
  const lines: string[] = [];

  // Headings h1–h3, document order. h4+ is detail, not structure.
  const headings = Array.from(doc.querySelectorAll("h1,h2,h3"))
    .filter((el) => !isExcluded(el))
    .slice(0, MAX_HEADINGS);
  for (const h of headings) {
    const text = clean(h.textContent);
    if (text) lines.push(`${h.tagName.toLowerCase()}: ${text}`);
  }

  // Nav landmarks with their link labels.
  for (const nav of Array.from(doc.querySelectorAll('nav,[role="navigation"]'))) {
    if (isExcluded(nav)) continue;
    const links = Array.from(nav.querySelectorAll("a"))
      .filter((a) => !isExcluded(a))
      .map((a) => clean(a.textContent));
    const name = clean(nav.getAttribute("aria-label"));
    const line = joinLabels(name ? `nav (${name})` : "nav", links);
    if (line) lines.push(line);
  }

  // Button labels — what can the user do on this page?
  const buttons = Array.from(
    doc.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]'),
  )
    .filter((el) => !isExcluded(el))
    .map(buttonLabel);
  const buttonLine = joinLabels("buttons", buttons);
  if (buttonLine) lines.push(buttonLine);

  // Form field LABELS only — never values. Password/hidden skipped entirely.
  const fields = Array.from(doc.querySelectorAll("input,select,textarea"))
    .filter((el) => {
      const type = el.getAttribute("type")?.toLowerCase();
      if (type === "password" || type === "hidden" || type === "submit" || type === "button") {
        return false;
      }
      return !isExcluded(el);
    })
    .map(fieldLabel);
  const fieldLine = joinLabels("fields", fields);
  if (fieldLine) lines.push(fieldLine);

  // Repeated structures as counts, not content.
  for (const table of Array.from(doc.querySelectorAll("table")).slice(0, 5)) {
    if (isExcluded(table)) continue;
    lines.push(`table: ${table.querySelectorAll("tr").length} rows`);
  }
  for (const list of Array.from(doc.querySelectorAll("ul,ol")).slice(0, 10)) {
    if (isExcluded(list) || list.closest('nav,[role="navigation"]')) continue;
    const count = list.querySelectorAll(":scope > li").length;
    if (count >= 4) lines.push(`list: ${count} items`);
  }

  return {
    v: 1,
    route: (loc.pathname || "/").slice(0, ROUTE_MAX_CHARS),
    title: clean(doc.title).slice(0, TITLE_MAX_CHARS),
    outline: lines.join("\n").slice(0, OUTLINE_MAX_CHARS),
  };
}
