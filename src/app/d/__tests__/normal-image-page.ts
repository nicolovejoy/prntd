/**
 * `getImagePage` for tests that only ever expect a normal page or null. The
 * real action can also return the owner's hidden notice (`HiddenImagePage`);
 * a test that meets it here has set up the wrong image, so this throws rather
 * than let the variant flow on as an `ImagePage`.
 */
import { getImagePage as getImagePageOrNotice, type ImagePage } from "@/app/d/actions";

export async function getImagePage(imageId: string): Promise<ImagePage | null> {
  const page = await getImagePageOrNotice(imageId);
  if (page?.hiddenForOwner) {
    throw new Error("getImagePage returned the hidden-owner notice");
  }
  return page;
}
