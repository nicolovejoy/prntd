import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FullscreenViewer } from "../fullscreen-viewer";

const OPTIONS = [
  { key: "front", label: "Front" },
  { key: "back", label: "Back" },
];

function Harness({
  withOptions = false,
  onSelect = () => {},
}: {
  withOptions?: boolean;
  onSelect?: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <button>Elsewhere</button>
      {open && (
        <FullscreenViewer
          label="Design preview"
          onClose={() => setOpen(false)}
          options={withOptions ? OPTIONS : undefined}
          activeKey="front"
          onSelect={onSelect}
        >
          <img alt="Art" src="https://img.example/a.png" />
        </FullscreenViewer>
      )}
    </>
  );
}

function openViewer(props: Parameters<typeof Harness>[0] = {}) {
  render(<Harness {...props} />);
  const opener = screen.getByText("Open");
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

const dialog = () => screen.getByTestId("fullscreen-viewer");
const closeBtn = () => screen.getByTestId("fullscreen-viewer-close");

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("FullscreenViewer dialog semantics", () => {
  it("is a labelled modal dialog", () => {
    openViewer();
    const d = screen.getByRole("dialog", { name: "Design preview" });
    expect(d).toHaveAttribute("aria-modal", "true");
  });

  it("is portaled to document.body, outside the render container", () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByText("Open"));
    expect(container.contains(dialog())).toBe(false);
    expect(document.body.contains(dialog())).toBe(true);
  });

  it("puts focus on Close when it opens", () => {
    openViewer();
    expect(closeBtn()).toHaveFocus();
  });
});

describe("FullscreenViewer closing", () => {
  it("Escape closes it and is default-prevented so Breadcrumbs does not navigate up", () => {
    openViewer();
    const probe = vi.fn();
    window.addEventListener("keydown", probe);
    const proceeded = fireEvent.keyDown(document.body, { key: "Escape" });
    window.removeEventListener("keydown", probe);
    expect(proceeded).toBe(false); // preventDefault was called
    expect(probe).not.toHaveBeenCalled();
    expect(screen.queryByTestId("fullscreen-viewer")).toBeNull();
  });

  it("Close closes it", () => {
    openViewer();
    fireEvent.click(closeBtn());
    expect(screen.queryByTestId("fullscreen-viewer")).toBeNull();
  });

  it("a tap on the empty area closes it", () => {
    openViewer();
    fireEvent.click(dialog());
    expect(screen.queryByTestId("fullscreen-viewer")).toBeNull();
  });

  it("a tap on the image closes it", () => {
    openViewer();
    fireEvent.click(screen.getByAltText("Art"));
    expect(screen.queryByTestId("fullscreen-viewer")).toBeNull();
  });

  it("a tap on a switch option does not close it and reports the key", () => {
    const onSelect = vi.fn();
    openViewer({ withOptions: true, onSelect });
    fireEvent.click(screen.getByTestId("fullscreen-viewer-option-back"));
    expect(onSelect).toHaveBeenCalledWith("back");
    expect(screen.getByTestId("fullscreen-viewer")).toBeInTheDocument();
  });

  it("a tap on a button inside the content does not close it", () => {
    const onClose = vi.fn();
    render(
      <FullscreenViewer label="x" onClose={onClose}>
        <button>Retry preview</button>
      </FullscreenViewer>
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry preview" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("FullscreenViewer focus", () => {
  it("returns focus to the opener on close", () => {
    const opener = openViewer();
    fireEvent.click(closeBtn());
    expect(opener).toHaveFocus();
  });

  it("wraps Tab from the last control to the first, and Shift+Tab back", () => {
    openViewer({ withOptions: true });
    // DOM order: Front, Back, Close.
    closeBtn().focus();
    const tabForward = fireEvent.keyDown(closeBtn(), { key: "Tab" });
    expect(tabForward).toBe(false);
    expect(screen.getByTestId("fullscreen-viewer-option-front")).toHaveFocus();

    const first = screen.getByTestId("fullscreen-viewer-option-front");
    const tabBack = fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(tabBack).toBe(false);
    expect(closeBtn()).toHaveFocus();
  });

  it("leaves Tab between inner controls to the browser", () => {
    openViewer({ withOptions: true });
    const first = screen.getByTestId("fullscreen-viewer-option-front");
    first.focus();
    expect(fireEvent.keyDown(first, { key: "Tab" })).toBe(true);
  });

  it("keeps focus on Close when it is the only control", () => {
    openViewer();
    expect(fireEvent.keyDown(closeBtn(), { key: "Tab" })).toBe(false);
    expect(closeBtn()).toHaveFocus();
  });

  it("pulls focus back inside when it lands outside", () => {
    openViewer({ withOptions: true });
    fireEvent.focusIn(screen.getByText("Elsewhere"));
    expect(closeBtn()).toHaveFocus();
  });
});

describe("FullscreenViewer switch keys", () => {
  it("ArrowRight and ArrowLeft move between options and stop at the ends", () => {
    const onSelect = vi.fn();
    openViewer({ withOptions: true, onSelect });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith("back");
    onSelect.mockClear();
    fireEvent.keyDown(window, { key: "ArrowLeft" }); // already on front
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("marks the active option with aria-pressed", () => {
    openViewer({ withOptions: true });
    expect(screen.getByTestId("fullscreen-viewer-option-front")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByTestId("fullscreen-viewer-option-back")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("renders no switch for fewer than two options", () => {
    openViewer();
    expect(screen.queryByTestId("fullscreen-viewer-option-front")).toBeNull();
  });
});

describe("FullscreenViewer scroll lock", () => {
  it("hides body overflow while open and restores the previous value after", () => {
    document.body.style.overflow = "scroll";
    openViewer();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(closeBtn());
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("restores it when unmounted while open", () => {
    document.body.style.overflow = "";
    const { unmount } = render(
      <FullscreenViewer label="x" onClose={vi.fn()}>
        <img alt="Art" src="https://img.example/a.png" />
      </FullscreenViewer>
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("FullscreenViewer does not block pinch-zoom", () => {
  it("does not prevent touchmove or wheel, and sets no touch-action", () => {
    openViewer();
    expect(fireEvent.touchStart(dialog())).toBe(true);
    expect(fireEvent.touchMove(dialog())).toBe(true);
    expect(fireEvent.wheel(dialog())).toBe(true);
    // jsdom's CSSStyleDeclaration has no `touchAction` property (undefined),
    // so assert on the style attribute itself.
    expect(dialog().getAttribute("style") ?? "").not.toMatch(/touch-action/);
    expect(dialog().className).not.toMatch(/\btouch-(none|pan|manipulation)/);
  });

  it("the app never switches zooming off through the viewport", () => {
    const root = resolve(__dirname, "../../app");
    const files: string[] = [];
    (function walk(dir: string) {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== "__tests__") walk(p);
        } else if (/\.(ts|tsx)$/.test(name)) files.push(p);
      }
    })(root);
    const offenders = files.filter((f) =>
      /maximumScale|userScalable|maximum-scale|user-scalable/.test(
        readFileSync(f, "utf8")
      )
    );
    expect(offenders).toEqual([]);
  });
});
