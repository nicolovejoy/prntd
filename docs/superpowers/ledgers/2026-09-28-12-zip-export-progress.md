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

## Scratch-file collision check (main session request, 2026-09-28)

The #253 controller shared this session's scratchpad and wrote output files
with the same names (`t1-*.out`, `t2-*.out`). Checked:

- Briefs (inputs): my briefs were `.md` files; #253's were `.txt`, so no
  input name collided. All eight of my briefs (`t1-impl`, `t1-review`,
  `t1-fix`, `t1-rereview`, `t2-impl`, `t2-review`, `t2-fix`,
  `zip-t2-rereview`) still hold my text and name the `12-zip-export`
  worktree; none mention `253-chat-quota` or chat code.
- Accepted reviews: each output was read right after its run, and each
  reviews only this slice and names commit ranges that exist only on this
  branch. Task 1 review (`044517d..2652d9b`): names `design-export.ts`,
  `r2.ts` `getObjectByKey`, the design-export tests. Task 1 re-review
  (`2652d9b..13c04b4`): `fail()`, `MAX_EXPORT_IMAGES`, case-insensitive
  filenames. Task 2 review (`13c04b4..4e8b125`): `export/route.ts`,
  `export-link.tsx`, `export-route.integration.test.ts`. Task 2 re-review
  (`4e8b125..60f071a`, already in a `zip-` file): `export-link.tsx`,
  `export-route-limit.test.ts`. None of the four mentions chat or quota
  files.
- Contamination found: #253 text was appended to two implementer reports
  (`t2-impl.out`, `t2-fix.out`) after my implementer's report, and
  `t2-fix.out` on disk now holds #253's report. These are implementer
  reports, not reviews, and every implementer claim was checked against the
  diff and the controller-run gate.
- Rerun: none needed.
- Since then, every file of mine lives in the scratchpad's `12/`
  subdirectory.

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

## Whole-branch review fix round (main session's Opus review, 2026-09-28)

FIX_BASE: `743772ef98409bf7e11d0c77bafe7536a1a2c9ab`. Verdict: READY AFTER
FIXES, one fix round (F1–F7), then the main session re-reviews.

The reviewer verified these as sound: authorization (no input the caller can
tamper with), the four session cases, the image set matching My Designs
"All", a client disconnect cancelling the stream, back-pressure end to end,
flat memory (162 MB peak while streaming 600 MB), and the sample archive
opening in unzip, zipinfo, ditto, Python zipfile and bsdtar.

### Controller verdicts, recorded as rulings

14. Ruling (F1, controller): export in parts of at most 100 images
   (`EXPORT_PART_MAX_IMAGES`), `/designs/export?part=N`, with a 400 MB
   running-byte guard per part (`EXPORT_PART_MAX_BYTES`) that stops adding
   images, closes the zip properly and lists the rest as not included with a
   reason — a back-pressured stream lives as long as the client's download
   takes, so the phone's bandwidth (not R2) sets the duration; one long
   archive past `maxDuration` is cut mid-entry with no central directory and
   fails the same way on every retry — cost if wrong: a large library needs
   several taps instead of one.
15. Ruling (F1, mine): parts are ordered oldest first (`created_at asc,
   rowid asc`), not newest first like the grid — the controller asked for
   "the same stable order as today"; both orders are deterministic and cover
   a static library exactly once, but oldest first also keeps parts
   1..k-1 unchanged when the user makes new designs between downloading
   parts (newest first shifts every part by one and duplicates an image
   across parts) — cost if wrong: flip one `orderBy`; the part panel says
   "oldest first". Flagged to the main session.
16. Ruling (F1): part errors are 400 (malformed, empty, repeated `part`) and
   404 (a number past the last part); `part` only selects a slice of the
   caller's own rows — cost if wrong: none found.
17. Ruling (F1): the 413 branch and `MAX_EXPORT_IMAGES` are removed — a part
   holds at most 100 entries plus the manifest and stays under 400 MB, so
   neither the 65,535-entry nor the 4 GiB limit is reachable; the writer
   keeps a free assertion that no offset or size passes 0xFFFFFFFF.
   Supersedes ruling 10.
18. Ruling (F2): the zip writer is a small stored-only writer in
   `design-export.ts` (local headers carry CRC-32 and sizes, flag bit 3
   clear; central directory; end record; table CRC-32) instead of fflate's
   streaming `Zip` (always writes data descriptors) or `yazl` (writes sizes
   up front for buffers, but adds a Node-stream bridge and back-pressure
   plumbing around entries) — each image is already fully buffered, so its
   CRC and size are known before its header; the format needed is about 100
   lines — cost if wrong: a writer bug corrupts archives; covered by
   `unzip -tq`, a local-header parser test, fflate `unzipSync` read-back in
   tests, and a sample checked with zipinfo, ditto and Python zipfile.
   fflate moves to devDependencies as the tests' independent reader.
   Supersedes ruling 2.
19. Ruling (F3): `getObjectByKey` gets a 30 s deadline
   (`R2_READ_TIMEOUT_MS`) covering the request and the body read; a timeout
   throws `TimeoutError` and the image is listed as not included, "timed
   out" — cost if wrong: an image slower than 30 s from R2 is left out of
   the zip, named in the manifest.
