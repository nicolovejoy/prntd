import { after } from "next/server";
import { requireRealUser } from "@/lib/require-user";
import { getStudioLanesData, sweepStudioForUser } from "@/lib/studio";
import { StudioClient } from "./studio-client";

// Server-rendered initial data (#127 shape): the lanes arrive in the first
// response; the client only polls while a generation is in flight.
//
// The sweeps run via `after()` (#204), scheduled BEFORE the read so a
// thrown read still lets them run. The response can therefore be one sweep
// behind — see sweepStudioForUser's docblock.
export default async function StudioPage() {
  const session = await requireRealUser();
  after(() => sweepStudioForUser(session.user.id));
  const lanes = await getStudioLanesData(session.user.id);
  return <StudioClient initialLanes={lanes} />;
}
