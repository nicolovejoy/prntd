import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = "PRNTD <orders@soiree.pianohouseproject.org>";

export async function sendPasswordResetEmail(params: {
  to: string;
  url: string;
}) {
  await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: "Reset your password",
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="margin: 0 0 16px;">Reset your password</h2>
        <p style="color: #555; margin: 0 0 24px;">Click the button below to set a new password. This link expires in 1 hour.</p>
        <a href="${params.url}" style="display: inline-block; padding: 10px 20px; background: #18181b; color: #fff; text-decoration: none; border-radius: 6px;">Reset password</a>
        <p style="color: #999; font-size: 13px; margin-top: 24px;">If you didn't request this, you can ignore this email.</p>
        <p style="color: #999; font-size: 12px; margin-top: 32px;">PRNTD &mdash; prntd.org</p>
      </div>
    `,
  });
}

export async function sendOrderConfirmation(params: {
  to: string;
  orderId: string;
  size: string;
  color: string;
  quality: string;
  total: number;
}) {
  const shortId = params.orderId.slice(0, 8);

  await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: `Order confirmed — ${shortId}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="margin: 0 0 16px;">Your order is confirmed</h2>
        <p style="color: #555; margin: 0 0 24px;">We're printing your custom t-shirt now.</p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr><td style="padding: 8px 0; color: #888;">Order</td><td style="padding: 8px 0; text-align: right; font-family: monospace;">${shortId}</td></tr>
          <tr><td style="padding: 8px 0; color: #888;">Shirt</td><td style="padding: 8px 0; text-align: right;">${params.color} / ${params.size} / ${params.quality}</td></tr>
          <tr style="border-top: 1px solid #eee;"><td style="padding: 8px 0; font-weight: 600;">Total</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">$${params.total.toFixed(2)}</td></tr>
        </table>
        <p style="color: #555; font-size: 14px;">We'll email you again when it ships with tracking info.</p>
        <p style="color: #999; font-size: 12px; margin-top: 32px;">PRNTD &mdash; prntd.org</p>
      </div>
    `,
  });
}

export async function sendShippingNotification(params: {
  to: string;
  orderId: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
}) {
  const shortId = params.orderId.slice(0, 8);

  const trackingHtml = params.trackingUrl
    ? `<p><a href="${params.trackingUrl}" style="display: inline-block; padding: 10px 20px; background: #18181b; color: #fff; text-decoration: none; border-radius: 6px;">Track your package</a></p>
       ${params.trackingNumber ? `<p style="color: #888; font-size: 13px;">Tracking #: ${params.trackingNumber}</p>` : ""}`
    : params.trackingNumber
      ? `<p style="color: #555;">Tracking #: ${params.trackingNumber}</p>`
      : `<p style="color: #555;">Tracking info will be available soon.</p>`;

  await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: `Your shirt shipped — ${shortId}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="margin: 0 0 16px;">Your shirt is on the way</h2>
        <p style="color: #555; margin: 0 0 24px;">Order ${shortId} has shipped.</p>
        ${trackingHtml}
        <p style="color: #999; font-size: 12px; margin-top: 32px;">PRNTD &mdash; prntd.org</p>
      </div>
    `,
  });
}
