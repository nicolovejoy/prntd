import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PublishCta } from "../publish-cta";

// PublishModal (opened by PublishCta) imports the real server action module
// directly; unmocked, that pulls in @/lib/auth → better-auth → optional
// otel deps that don't resolve under vitest. Mirrors buy-hero.test.tsx.
vi.mock("@/app/designs/actions", () => ({
  publishImage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

/**
 * `canPublish` comes from the page's own session read (isAnonymousUser) —
 * a guest-funnel session must see the "why", not a Publish button that
 * would just throw server-side (see publishImage's own gate).
 */
describe("PublishCta", () => {
  it("canPublish: renders the Publish button, opens the modal", () => {
    render(
      <PublishCta imageId="img-1" imageUrl="https://img.example/a.png" canPublish />
    );
    const button = screen.getByRole("button", { name: "Publish" });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.getByText("Publish to the Shop")).toBeInTheDocument();
  });

  it("!canPublish: no Publish button, a Sign in to publish link instead", () => {
    render(
      <PublishCta
        imageId="img-1"
        imageUrl="https://img.example/a.png"
        canPublish={false}
      />
    );
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    const link = screen.getByRole("link", { name: "Sign in to publish" });
    expect(link).toHaveAttribute(
      "href",
      `/sign-in?next=${encodeURIComponent("/d/img-1")}`
    );
  });
});
