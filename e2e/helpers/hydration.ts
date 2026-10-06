import { expect, type Locator } from "@playwright/test";

/**
 * Wait until React has hydrated the element `locator` points at, so a click on
 * it reaches its handler.
 *
 * Why not wait for the "Total" row: on the image detail page the buy panel is
 * rendered on the server from the link's picks (`?order=1&size=M&…`), so Total
 * and the enabled Order / Add to cart buttons are already in the HTML before
 * any JavaScript runs. A click that lands then does nothing: the handler is
 * not attached yet, and the test only fails later, at the next URL wait. (On
 * the old /preview the total came from a server action, so waiting for it
 * happened to prove hydration. That no longer holds.)
 *
 * React 19 attaches an own property named `__reactFiber$<random>` (and
 * `__reactProps$<random>`) to a host element when it hydrates it. An element
 * that was only server-rendered has neither, so their presence is a signal on
 * the element itself. It reads React internals, which can change names across
 * major versions; if a React upgrade makes this time out, check those key
 * prefixes first.
 *
 * Pass the same locator the click will use, so a hidden twin (the panel renders
 * its buttons once for desktop and once for the mobile sticky bar) is not the
 * one checked.
 */
export async function waitForHydrated(
  locator: Locator,
  timeout = 30_000
): Promise<void> {
  await expect
    .poll(
      () =>
        locator
          .first()
          .evaluate(
            (el) =>
              Object.keys(el).some(
                (key) =>
                  key.startsWith("__reactFiber$") ||
                  key.startsWith("__reactProps$")
              ),
            undefined,
            { timeout: 5_000 }
          )
          .catch(() => false),
      {
        timeout,
        message:
          "the element never hydrated: no __reactFiber$/__reactProps$ key appeared on it",
      }
    )
    .toBe(true);
}
