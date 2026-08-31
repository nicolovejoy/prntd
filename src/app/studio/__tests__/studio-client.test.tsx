/**
 * Render coverage for the read-only Studio screen: the empty state, a lane's
 * cells with the primary marked, and a running generation as a pending cell
 * with elapsed time. Polling behavior itself lives in generation-poll's unit
 * tests; the action is mocked out here.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StudioClient } from "../studio-client";
import type { StudioLane } from "@/lib/studio";

vi.mock("../actions", () => ({
  getStudioLanes: vi.fn(async () => []),
}));

function lane(overrides: Partial<StudioLane> = {}): StudioLane {
  return {
    designId: "design-1",
    title: "geometric wolf head",
    lastActiveAt: new Date(Date.now() - 5 * 60 * 1000),
    cells: [],
    pending: [],
    ...overrides,
  };
}

describe("StudioClient", () => {
  it("shows the empty state when there are no lanes", () => {
    render(<StudioClient initialLanes={[]} />);
    expect(screen.getByText("No open designs.")).toBeTruthy();
    expect(screen.getByText("New design")).toBeTruthy();
  });

  it("renders a lane's cells with the primary marked", () => {
    render(
      <StudioClient
        initialLanes={[
          lane({
            cells: [
              {
                imageId: "img-1",
                imageUrl: "https://cdn.example/1.png",
                isPrimary: false,
                createdAt: new Date(),
              },
              {
                imageId: "img-2",
                imageUrl: "https://cdn.example/2.png",
                isPrimary: true,
                createdAt: new Date(),
              },
            ],
          }),
        ]}
      />
    );

    expect(screen.getByText("geometric wolf head")).toBeTruthy();
    const cells = screen.getAllByTestId("studio-cell");
    expect(cells).toHaveLength(2);
    expect(cells[0].className).not.toContain("border-accent");
    expect(cells[1].className).toContain("border-accent");
  });

  it("renders a running generation as a pending cell with elapsed time", () => {
    render(
      <StudioClient
        initialLanes={[
          lane({
            pending: [
              {
                jobId: "job-1",
                generationNumber: 1,
                startedAt: new Date(Date.now() - 42 * 1000),
              },
            ],
          }),
        ]}
      />
    );

    const cell = screen.getByTestId("studio-pending-cell");
    expect(cell.textContent).toContain("Generating…");
    expect(cell.textContent).toMatch(/0:4[0-9]/);
  });

  it("falls back to Untitled when a lane has no label", () => {
    render(<StudioClient initialLanes={[lane({ title: null })]} />);
    expect(screen.getByText("Untitled")).toBeTruthy();
  });
});
