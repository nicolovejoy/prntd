# #12 zip export — progress ledger (2026-09-28)

Branch `claude/12-zip-export` from `origin/main` `5322cfb`. Plan:
`docs/superpowers/plans/2026-09-28-12-zip-export.md`. No migration.
Controller: Opus. Implementers and task reviewers: `claude -p --model sonnet`
subprocesses in this worktree; scoped re-reviews `--model haiku`. The
whole-branch review is the main session's.

## Commits

- `044517d` plan
- `2652d9b` Task 1: design-export helpers, streamed stored zip, `getObjectByKey`, `fflate`
- `13c04b4` Task 1 review fixes
- `4e8b125` Task 2: `/designs/export` route handler, "Download all my designs" link
- `60f071a` Task 2 review fixes
- (this commit) ledger; unused-arg lint warning in the 413 test

## Rulings

1. Ruling: the export runs its own `image`-only query (`loadExportRows`) with
   the same owner filter and order as `getUserImageLibrary`, instead of
   calling it — `getUserImageLibrary` joins `listing` and reads `product`
   (both off-limits while #249 renames/drops them), carries none of
   operation / prompt / aspect ratio, and runs the stale-job sweep — cost if
   wrong: the two lists could drift if someone changes the library's filter;
   a real-DB test pins identical id sets and order.
2. Ruling: zip library `fflate` (0.8.3, MIT, no dependencies, streaming
   `Zip` + `ZipPassThrough` for stored entries, runs on Node and edge) —
   alternatives: `archiver` 8 (Node streams, several transitive deps,
   heavier), `client-zip` 2 (stored-only, Response-native, ESM-only, one
   maintainer, smaller user base), `yazl` 3 (writes sizes up front for
   buffers, but Node-stream output and last release 2024-11) — cost if
   wrong: fflate's streaming zip always writes data descriptors (sizes after
   the data, flag bit 3) and has no ZIP64. Central-directory readers
   (`unzip`, macOS Archive Utility, iOS Files, Windows Explorer) accept
   descriptors; a strict streaming reader (Java `ZipInputStream`) rejects a
   stored entry with a descriptor. Limit 4 GiB / 65,535 entries. If a phone
   refuses the archive, swap to `yazl` `addBuffer(…, { compress: false })`,
   which writes CRC and sizes in the local header.
3. Ruling: object key = `image.r2_key`, else `imageKeyFromUrl(image_url)`,
   read with a new `getObjectByKey` in `r2.ts` — `getImageObject` only
   knows `images/{id}.png` and would report every legacy
   `designs/{designId}/{n}.png` image as missing — cost if wrong: none
   beyond one extra helper.
4. Ruling: filename date is the image's created calendar day in
   `America/Los_Angeles` (`<YYYY-MM-DD>_<imageId>.png`); the manifest names
   the zone (`filenameDateTimeZone`) and keeps `createdAt` in UTC ISO 8601 —
   house rule "a calendar day shown to a human is Pacific" — cost if wrong: a
   buyer far from Pacific time sees a filename date one day off from their
   local day; the exact UTC instant is in the manifest.
