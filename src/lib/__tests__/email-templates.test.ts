/**
 * Email template snapshots (WP5). Renders each shared-emailLayout template with
 * fixed fixture data and snapshots the exact HTML + subject, so copy/layout
 * regressions show up as reviewable diffs instead of shipping silently.
 * Resend is mocked; nothing leaves the process.
 *
 * If a snapshot diff is INTENTIONAL (copy change, layout tweak), re-run with
 * `npx vitest run -u src/lib/__tests__/email-templates.test.ts` and review the
 * updated snapshot in the PR.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { id: "email_1" } }));
vi.mock("resend", () => ({
  Resend: vi.fn(() => ({ emails: { send: sendMock } })),
}));

import {
  emailLayout,
  sendOrderConfirmation,
  sendOwnerOrderAlert,
  sendShippingNotification,
  sendPasswordResetEmail,
} from "@/lib/email";

type SentEmail = {
  to: string;
  subject: string;
  html: string;
};

function lastSent(): SentEmail {
  expect(sendMock).toHaveBeenCalledTimes(1);
  return sendMock.mock.calls[0][0] as SentEmail;
}

const FRONT_IMAGE = {
  label: "Front",
  url: "https://mock.example/front-mockup.png",
  backdrop: null,
};
const BACK_IMAGE = {
  label: "Back",
  url: "https://img.example/back-artwork.png",
  backdrop: "#0c0c0c",
};

beforeEach(() => {
  sendMock.mockClear();
});

describe("emailLayout", () => {
  it("renders the shared wrapper (header, card, footer, CTA, hero) stably", () => {
    const html = emailLayout({
      preheader: "Preheader text",
      heading: "A heading",
      intro: "An intro paragraph.",
      images: [FRONT_IMAGE, BACK_IMAGE],
      bodyHtml: "<p>Body</p>",
      ctaLabel: "Do the thing",
      ctaUrl: "https://prntd.org/thing",
    });
    expect(html).toMatchSnapshot();
  });

  it("omits optional sections cleanly when absent", () => {
    expect(emailLayout({ heading: "Bare" })).toMatchSnapshot();
  });
});

describe("sendOrderConfirmation", () => {
  it("single-line order with display name", async () => {
    await sendOrderConfirmation({
      to: "customer@example.com",
      orderId: "abcd1234-5678-90ab-cdef-000000000000",
      total: 24.12,
      lines: [
        { productName: "Classic Tee", size: "M", color: "Black", quantity: 1 },
      ],
      displayName: "Midnight Fox",
      images: [FRONT_IMAGE],
    });
    const sent = lastSent();
    expect(sent.to).toBe("customer@example.com");
    expect(sent.subject).toMatchSnapshot("subject");
    expect(sent.html).toMatchSnapshot("html");
  });

  it("multi-line cart order without display name", async () => {
    await sendOrderConfirmation({
      to: "customer@example.com",
      orderId: "abcd1234-5678-90ab-cdef-000000000000",
      total: 43.55,
      lines: [
        { productName: "Classic Tee", size: "M", color: "Black", quantity: 1 },
        { productName: "Box Tee", size: "L", color: "White", quantity: 2 },
      ],
      displayName: null,
    });
    const sent = lastSent();
    expect(sent.subject).toMatchSnapshot("subject");
    expect(sent.html).toMatchSnapshot("html");
  });
});

describe("sendOwnerOrderAlert", () => {
  it("renders the admin alert with discount and design rows", async () => {
    await sendOwnerOrderAlert({
      orderId: "abcd1234-5678-90ab-cdef-000000000000",
      customerEmail: "customer@example.com",
      total: 14.41,
      lines: [
        { productName: "Classic Tee", size: "M", color: "Black", quantity: 1 },
      ],
      discountCode: "HALF",
      displayName: "Midnight Fox",
      images: [FRONT_IMAGE],
    });
    const sent = lastSent();
    expect(sent.subject).toMatchSnapshot("subject");
    expect(sent.html).toMatchSnapshot("html");
  });
});

describe("sendShippingNotification", () => {
  it("with tracking number and URL", async () => {
    await sendShippingNotification({
      to: "customer@example.com",
      orderId: "abcd1234-5678-90ab-cdef-000000000000",
      trackingNumber: "1Z999AA10123456784",
      trackingUrl: "https://track.example/1Z999AA10123456784",
      displayName: "Midnight Fox",
      images: [FRONT_IMAGE, BACK_IMAGE],
    });
    const sent = lastSent();
    expect(sent.subject).toMatchSnapshot("subject");
    expect(sent.html).toMatchSnapshot("html");
  });

  it("without tracking info yet", async () => {
    await sendShippingNotification({
      to: "customer@example.com",
      orderId: "abcd1234-5678-90ab-cdef-000000000000",
      trackingNumber: null,
      trackingUrl: null,
      displayName: null,
    });
    const sent = lastSent();
    expect(sent.subject).toMatchSnapshot("subject");
    expect(sent.html).toMatchSnapshot("html");
  });
});

describe("sendPasswordResetEmail", () => {
  it("renders the reset CTA", async () => {
    await sendPasswordResetEmail({
      to: "customer@example.com",
      url: "https://prntd.org/reset-password?token=fixture-token",
    });
    const sent = lastSent();
    expect(sent.subject).toMatchSnapshot("subject");
    expect(sent.html).toMatchSnapshot("html");
  });
});
