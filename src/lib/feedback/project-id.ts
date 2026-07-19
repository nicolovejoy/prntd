// Single source for the ibuild4you project slug. Plain module (no "use
// client") so both the server root layout and client components can import it.
export const FEEDBACK_PROJECT_ID =
  process.env.NEXT_PUBLIC_FEEDBACK_PROJECT_ID ?? "prntd-mobile-flow-rethink";
