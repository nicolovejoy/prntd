import { describe, it, expect } from "vitest";
import { isAdminEmail } from "@/lib/admin";

describe("isAdminEmail", () => {
  it("matches when both emails are equal", () => {
    expect(isAdminEmail("admin@example.com", "admin@example.com")).toBe(true);
  });

  it("rejects a different email", () => {
    expect(isAdminEmail("user@example.com", "admin@example.com")).toBe(false);
  });

  it("rejects when the session has no email", () => {
    expect(isAdminEmail(undefined, "admin@example.com")).toBe(false);
    expect(isAdminEmail(null, "admin@example.com")).toBe(false);
  });

  it("matches nothing when the admin email is unset", () => {
    expect(isAdminEmail("admin@example.com", undefined)).toBe(false);
    expect(isAdminEmail("admin@example.com", "")).toBe(false);
    // Both missing must not match either.
    expect(isAdminEmail(undefined, undefined)).toBe(false);
  });

  it("is case-sensitive (exact match, same as the /admin gate)", () => {
    expect(isAdminEmail("Admin@example.com", "admin@example.com")).toBe(false);
  });
});
