import { requireRealUser } from "@/lib/require-user";
import { getStudioLanesData } from "@/lib/studio";
import { StudioClient } from "./studio-client";

// Server-rendered initial data (#127 shape): the lanes arrive in the first
// response; the client only polls while a generation is in flight.
export default async function StudioPage() {
  const session = await requireRealUser();
  const lanes = await getStudioLanesData(session.user.id);
  return <StudioClient initialLanes={lanes} />;
}