5. Ruling: no server-side repeat-export limit. The only schema-free counter
   store is `generation_usage` (free-text bucket, unique per day), and slice
   1 (#253) is changing its readers and adding `chat:` buckets in
   `generation-quota.ts` right now; a third prefix written from outside that
   module would put a quota rule outside its owner and risk the kind of
   cross-PR semantic conflict batch 2 hit. An in-memory lock does not hold
   across serverless instances. Instead the link ignores taps for 8 s after
   the first ("Preparing download…") — cost if wrong: a scripted client can
   start exports back to back; each costs function time and R2 Class B reads
   (R2 egress is free). Open item.
6. Ruling: dropped from the issue text — `design_image` (gone since Model B
   slice 5; the export keys off `image` rows), "generation number" and
   "approval status" in filenames (no such fields in the current model; the
   filename is date + image id, the rest is in the manifest), and aspect
   ratio in the filename (it is in the manifest) — cost if wrong: filenames
   are less self-describing without the manifest.
7. Ruling: the download is a plain `<a href="/designs/export" download>`,
   not `next/link` and not fetch-to-blob — a blob would hold the whole
   archive in the phone's memory; an anchor lets the browser stream it to
   disk as a normal download — cost if wrong: the page cannot tell when the
   download actually started, hence the fixed 8 s disabled window.
8. Ruling: `maxDuration = 300` on the route — fits Hobby and Pro limits
   under fluid compute — cost if wrong: a very large library (roughly
   1,000+ images at typical R2 latency) could be cut off mid-stream; the
   browser would then report a failed download.

9. Ruling: an R2 outage mid-export produces a 200 zip whose manifest marks
   the unread images missing, not an error status — the response is
   committed before the first object is read, and the plan makes a missing
   object non-fatal — cost if wrong: during an outage a user gets a
   near-empty zip; the manifest says which images are missing and each is
   logged.
10. Ruling: more than 65,534 images → 413 before streaming — fflate has no
   ZIP64 — cost if wrong: none today (no user is near it). The 4 GiB size
   limit is not checked up front (sizes are unknown until read).

11. Ruling: the busy window on the link stays a fixed 8 s — a `download`
   anchor gives the page no signal when the download starts or ends on iOS
   Safari or Chrome, and the response headers (which start the browser's
   download) are sent right after the one DB query, before any R2 read —
   cost if wrong: a tap after 8 s starts a second full export (the missing
   server-side limit, ruling 5).
12. Ruling: the link's width may change between "Download all my designs"
   and "Preparing download…" — the busy label is shorter, the row is
   `justify-between` with a short masthead, so nothing wraps at 360 px —
   cost if wrong: a small shift of the link on tap.
13. Ruling: a stale session answers 401 plain text even though the anchor
   carries `download` — the brief requires a status, never a redirect loop —
   cost if wrong: some browsers (iOS Safari) may save the error text as a
   small file instead of showing it; only reachable when the page was loaded
   with a session that has since expired.

## Vercel 4.5 MB body cap (not solved here)

The main session verifies on a preview deployment that a streamed zip over
4.5 MB arrives whole. Fallback if it does not, not built: build the zip into
R2 under a short-lived key (`exports/{userId}/{nonce}.zip`, expired by an R2
lifecycle rule), then answer the GET with a 303 to a presigned or public URL
for it.

## Review findings

### Task 1 (sonnet review of `044517d..2652d9b`)

No blockers, no should-fix. Nits:

1. One-at-a-time ordering proven only indirectly — fixed: event-log test
   (read n+1 only after image n's chunks were consumed; a paused consumer
   triggers no second read).
2. Cancel during an in-flight read untested — fixed: deferred-read test, no
   further reads, no unhandled rejection.
3. On stream error `zip.terminate()` not called — fixed: shared `fail()`.
4. Filename uniqueness case-sensitive; case-insensitive extractors would
   overwrite — fixed: uniqueness keyed on the lowercased name, tested.
5. 65,535-entry limit documented but not enforced (fflate would write a
   corrupt archive) — fixed: `MAX_EXPORT_IMAGES = 65_534`, the stream
   throws a RangeError above it; the route answers 413 first.
6. `getObjectByKey` swallowed errors silently, so an R2 outage would yield a
   manifest-only zip with no log — fixed: one `console.error` line. Not
   fixed: answering 502 when every object is missing is impossible once the
   stream has begun (headers are sent before the first read). Ruling 9.
7. fflate encodes entry mtime with local-time getters — not fixed: Vercel
   runs in UTC and the manifest holds the exact instants.
8. `unzip -tq` needs the binary — not fixed: present on macOS and GitHub's
   ubuntu runners.

Haiku re-review of `2652d9b..13c04b4`: all six FIXED, no new defects;
20 tests pass.

### Task 2 (sonnet review of `13c04b4..4e8b125`)

No blockers.

1. should-fix: 401/403 tests proved no R2 read but not "no DB read" — fixed:
   `select` spy asserted untouched on 401/403, called on 200.
2. should-fix: label swap not announced to screen readers — fixed: hidden
   `role="status"` live region.
3. should-fix: fixed 8 s busy window can re-arm before a slow start — not
   changed, ruling 11.
4. should-fix: label width change could reflow the masthead at 375 px — not
   changed, ruling 12.
5. nit: jsdom "Not implemented: navigation" noise — fixed: a document-level
   listener records `defaultPrevented`, then prevents.
6. nit: `clearTimeout` spy brittle — not changed (the implementer found
   timer counts unreliable under fake timers with React's own timers).
7. nit: 413 branch untested — fixed: `export-route-limit.test.ts`.
8. nit: stale session + `download` attribute — not changed, ruling 13.

Haiku re-review of `4e8b125..60f071a`: all four FIXED, no new defects;
82 tests in `src/app/designs` pass.

## Gate (controller-run, head after the ledger commit)

- `npm run lint`: 0 errors (33 warnings, all pre-existing; one new warning
  in the 413 test fixed in the ledger commit)
- `npm run typecheck`: clean
- `npx vitest run`: 204 files, 2404 tests, all pass
- `npm run build` (CI dummy env): passes; `/designs/export` listed as ƒ
- `npm run db:generate`: "No schema changes, nothing to migrate"
- Local `next start` (dummy env, funnel on): `GET /designs/export` with no
  cookie → `401`, `cache-control: no-store`, body "Sign in to download your
  designs."; `GET /designs` with no cookie still 307s to
  `/sign-in?next=%2Fdesigns`.
