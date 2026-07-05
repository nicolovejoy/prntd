import { Resend } from "resend";
import type { EmailImage } from "@/lib/email-images";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = "PRNTD <orders@prntd.org>";
const REPLY_TO = "hello@prntd.org";

// ---------------------------------------------------------------------------
// Shared layout
//
// One branded wrapper for every email: dark wordmark header, optional hero
// image(s), a white card body, and a footer. Email clients only reliably
// support tables + inline styles, so everything is built that way.
// ---------------------------------------------------------------------------

const INK = "#18181b"; // zinc-900 — brand ink
const MUTED = "#71717a"; // zinc-500
const BORDER = "#e4e4e7"; // zinc-200
const PAGE_BG = "#fafafa"; // zinc-50

function renderHero(images: EmailImage[] | undefined): string {
  if (!images || images.length === 0) return "";
  const showLabels = images.length > 1;
  const imgWidth = images.length > 1 ? 200 : 280;
  const cells = images
    .map(
      (img) => `
        <td align="center" valign="top" style="padding: 0 8px;">
          <div style="background: ${img.backdrop ?? "#f4f4f5"}; border-radius: 12px; padding: 14px; line-height: 0;">
            <img src="${img.url}" width="${imgWidth}" alt="${img.label} design" style="display: block; width: ${imgWidth}px; max-width: 100%; height: auto; border-radius: 6px;" />
          </div>
          ${
            showLabels
              ? `<div style="color: ${MUTED}; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; margin-top: 8px;">${img.label}</div>`
              : ""
          }
        </td>`
    )
    .join("");
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin: 0 auto 28px;">
      <tr>${cells}</tr>
    </table>`;
}

export function emailLayout(o: {
  preheader?: string;
  heading: string;
  intro?: string;
  images?: EmailImage[];
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}): string {
  const preheader = o.preheader
    ? `<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${o.preheader}</span>`
    : "";
  const intro = o.intro ? `<p style="color: #52525b; font-size: 15px; line-height: 1.5; margin: 0 0 24px;">${o.intro}</p>` : "";
  const cta =
    o.ctaLabel && o.ctaUrl
      ? `<p style="margin: 4px 0 0;"><a href="${o.ctaUrl}" style="display: inline-block; padding: 11px 22px; background: ${INK}; color: #fff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">${o.ctaLabel}</a></p>`
      : "";

  return `
    <body style="margin: 0; padding: 0; background: ${PAGE_BG};">
      ${preheader}
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background: ${PAGE_BG}; padding: 32px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; width: 100%; background: #ffffff; border: 1px solid ${BORDER}; border-radius: 16px; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
              <tr>
                <td style="background: ${INK}; padding: 18px 28px;">
                  <span style="color: #ffffff; font-size: 18px; font-weight: 700; letter-spacing: 0.18em;">PRNTD</span>
                </td>
              </tr>
              <tr>
                <td style="padding: 32px 28px 36px;">
                  ${renderHero(o.images)}
                  <h1 style="color: ${INK}; font-size: 21px; font-weight: 700; margin: 0 0 12px; text-align: center;">${o.heading}</h1>
                  ${intro}
                  ${o.bodyHtml ?? ""}
                  ${cta}
                </td>
              </tr>
              <tr>
                <td style="border-top: 1px solid ${BORDER}; padding: 20px 28px; text-align: center;">
                  <p style="color: ${MUTED}; font-size: 12px; margin: 0;">PRNTD · <a href="https://prntd.org" style="color: ${MUTED}; text-decoration: none;">prntd.org</a> · <a href="mailto:hello@prntd.org" style="color: ${MUTED}; text-decoration: none;">hello@prntd.org</a></p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>`;
}

function detailRow(label: string, value: string, opts: { mono?: boolean; total?: boolean } = {}): string {
  const top = opts.total ? `border-top: 1px solid ${BORDER};` : "";
  const weight = opts.total ? "font-weight: 600;" : "";
  const valStyle = opts.mono ? "font-family: ui-monospace, SFMono-Regular, Menlo, monospace;" : "";
  return `<tr>
    <td style="padding: 9px 0; color: ${MUTED}; font-size: 14px; ${top}">${label}</td>
    <td style="padding: 9px 0; text-align: right; font-size: 14px; color: ${INK}; ${weight} ${valStyle} ${top}">${value}</td>
  </tr>`;
}

function detailTable(rows: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; margin: 0 0 24px;">${rows}</table>`;
}

// ---------------------------------------------------------------------------
// Senders
// ---------------------------------------------------------------------------

