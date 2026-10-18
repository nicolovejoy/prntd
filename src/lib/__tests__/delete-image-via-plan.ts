import { planImageDeletion, executeImageDeletion } from "@/lib/delete-image";

type Db = Parameters<typeof planImageDeletion>[0];
type Removed = Awaited<ReturnType<typeof executeImageDeletion>>["designRemoved"];

/**
 * Plan then execute one image delete scoped to a conversation, the way the
 * My Designs bulk delete drives the same two functions. A plan the rules
 * refuse (an order reference, or an image the conversation cannot reach)
 * comes back as `refused` with the outcome and writes nothing.
 */
export async function deleteImageViaPlan(
  db: Db,
  designId: string,
  imageId: string
): Promise<{ refused: string | null; designRemoved: Removed | undefined }> {
  const plan = await planImageDeletion(db, imageId, { designId });
  if (
    plan.outcome === "blocked-by-order" ||
    plan.outcome === "not-found" ||
    plan.outcome === "not-owned"
  ) {
    return { refused: plan.outcome, designRemoved: undefined };
  }
  const { designRemoved } = await executeImageDeletion(db, plan);
  return { refused: null, designRemoved };
}
