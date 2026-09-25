import { after } from "next/server";
import { requireStudioUser } from "@/lib/require-user";
import { getStudioLanesData, sweepStudioForUser } from "@/lib/studio";
import { StudioClient } from "./studio-client";
import { GuestKeepLine } from "./guest-keep-line";

// Server-rendered initial data (#127 shape): the lanes arrive in the first
// response; the client only polls while a generation is in flight.
//
// The sweeps run via `after()` (#204), scheduled BEFORE the read so a
// thrown read still lets them run. The response can therefore be one sweep
// behind — see sweepStudioForUser's docblock.
//
// Guests (#241): requireStudioUser admits an anonymous guest-funnel session
// while GUEST_FUNNEL_ENABLED is on. Their lanes are the anonymous user's, and
// the page adds the sign-up line above the bench.
export default async function StudioPage() {
  const { session, isGuest } = await requireStudioUser();
  after(() => sweepStudioForUser(session.user.id));
  const lanes = await getStudioLanesData(session.user.id);
  return (
    <>
      {isGuest && <GuestKeepLine />}
      <StudioClient initialLanes={lanes} />
    </>
  );
}
