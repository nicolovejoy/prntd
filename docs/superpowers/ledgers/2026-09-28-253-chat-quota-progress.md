# #253 chat quota — progress ledger (2026-09-28)

Plan: `docs/superpowers/plans/2026-09-28-253-chat-quota.md`. Branch
`claude/253-chat-quota` from main `5322cfb`.

## Rulings

- Ruling: the chat cap is enforced whether or not `GUEST_FUNNEL_ENABLED` is on — the generation cap is a no-op with the flag off because it guards the ungated funnel, but the Anthropic cost of a chat turn exists for any session — cost if wrong: with the flag off, signed-in users are capped at 150 chat turns a day instead of unlimited.
- Ruling: the IP dimension applies to guest turns only; signed-in turns bump and check only `chat:user:<id>` — the owner set the signed-in cap (150) above the IP cap (60), so counting signed-in turns against the IP cap would make 150 unreachable; the IP cap's stated purpose in `generation-quota.ts` is to backstop many guest sessions on one network — cost if wrong: a script with many real accounts on one IP gets 150 turns per account instead of 60 per IP.
- Ruling: the identity bucket is checked first and the IP bucket is not bumped when the identity is already over its cap — otherwise one guest's refused turns use up the IP allowance of every other guest on the network; refused turns cost no API money either way — cost if wrong: none found; the concurrency guarantee still holds because each dimension is still a single atomic upsert.
- Ruling: a turn whose Anthropic call throws refunds its unit (identity, plus IP for a guest), best-effort, on the day it was spent — mirrors the generation refund; a failing upstream should not eat a user's allowance — cost if wrong: a caller who can make the Anthropic call fail on purpose gets unlimited failed calls, which bill nothing.
- Ruling: order inside `sendChatMessage` is session → owned-design check → closed check → quota → create design row → Anthropic → persist — a refused turn on a new id leaves no design row (#197's rule for generate), and a foreign or closed conversation burns no unit — cost if wrong: none; `getOrCreateDesign`'s find-then-insert race is unchanged.
- Ruling: `src/lib/db/schema.ts`'s doc comment on `generation_usage` (lists only `user:`/`ip:`) is left as is — schema.ts is outside the fence and wave 1 must not touch it while #249 is open; the bucket formats are documented in `generation-quota.ts` — cost if wrong: a stale comment until someone edits schema.ts.
- Ruling: refusal copy — guest: "Daily chat limit reached. Sign in to continue."; signed-in: "Daily chat limit reached. Try again tomorrow." — persona C, facts only; signing in lifts a guest's identity and IP caps under the rulings above — cost if wrong: a copy edit.

## Audit of `generation_usage` readers and writers

- Writers: `bump`/`unbump` in `src/lib/generation-quota.ts`, exact `bucket = ?`.
- `failGenerationJob` (`src/lib/generation-job.ts`) → `refundGenerationQuota` with `user:`/`ip:` from the job row; called by the lazy sweep and `/api/cron/sweep-generations`. Never touches `chat:`.
- `generateDesign` consumes/refunds generation buckets only.
- No admin view, cron, pruning job, script or `reparentUserData` entry reads the table.

## Observation, not fixed (outside the slice)

- `consumeGenerationQuota` bumps and checks the IP bucket for signed-in users too, so with defaults a signed-in user is capped at 20 generations a day per IP (`IP_GEN_DAILY_CAP`), not 50 (`USER_GEN_DAILY_CAP`). `generateDesign`'s behaviour is outside the fence.

## Tasks and reviews

### Task 1 — quota functions

- Implementer (sonnet): `consumeChatQuota`, `refundChatQuota`, caps, bucket builders; new `src/lib/__tests__/chat-quota.integration.test.ts`.
- Task review (sonnet), no blocking findings: (1) should-fix, refund-day test passed vacuously on a no-op refund; (2) should-fix, "at generation cap → chat allowed" never asserted the generation refusal and never exercised the `ip:` cap; (3) should-fix, mirror test never asserted the chat refusal; (4) minor, `refundChatQuota.day` optional though the plan made it required; (5) minor, unsupported "cheaper per call" cost claim in a comment; (6) minor, two comments read as one paragraph; (7) minor, defaults test depended on the shell env; (8) minor, IP-refused guest spends identity allowance, undocumented and untested.
- Ruling: `day` is required on `refundChatQuota` — every caller holds the spend day; an optional day invites the midnight-crossing bug — cost if wrong: none.
- Fix round (sonnet) applied 1–8. Scoped re-review (haiku) confirmed 4, 7, 8; controller checked 1, 2, 3, 5, 6 in the diff. 17 tests in the new file.

### Task 2 — `sendChatMessage`, client, env template

- Implementer (sonnet): `ChatResult` union, ruling-5 order, refund on failure, refusal copy, `handleSend` limit branch, env template lines, new `src/app/design/__tests__/chat-quota.integration.test.ts`. It passes `db` explicitly to `consumeChatQuota`/`refundChatQuota` (the module's lazy `import("./db")` loaded the unmocked DB module under two concurrent first calls in vitest; `generateDesign` passes `db` to its job helpers for the same reason).
- Task review (sonnet), no blocking findings: (1) should-fix, the refund also fired when a persistence write failed after Claude had answered and been billed; (2) should-fix, no test for a failure on the new-id path; (3) should-fix, action-level concurrency covered only the identity bucket; (4) minor, IP-refusal test did not assert no chat/design rows, and the flag-off case was untested at the action level; (5) minor, split imports from `@/lib/ai`; (6) minor, the refused user's optimistic bubble stays on screen and vanishes on reload; (7) minor, no ledger line for the client test.
- Ruling: refund only for failures before or during `chatAboutDesign` (design create, context reads, the Claude call); after Claude answers, a persistence failure propagates with no refund — the call was billed, and a refunded turn whose user row persisted would be inconsistent — cost if wrong: a user whose DB write fails loses one unit of 24/150.
- Ruling (finding 6): the limit path keeps the user's unpersisted bubble and shows the refusal as an unpersisted assistant bubble; both vanish on reload — same as the generate `limit` path today — cost if wrong: a copy/UX tweak.
- Ruling (finding 7): no client test for `handleSend`'s limit branch — `design-client.tsx` has no test harness and building one is outside the slice; the branch is four lines and the server contract it depends on is covered by the action tests — cost if wrong: a client regression on the limit branch goes uncaught until the smoke.
- Fix round (sonnet) applied 1–5. Scoped re-review (haiku) marked all resolved, no new defects. The first haiku re-review ran against a clobbered prompt (the sibling slice-3 controller writes the same scratchpad file names); it was rerun from a slice-specific path.
