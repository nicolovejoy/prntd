/**
 * Studio "Attach image" with a photo-sized file (#351).
 *
 * The composer sends the prepared File to `attachReferenceImage` as a Blob.
 * The base64 hand-off it replaced was refused by React Flight's decode limit
 * (1,000,000 slots, every string argument counted by its length) once the
 * file passed about 750 KB, before the action body ran, and the Studio showed
 * "Couldn't attach that image. Try again." The integration tests call the
 * action directly and never pass through Flight, which is why this spec
 * exists: it drives the real Studio through the real action endpoint.
 *
 * The file: random noise encoded as JPEG at quality 95 does not compress, so
 * it lands at about 2.6 MB with no side over 2048 px. The device downscale
 * passes such a file through unchanged (it is under the 3 MB cap and the size
 * limit), so what reaches the server is this file, byte for byte.
 *
 * R2 is a fake in e2e (R2_DRY_RUN skips the object write), so the lane's cell
 * shows a URL nothing serves; the assertions are on the lane and the cell,
 * not on the pixels.
 */
import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { mintGuestSession } from "./helpers/session";
import { waitForHydrated } from "./helpers/hydration";
import {
  cleanupDesigns,
  cleanupUser,
  designIdsForUser,
  userIdForSessionCookie,
} from "./helpers/db";

const MAX_BYTES = 3 * 1024 * 1024;
/** Over the old base64 limit by a wide margin: 750 KB of image is 1 M characters. */
const MIN_BYTES = 2 * 1024 * 1024;

async function noiseJpeg(width = 1900, height = 1425): Promise<Buffer> {
  const raw = randomBytes(width * height * 3);
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

test("a 2.5 MB photo attaches through the Studio and starts a lane (#351)", async ({
  page,
}, testInfo) => {
  // One browser project is enough: the request body is the same on both.
  test.skip(testInfo.project.name !== "mobile", "viewport-independent");

  const photo = await noiseJpeg();
  expect(photo.length, "the noise JPEG is not photo-sized").toBeGreaterThan(MIN_BYTES);
  expect(photo.length, "the noise JPEG is over the 3 MB cap").toBeLessThanOrEqual(MAX_BYTES);

  let userId = "";
  try {
    userId = await userIdForSessionCookie(await mintGuestSession(page));
    await page.goto("/studio");
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await waitForHydrated(page.getByTestId("studio-attach"));

    await page.getByTestId("studio-attach-input").setInputFiles({
      name: "IMG_0351.jpg",
      mimeType: "image/jpeg",
      buffer: photo,
    });

    // The upload lands as a new lane with one cell, the composer anchors to
    // it, and the Attach button comes back.
    await expect(page.getByTestId("studio-lane")).toHaveCount(1, { timeout: 60_000 });
    await expect(page.getByTestId("studio-cell")).toHaveCount(1);
    await expect(page.getByTestId("anchor-chip")).toBeVisible();
    await expect(page.getByTestId("studio-attach")).toHaveText("Attach image");
    // No error line under the composer.
    await expect(page.getByTestId("attach-notice")).toHaveText("");
  } finally {
    if (userId) {
      await cleanupDesigns(await designIdsForUser(userId));
      await cleanupUser(userId);
    }
  }
});
