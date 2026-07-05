import { describe, it, expect, beforeEach } from "vitest";
import { buildPageCapture, OUTLINE_MAX_CHARS } from "../capture";

// Widget-side page capture (ported from ibuild4you). A pure DOM walk that
// produces a structural outline (headings, landmarks, control labels, counts)
// and NEVER user-typed values. Privacy is the contract here: most of these
// tests assert what does NOT appear.

function setBody(html: string) {
  document.body.innerHTML = html;
}

const loc = { pathname: "/checkout" };

beforeEach(() => {
  document.body.innerHTML = "";
  document.title = "Checkout — PRNTD";
});

describe("buildPageCapture — basics", () => {
  it("captures version, route (path only) and title", () => {
    setBody("<h1>Checkout</h1>");
    const cap = buildPageCapture(document, loc);
    expect(cap.v).toBe(1);
    expect(cap.route).toBe("/checkout");
    expect(cap.title).toBe("Checkout — PRNTD");
  });

  it("lists h1–h3 headings in document order, tagged by level", () => {
    setBody("<h1>Checkout</h1><h2>Contact</h2><h3>Shipping address</h3><h2>Payment</h2>");
    const { outline } = buildPageCapture(document, loc);
    const h1 = outline.indexOf("h1: Checkout");
    const h2a = outline.indexOf("h2: Contact");
    const h3 = outline.indexOf("h3: Shipping address");
    const h2b = outline.indexOf("h2: Payment");
    expect(h1).toBeGreaterThanOrEqual(0);
    expect(h2a).toBeGreaterThan(h1);
    expect(h3).toBeGreaterThan(h2a);
    expect(h2b).toBeGreaterThan(h3);
  });

  it("ignores h4–h6 (structure, not detail)", () => {
    setBody("<h1>Top</h1><h4>Fine print</h4>");
    const { outline } = buildPageCapture(document, loc);
    expect(outline).not.toContain("Fine print");
  });

  it("captures nav landmarks with their accessible name and link labels", () => {
    setBody(
      '<nav aria-label="Main"><a href="/">Home</a><a href="/offers">Offers</a><a href="/contact">Contact</a></nav>',
    );
    const { outline } = buildPageCapture(document, loc);
    expect(outline).toContain("nav (Main): Home | Offers | Contact");
  });

  it("captures button labels, deduplicated", () => {
    setBody(
      '<button>Place order</button><button>Cancel</button><button>Cancel</button><input type="submit" value="Apply coupon">',
    );
    const { outline } = buildPageCapture(document, loc);
    expect(outline).toContain("buttons: Place order | Cancel | Apply coupon");
  });

  it("captures form field labels", () => {
    setBody(
      '<form><label for="em">Email</label><input id="em" type="email">' +
        "<label>Card number<input type='text'></label>" +
        '<input type="text" placeholder="Promo code"></form>',
    );
    const { outline } = buildPageCapture(document, loc);
    expect(outline).toContain("fields: Email | Card number | Promo code");
  });

  it("counts tables and long lists instead of dumping their content", () => {
    const rows = Array.from({ length: 12 }, (_, i) => `<tr><td>row ${i}</td></tr>`).join("");
    const items = Array.from({ length: 8 }, (_, i) => `<li>item ${i}</li>`).join("");
    setBody(`<table>${rows}</table><ul>${items}</ul>`);
    const { outline } = buildPageCapture(document, loc);
    expect(outline).toContain("table: 12 rows");
    expect(outline).toContain("list: 8 items");
    expect(outline).not.toContain("row 3");
    expect(outline).not.toContain("item 5");
  });

  it("does not count short lists or lists inside nav", () => {
    setBody(
      '<nav><ul><li><a href="/">Home</a></li><li><a href="/a">A</a></li><li><a href="/b">B</a></li><li><a href="/c">C</a></li></ul></nav>' +
        "<ul><li>one</li><li>two</li></ul>",
    );
    const { outline } = buildPageCapture(document, loc);
    expect(outline).not.toContain("list:");
  });
});

describe("buildPageCapture — privacy (what must NOT leak)", () => {
  it("never captures input values", () => {
    setBody(
      '<form><label for="em">Email</label><input id="em" type="email" value="sam@secret.com">' +
        "<textarea>my private note</textarea></form>",
    );
    const { outline } = buildPageCapture(document, loc);
    expect(outline).not.toContain("sam@secret.com");
    expect(outline).not.toContain("my private note");
  });

  it("skips password and hidden inputs entirely (not even their labels)", () => {
    setBody(
      '<form><label for="pw">Password</label><input id="pw" type="password">' +
        '<input type="hidden" name="csrf" value="tok123"></form>',
    );
    const { outline } = buildPageCapture(document, loc);
    expect(outline).not.toContain("Password");
    expect(outline).not.toContain("tok123");
    expect(outline).not.toContain("csrf");
  });

  it("never captures non-heading body text", () => {
    setBody("<h1>Invoice</h1><p>Client owes $12,345 due Friday</p>");
    const { outline } = buildPageCapture(document, loc);
    expect(outline).not.toContain("12,345");
  });

  it("excludes anything under data-loop-redact (the host-app escape hatch)", () => {
    setBody(
      "<h1>Deals</h1><section data-loop-redact><h2>Acme Corp offer</h2><button>Accept $50k</button></section>",
    );
    const { outline } = buildPageCapture(document, loc);
    expect(outline).toContain("h1: Deals");
    expect(outline).not.toContain("Acme");
    expect(outline).not.toContain("50k");
  });

  it("excludes hidden and aria-hidden elements", () => {
    setBody(
      '<h2 hidden>Secret A</h2><div aria-hidden="true"><h2>Secret B</h2></div><h2>Visible</h2>',
    );
    const { outline } = buildPageCapture(document, loc);
    expect(outline).not.toContain("Secret A");
    expect(outline).not.toContain("Secret B");
    expect(outline).toContain("h2: Visible");
  });
});

describe("buildPageCapture — caps", () => {
  it("truncates individual item text", () => {
    setBody(`<h1>${"x".repeat(300)}</h1>`);
    const { outline } = buildPageCapture(document, loc);
    const line = outline.split("\n").find((l) => l.startsWith("h1:"))!;
    expect(line.length).toBeLessThanOrEqual(90);
    expect(line).toContain("…");
  });

  it("caps the whole outline", () => {
    const headings = Array.from(
      { length: 400 },
      (_, i) => `<h2>Section ${i} lorem ipsum dolor</h2>`,
    ).join("");
    setBody(headings);
    const { outline } = buildPageCapture(document, loc);
    expect(outline.length).toBeLessThanOrEqual(OUTLINE_MAX_CHARS);
  });

  it("collapses whitespace in captured text", () => {
    setBody("<h1>  Multi\n   line\ttitle  </h1>");
    const { outline } = buildPageCapture(document, loc);
    expect(outline).toContain("h1: Multi line title");
  });
});
