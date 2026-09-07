import { describe, it, expect } from "vitest";
import {
  ADMIN_ALREADY_REFUNDED,
  ADMIN_RECOVER_ARCHIVE_HINT,
  ADMIN_REFUND_ISSUED,
  adminCannotRecover,
  adminCannotRefund,
  adminRecovered,
} from "@/lib/action-copy";

describe("admin action-result copy", () => {
  it("names the action a recovery took", () => {
    expect(adminRecovered("submitted")).toBe("Recovered: submitted");
  });

  it("carries the server's reason into the cannot-recover line", () => {
    expect(adminCannotRecover("session never paid")).toBe("Cannot recover: session never paid");
  });

  it("carries the server's reason into the cannot-refund line", () => {
    expect(adminCannotRefund("no charge")).toBe("Cannot refund: no charge");
  });

  it("keeps the archive hint out of the headline", () => {
    expect(adminCannotRecover("x")).not.toContain(ADMIN_RECOVER_ARCHIVE_HINT);
  });

  it("distinguishes a fresh refund from an already-refunded order", () => {
    expect(ADMIN_REFUND_ISSUED).not.toBe(ADMIN_ALREADY_REFUNDED);
  });
});
