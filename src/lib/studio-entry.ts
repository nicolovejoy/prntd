import { getStudioLanesData } from "@/lib/studio";
import { BENCH_HREF, laneStageHref } from "@/lib/studio-focus";

type LanesDb = NonNullable<Parameters<typeof getStudioLanesData>[1]>["db"];

/**
 * Where an old `/design?id=` link lands (#188 slice 2c). One rule, the one the
 * bench itself uses for a lane's title link: the conversation's stage on its
 * primary result, else its newest, else the bench.
 *
 * The bench is the answer for everything the stage cannot show: a
 * conversation with no result yet, a closed or archived one, another user's,
 * and an id that matches nothing. Nothing here writes, so a closed
 * conversation stays closed (ruling 6); My Designs lists it.
 *
 * It reads the viewer's lanes (`getStudioLanesData`) rather than querying the
 * conversation directly, so the redirect and the bench cannot disagree about
 * which conversations are open or which results are hidden.
 */
export async function conversationStudioHref(
  userId: string,
  designId: string,
  opts: { db?: LanesDb } = {}
): Promise<string> {
  const lanes = await getStudioLanesData(userId, opts);
  const lane = lanes.find((l) => l.designId === designId);
  return (lane && laneStageHref(lane)) ?? BENCH_HREF;
}
