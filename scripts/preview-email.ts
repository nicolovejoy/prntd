/**
 * Dev-only: render the rebranded emails to /tmp/email-preview.html so the
 * look-and-feel can be eyeballed in a browser without sending anything.
 *
 *   npx tsx scripts/preview-email.ts
 */
import { writeFileSync } from "node:fs";
import { emailLayout } from "../src/lib/email";

const frontMock = "https://placehold.co/400x480/e4e4e7/18181b?text=FRONT+mockup";
const backMock = "https://placehold.co/400x480/e4e4e7/18181b?text=BACK+mockup";

const detail = `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 24px;">
    <tr><td style="padding:9px 0;color:#71717a;font-size:14px;">Design</td><td style="padding:9px 0;text-align:right;font-size:14px;color:#18181b;">Raccoon Café</td></tr>
    <tr><td style="padding:9px 0;color:#71717a;font-size:14px;">Order</td><td style="padding:9px 0;text-align:right;font-size:14px;color:#18181b;font-family:monospace;">ec857fa2</td></tr>
    <tr><td style="padding:9px 0;color:#71717a;font-size:14px;">Classic Tee</td><td style="padding:9px 0;text-align:right;font-size:14px;color:#18181b;">White / M</td></tr>
    <tr><td style="padding:9px 0;color:#71717a;font-size:14px;border-top:1px solid #e4e4e7;">Total</td><td style="padding:9px 0;text-align:right;font-size:14px;color:#18181b;font-weight:600;border-top:1px solid #e4e4e7;">$32.12</td></tr>
  </table>`;

const confirmTwo = emailLayout({
  heading: "Your order is confirmed",
  intro: "We're printing your Classic Tee now. We'll email you again when it ships with tracking.",
  images: [
    { label: "Front", url: frontMock, backdrop: null },
    { label: "Back", url: backMock, backdrop: null },
  ],
  bodyHtml: detail,
  ctaLabel: "View your orders",
  ctaUrl: "https://prntd.org/orders",
});

const confirmOne = emailLayout({
  heading: "Your order is confirmed",
  intro: "We're printing your Classic Tee now. We'll email you again when it ships with tracking.",
  images: [{ label: "Front", url: frontMock, backdrop: null }],
  bodyHtml: detail,
  ctaLabel: "View your orders",
  ctaUrl: "https://prntd.org/orders",
});

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Email preview</title></head>
<body style="margin:0;background:#d4d4d8;">
  <div style="text-align:center;font-family:sans-serif;color:#3f3f46;padding:16px;font-size:13px;">front + back order ↓</div>
  ${confirmTwo}
  <div style="text-align:center;font-family:sans-serif;color:#3f3f46;padding:16px;font-size:13px;">front-only order ↓</div>
  ${confirmOne}
</body></html>`;

writeFileSync("/tmp/email-preview.html", html);
console.log("Wrote /tmp/email-preview.html");
