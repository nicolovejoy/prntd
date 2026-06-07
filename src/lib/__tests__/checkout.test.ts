import { describe, it, expect } from "vitest";
import { buildCheckoutSessionParams } from "../checkout";

const base = {
  orderId: "order-1",
  designId: "design-1",
  productName: "Unisex Tee",
  color: "Black",
  size: "L",
  itemPrice: 19.43,
  shippingPrice: 4.69,
  imageUrl: "https://cdn.example.com/img.png",
  cancelUrl: "https://prntd.org/order?id=design-1",
  appUrl: "https://prntd.org",
};

describe("buildCheckoutSessionParams", () => {
  it("prices the single line item in cents, rounded", () => {
    const p = buildCheckoutSessionParams({ ...base, itemPrice: 19.43 });
    const item = p.line_items![0];
    expect(item.quantity).toBe(1);
    expect(item.price_data!.unit_amount).toBe(1943);
    expect(item.price_data!.currency).toBe("usd");
  });

  it("rounds fractional cents to the nearest integer", () => {
    const p = buildCheckoutSessionParams({ ...base, itemPrice: 12.005 });
    expect(p.line_items![0].price_data!.unit_amount).toBe(1201);
  });

  it("charges shipping as a separate shipping_option, never a second line item", () => {
    // The margin fix: Stripe applies percentage promo codes only to
    // line_items, so shipping billed via shipping_options is immune. Assert
    // there's exactly one line item (the product) and shipping lives in
    // shipping_options at the right amount.
    const p = buildCheckoutSessionParams(base);
    expect(p.line_items).toHaveLength(1);
    const rate = p.shipping_options![0].shipping_rate_data!;
    expect(rate.type).toBe("fixed_amount");
    expect(rate.fixed_amount!.amount).toBe(469);
    expect(rate.fixed_amount!.currency).toBe("usd");
    expect(rate.display_name).toBe("Standard shipping");
  });

  it("rounds the shipping amount to integer cents", () => {
    const p = buildCheckoutSessionParams({ ...base, shippingPrice: 4.695 });
    expect(p.shipping_options![0].shipping_rate_data!.fixed_amount!.amount).toBe(470);
  });

  it("labels the product 'PRNTD <name>' with color / size description", () => {
    const p = buildCheckoutSessionParams(base);
    const pd = p.line_items![0].price_data!.product_data!;
    expect(pd.name).toBe("PRNTD Unisex Tee");
    expect(pd.description).toBe("Black / L");
  });

  it("includes the image when present and omits it when null", () => {
    expect(
      buildCheckoutSessionParams(base).line_items![0].price_data!.product_data!
        .images
    ).toEqual(["https://cdn.example.com/img.png"]);
    expect(
      buildCheckoutSessionParams({ ...base, imageUrl: null }).line_items![0]
        .price_data!.product_data!.images
    ).toEqual([]);
  });

  it("carries orderId and designId in metadata", () => {
    const p = buildCheckoutSessionParams(base);
    expect(p.metadata).toEqual({ orderId: "order-1", designId: "design-1" });
  });

  it("builds the success_url from appUrl with the session-id placeholder and uses the given cancel_url", () => {
    const p = buildCheckoutSessionParams(base);
    expect(p.success_url).toBe(
      "https://prntd.org/order/confirm?session_id={CHECKOUT_SESSION_ID}"
    );
    expect(p.cancel_url).toBe("https://prntd.org/order?id=design-1");
  });

  it("is a one-time payment that allows promo codes and collects US shipping", () => {
    const p = buildCheckoutSessionParams(base);
    expect(p.mode).toBe("payment");
    expect(p.allow_promotion_codes).toBe(true);
    expect(p.shipping_address_collection!.allowed_countries).toEqual(["US"]);
  });
});