20. Ruling (F4): the stream uses `highWaterMark: 0`, so nothing is read from
   R2 until the response body is consumed; a HEAD (Next runs GET for it)
   costs the session check and one DB query, no R2 read.
21. Ruling (F5): in-zip modification times are the image's
   America/Los_Angeles wall time, computed from Intl parts (not the
   server's local getters), with no UTC extended-timestamp field — matches
   the Pacific date in each filename — cost if wrong: a user outside
   Pacific time sees file times in Pacific time; the manifest has the exact
   UTC instant.
22. Ruling (F6): the control keeps its 44 px touch target with negative
   vertical margins so the masthead row stays 16 px, the same as /orders
   and /shop; the multi-part list is an absolutely positioned panel.

### Corrections to earlier rulings

- Ruling 8 corrected: the ceiling is set by the client's bandwidth, not R2
  latency. With back-pressure the function runs until the client has
  downloaded the body, so 300 s covers about 750 MB at 20 Mbps and less on
  a slow phone link. Parts (ruling 14) keep each download to at most 100
  images and 400 MB.
- Ruling 11 corrected: its premise was wrong. Before F4 the stream pulled
  once at construction, so the first R2 read started before the response
  left and headers went out after it. After F4 (`highWaterMark: 0`) no read
  happens before the body is consumed. The fixed 8 s busy window stays per
  link: a `download` anchor still gives the page no signal when the download
  starts or ends, and the window only guards against an accidental double
  tap.

### Parked (controller), not built

- P1: no server-side limit on repeat exports (ruling 5 stands). The cost is
  Vercel data transfer as well as R2 reads. A Vercel Firewall rate-limit
  rule on `/designs/export` needs no code; that is production configuration
  and the owner's decision, raised by the main session.
- P2: the R2-staging fallback (build the zip into R2 under a short-lived
  key, return a link) stays written up above, not built.

### Fix commit

`ef430c4` (one `claude -p --model opus` implementer, all of F1–F7; opus
because of the hand-written zip writer). No file outside the fence. The
413 test file `export-route-limit.test.ts` is removed with the branch it
tested (ruling 17).

23. Ruling (F1 labels, as built): one part → the masthead control is the
   download link "Download all my designs". Several parts → a button with
   the same label opens a panel: header line "{total} designs in {M} files
   of up to 100, oldest first."; per part a 44 px link, line 1
   "Part {N} of {M} · {count} designs" ("1 design" when one), line 2 the
   part's Pacific date range "Jan 4, 2026 – Mar 2, 2026" (one date when the
   part is a single day); busy text "Preparing download…"; Escape or a
   second tap closes the panel. Archive names
   `prntd-designs-<date>.zip` / `prntd-designs-<date>-part-N-of-M.zip`.
   Size-limit reason: "Left out: this file reached its 400 MB size limit.
   Download this image from its page in My Designs." — cost if wrong: copy
   only.
24. Ruling: the page passes `EXPORT_PART_MAX_IMAGES` to the client control
   as a prop — importing it from `design-export.ts` in a client file would
   pull drizzle into the client bundle — cost if wrong: none.
25. Ruling: the h1 comment says "same type classes" as /orders and /shop, not
   "same class string" — /shop's h1 also carries its own `mb-8` — cost if
   wrong: none.

Next and HEAD: the docs list HEAD as supported; the installed source
(`next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js`)
sets `HEAD = GET` when no HEAD is exported. A route test issues HEAD and an
unread GET and asserts no R2 read.

### Gate after the fix (controller-run on `ef430c4` + ledger)

- `npm run lint`: 0 errors, 33 warnings (all pre-existing)
- `npm run typecheck`: clean
- `npx vitest run`: 204 files, 2435 tests, all pass
- `npm run build` (CI dummy env): passes; `/designs/export` is ƒ
- `npm run db:generate`: "No schema changes, nothing to migrate"
- Sample archive (part 2 of 3; a 6 MiB, a 1,234 B and a 99 B entry, one
  missing object), written by `createDesignExportStream` from a throwaway
  script in the scratchpad:
  - `unzip -t`: "No errors detected".
  - `zipinfo -v`: all four entries stored, "extended local header: no",
    DOS times 2026 Mar 8 01:59:58 (09:59:58Z, PST), 2026 Nov 1 01:30:00
    (09:30Z, PST after fall-back), 2026 Sep 28 12:00:00 (19:00Z, PDT).
  - `ditto -x -k`: extracts the three PNGs and manifest.json.
  - Python `zipfile`: `testzip()` None, every `flag_bits` 0,
    `compress_type` 0, sizes match.
  - The manifest names part 2 of 3 and lists the missing image with "The
    image file could not be read from storage."

## Scoped re-review fix round (main session, 2026-09-28)

FIX_BASE: `25b474942af257a38d90617f5f325ac8b1aafb94`. Verdict: all seven
findings addressed; one Important gap (G1) and five minor (G2–G6). The
re-reviewer checked the hand-written writer against APPNOTE and five readers
with byte-identical extraction, and judged oldest first the better order;
both stand.