export async function sendPasswordResetEmail(params: { to: string; url: string }) {
  await resend.emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: params.to,
    subject: "Reset your password",
    html: emailLayout({
      preheader: "Reset your PRNTD password",
      heading: "Reset your password",
      intro: "Click the button below to set a new password. This link expires in 1 hour. If you didn't request this, you can ignore this email.",
      ctaLabel: "Reset password",
      ctaUrl: params.url,
    }),
  });
}

/**
 * One purchased line for email display. Multi-item orders (#26) list every
 * line; legacy single-item orders pass exactly one.
 */
export type EmailOrderLine = {
  productName: string;
  size: string;
  color: string;
  quantity: number;
};

function lineLabel(line: EmailOrderLine): string {
  return line.quantity > 1
    ? `${line.productName} ×${line.quantity}`
    : line.productName;
}

/** Compact subject-line summary: first line's color/size, "+N more" beyond. */
function lineSummary(lines: EmailOrderLine[]): string {
  const first = lines[0];
  if (!first) return "";
  const more = lines.length > 1 ? ` +${lines.length - 1} more` : "";
  return `${first.color} ${first.size}${more}`;
}

export async function sendOrderConfirmation(params: {
  to: string;
  orderId: string;
  total: number;
  lines: EmailOrderLine[];
  displayName?: string | null;
  images?: EmailImage[];
}) {
  const shortId = params.orderId.slice(0, 8);
  const label = params.displayName ?? shortId;
  const firstName = params.lines[0]?.productName ?? "order";
  const printing =
    params.lines.length > 1
      ? `${firstName} and ${params.lines.length - 1} more`
      : firstName;
  const rows =
    (params.displayName ? detailRow("Design", params.displayName) : "") +
    detailRow("Order", shortId, { mono: true }) +
    params.lines
      .map((l) => detailRow(lineLabel(l), `${l.color} / ${l.size}`))
      .join("") +
    detailRow("Total", `$${params.total.toFixed(2)}`, { total: true });

  await resend.emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: params.to,
    subject: `Order confirmed — ${label} (${lineSummary(params.lines)})`,
    html: emailLayout({
      preheader: `We're printing your ${printing} now.`,
      heading: "Your order is confirmed",
      intro: `We're printing your ${printing} now. We'll email you again when it ships with tracking.`,
      images: params.images,
      bodyHtml: detailTable(rows),
      ctaLabel: "View your orders",
      ctaUrl: "https://prntd.org/orders",
    }),
  });
}

export async function sendOwnerOrderAlert(params: {
  orderId: string;
  customerEmail: string;
  total: number;
  lines: EmailOrderLine[];
  discountCode?: string | null;
  displayName?: string | null;
  images?: EmailImage[];
}) {
  const shortId = params.orderId.slice(0, 8);
  const rows =
    (params.displayName ? detailRow("Design", params.displayName) : "") +
    detailRow("Order", shortId, { mono: true }) +
    detailRow("Customer", params.customerEmail) +
    params.lines
      .map((l) => detailRow(lineLabel(l), `${l.color} / ${l.size}`))
      .join("") +
    (params.discountCode ? detailRow("Discount", params.discountCode) : "") +
    detailRow("Total", `$${params.total.toFixed(2)}`, { total: true });

  await resend.emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: process.env.OWNER_EMAIL ?? "nico@prntd.org",
    subject: `New order: ${params.displayName ?? shortId} — ${lineSummary(params.lines)} — $${params.total.toFixed(2)}`,
    html: emailLayout({
      heading: "New order",
      images: params.images,
      bodyHtml: detailTable(rows),
      ctaLabel: "View in admin",
      ctaUrl: `https://prntd.org/admin/orders/${params.orderId}`,
    }),
  });
}

export async function sendShippingNotification(params: {
  to: string;
  orderId: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  displayName?: string | null;
  images?: EmailImage[];
}) {
  const shortId = params.orderId.slice(0, 8);
  const label = params.displayName ?? shortId;
  const subject = params.displayName ? `"${params.displayName}" (order ${shortId})` : `Order ${shortId}`;

  const trackingBody = params.trackingNumber
    ? detailTable(detailRow("Tracking #", params.trackingNumber, { mono: true }))
    : !params.trackingUrl
      ? `<p style="color: #52525b; font-size: 14px; text-align: center; margin: 0 0 24px;">Tracking info will be available soon.</p>`
      : "";

  await resend.emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: params.to,
    subject: `Your order shipped — ${label}`,
    html: emailLayout({
      preheader: `${subject} has shipped.`,
      heading: "Your order is on the way",
      intro: `${subject} has shipped.`,
      images: params.images,
      bodyHtml: trackingBody,
      ctaLabel: params.trackingUrl ? "Track your package" : undefined,
      ctaUrl: params.trackingUrl ?? undefined,
    }),
  });
}
