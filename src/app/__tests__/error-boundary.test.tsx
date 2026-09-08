import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorBoundary from "../error";
import GlobalError from "../global-error";

// The boundaries log the error on mount (ruling R4). Silence it so the
// suite output stays readable, and so an assertion can check it happened.
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

function makeError(digest?: string) {
  const err = new Error("boom") as Error & { digest?: string };
  if (digest) err.digest = digest;
  return err;
}

describe("app error boundary", () => {
  it("states what happened in one literal line", () => {
    render(
      <ErrorBoundary
        error={makeError()}
        unstable_retry={vi.fn()}
        reset={vi.fn()}
      />
    );
    expect(
      screen.getByText("Something went wrong loading this page.")
    ).toBeInTheDocument();
  });

  it("logs the error once on mount and never writes it to the page", () => {
    const error = makeError();
    render(
      <ErrorBoundary error={error} unstable_retry={vi.fn()} reset={vi.fn()} />
    );
    expect(consoleError).toHaveBeenCalledWith(error);
    // The thrown message is a Next digest in production, so it is never the
    // sentence the reader gets.
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  });

  it("re-fetches the segment via unstable_retry when Try again is tapped", () => {
    const retry = vi.fn();
    const reset = vi.fn();
    render(
      <ErrorBoundary error={makeError()} unstable_retry={retry} reset={reset} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it("falls back to reset if a future Next drops unstable_retry", () => {
    const reset = vi.fn();
    render(<ErrorBoundary error={makeError()} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("shows the digest so an admin can match it to /admin/errors", () => {
    render(
      <ErrorBoundary
        error={makeError("abc123def")}
        unstable_retry={vi.fn()}
        reset={vi.fn()}
      />
    );
    expect(screen.getByTestId("error-digest")).toHaveTextContent("abc123def");
  });

  it("renders no digest row when the error carries no digest", () => {
    render(
      <ErrorBoundary
        error={makeError()}
        unstable_retry={vi.fn()}
        reset={vi.fn()}
      />
    );
    expect(screen.queryByTestId("error-digest")).not.toBeInTheDocument();
  });

  it("offers the home page, not /studio (guests cannot reach /studio)", () => {
    render(
      <ErrorBoundary
        error={makeError()}
        unstable_retry={vi.fn()}
        reset={vi.fn()}
      />
    );
    const link = screen.getByRole("link", { name: "Go to the home page" });
    expect(link).toHaveAttribute("href", "/");
  });
});

describe("global error boundary", () => {
  it("states what happened and offers Try again", () => {
    const retry = vi.fn();
    render(
      <GlobalError
        error={makeError()}
        unstable_retry={retry}
        reset={vi.fn()}
      />
    );
    expect(
      screen.getByText("Something went wrong loading this page.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows the digest when present", () => {
    render(
      <GlobalError
        error={makeError("zz99")}
        unstable_retry={vi.fn()}
        reset={vi.fn()}
      />
    );
    expect(screen.getByTestId("global-error-digest")).toHaveTextContent("zz99");
  });
});
