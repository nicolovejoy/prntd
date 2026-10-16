import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireStudioUser } from "@/lib/require-user";
import { getStudioLanesData, sweepStudioForUser } from "@/lib/studio";
import {
  BENCH_HREF,
  focusHref,
  parseFocus,
  type ParamKey,
} from "@/lib/studio-focus";
import { parseSeed, seedHref, type ParsedSeed } from "@/lib/studio-seed";
import { StudioClient } from "./studio-client";

// The landing visitor's first generation runs from this page now (the
// seed, below), so its after() continuation gets this page's budget. Same
// ceiling and same reason as src/app/design/page.tsx's maxDuration.
export const maxDuration = 300;

// Server-rendered initial data (#127 shape): the lanes arrive in the first
// response; the client only polls while a generation is in flight.
//
// The sweeps run via `after()` (#204), scheduled BEFORE the read so a
// thrown read still lets them run. The response can therefore be one sweep
// behind — see sweepStudioForUser's docblock.
//
// Guests (#241): requireStudioUser admits an anonymous guest-funnel session
// while GUEST_FUNNEL_ENABLED is on. Their lanes are the anonymous user's.
// The client renders the sign-up/sign-in line under the composer once there
// is a lane to keep — including one the guest just started here — so it gets
// `isGuest` rather than the page deciding from the initial lanes alone.
export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ [K in ParamKey]?: string | string[] }>;
}) {
  const sp = await searchParams;
  // The focused stage's address (#188 slice 4). Parsed here so the first
  // render is the stage, not a bench that flips on hydration; the client
  // owns it from then on (pushState/popstate), see StudioClient. Parsed
  // before the gate so a sign-in bounce comes back to the same stage.
  const focus = parseFocus(sp);
  // The landing idea (#188 slice 2b): ?prompt=&lane=&seed=. A stage address
  // wins over it (R4): the seed is ignored, not redirected. An incomplete
  // seed (an old link, a hand-typed ?prompt=) is sent to the same idea with
  // fresh ids (R3) — the gate below already points its sign-in bounce at
  // that address, so the idea survives either path. The page never strips
  // the params afterwards: a history write there races the Generate
  // action (#311); the ids make a second fire a replay instead.
  const parsed: ParsedSeed = focus ? { kind: "none" } : parseSeed(sp);
  const seedAddress =
    parsed.kind === "complete"
      ? seedHref(parsed.seed.prompt, parsed.seed)
      : parsed.kind === "incomplete"
        ? seedHref(parsed.prompt)
        : BENCH_HREF;
  const { session, isGuest } = await requireStudioUser(
    focus ? focusHref(focus) : seedAddress
  );
  if (parsed.kind === "incomplete") redirect(seedAddress);
  after(() => sweepStudioForUser(session.user.id));
  const lanes = await getStudioLanesData(session.user.id);
  // One clock reading for the server render and the client's hydration
  // render, so the time labels match (React #418; see StudioClient). The
  // purity rule guards against a value that changes between re-renders; an
  // async server component renders once per request and never re-renders.
  // eslint-disable-next-line react-hooks/purity
  const renderedAtMs = Date.now();
  return (
    <StudioClient
      initialLanes={lanes}
      initialNowMs={renderedAtMs}
      isGuest={isGuest}
      initialFocus={focus}
      initialSeed={parsed.kind === "complete" ? parsed.seed : null}
    />
  );
}
