# #188 slice 2: retire the `/design?id=` thread view (spec draft)

Status: draft for Nico's answers. No code written. Written 2026-10-15 from a read of main at `c5cd1e8`.

## What this slice is

The Studio (`/studio`) with its focused stage (`/studio?conversation=&image=`, #305) is the make surface. `/design` is the older thread view: chat column, gallery, lightbox. It is still reachable and still does three jobs the Studio does not: it mints the guest session, it takes the landing page's seed prompt, and it is where several links send people to resume a conversation. So it cannot be a bare redirect. This draft traces every way in, lists what the thread does that the stage does not, and proposes a shape.

Two standing constraints:

- #311 / CLAUDE.md: `/design`'s mount-time `window.history.replaceState(null, "/design")` (design-client.tsx:403) is not carried over. Whatever replaces the seed flow must not strip a param with a history write that races a server action.
- The proxy sends a sessionless request to `/studio` to `/sign-in` (src/proxy.ts:26-47, `/studio` is in `ALWAYS_PROTECTED`). `/design` is in `FUNNEL_ROUTES`, open when `GUEST_FUNNEL_ENABLED`. This is the reason `/design` exists as an entry for visitors with no cookie.

## (a) Entry points

Eighteen distinct ways in (A1 to A18). "Needs" is what the Studio must do to take the entry over.

Code that links or redirects to `/design`:

- A1. Landing composer, `src/components/maker-hero.tsx:27`: `router.push("/design?prompt=<text>")`, for every visitor including signed-out ones with no cookie. Carries: the seed text. Needs: a guest session minted before the Studio gate, then one generation fired from the seed, then the param dropped.
- A2. Landing example chips, same file (`go(chip)`, line 24-28). Same as A1.
- A3. `src/app/cart/page.tsx:257`: empty-cart "Start a design" links to `/design`. Carries: nothing. Pinned by `src/app/__tests__/maker-cta-hrefs.test.tsx` (ruling W1 survives for exactly this link: a sessionless visitor has an empty cart). Needs: same as A1 without a seed.
- A4. `src/app/order/confirm/page.tsx:107` ("Order not found." screen, "Start a new design") and A5. `:313` ("Start another design"). Carries: nothing. The viewer of A5 is the order's owner and has a session; A4's viewer may not. Needs: `/studio` works for A5; A4 follows A3.
- A6. `src/app/studio/studio-client.tsx:1718`: a lane with no cells yet links to `/design?id=<designId>` (the lane title falls back when `laneStageHref` is null). Carries: conversation id. Needs: a stage state for a conversation with no result yet (a pending generation, or only chat).
- A7. `src/app/d/[imageId]/start-from-image.tsx:29`: after `startConversationFromImage`, `window.location.assign("/design?id=<new>")`. Carries: the new conversation id; its only cell is the seed image. Needs: the stage for that seed cell, which exists (`focusHref` on the seed `conversation_image` link).
- A8. `src/app/d/[imageId]/conversation-actions.tsx:44`: "Open conversation" calls `openConversation` (reopens, un-archives; `src/app/d/conversation-actions.ts:38`) then assigns `/design?id=`. Carries: conversation id. Needs: stage on that conversation's primary or newest cell; `resolveFocus` returns null for a closed conversation (src/lib/studio-focus.ts), so this works only because `openConversation` reopens first.
- A9. `src/lib/preview-redirect.ts:89, 100` (`/preview` with no conversation id, or a non-owner with no front): `/design`. Carries: nothing. Needs: `/studio` for a signed-in viewer; unchanged for others.
- A10. `src/lib/preview-redirect.ts:106`: owner, conversation with no front and no primary: `/design?id=<designId>`. Carries: conversation id. Pinned by `src/lib/__tests__/preview-redirect.integration.test.ts:137` and `e2e/preview-redirect.spec.ts:60`. Needs: same stage state as A6.

Routing and gating code that names `/design`:

- A11. `src/proxy.ts:26` and `:54`: `/design` in `FUNNEL_ROUTES`; the matcher lists `/design/:path*` (this matches `/design/x` and, in Next's matcher, `/design` itself). Sessionless: open with the guest funnel on, else sign-in with `next=` set to the path and query.
- A12. `src/lib/funnel-routes.ts:23`: `/design` hides the feedback launcher. `/studio` is already listed, so removal here is a deletion.
- A13. `src/lib/nav.ts:104`: breadcrumb `[HOME, studio]` for `/design`. Delete with the route.
- A14. `src/lib/safe-next.ts`: `safeNextPath` is path-agnostic, but its fixture `src/lib/__tests__/safe-next.test.ts:5` lists `/design?id=abc` as a safe example, and `sign-in` / `sign-up` pages carry `?next=`. Old sign-in links with `next=/design?id=…` (for example the proxy's own redirect from A11, bookmarked or emailed) will land on whatever `/design` becomes. Needs: `/design` keeps redirecting, forever, so these resolve.
- A15. `src/app/design/design-client.tsx:386-388, 498, 544, 696`: `ensureGuestSession()` (`src/lib/ensure-guest-session.ts:23`, `authClient.signIn.anonymous()` when `getSession` returns a clean null) on mount and before chat, generate and upload. This is the only place a sessionless browser gets a cookie before an action. Also used by `src/app/d/[imageId]/start-from-image.tsx:27` and `buy-panel.tsx:519`.

Tests and direct visits:

- A16. e2e: `guest-funnel.spec.ts:23,32,52,115`, `guest-claim.spec.ts:35`, `cart.spec.ts:75,141` call `page.goto("/design")` to get a guest session and a first generation; `landing.spec.ts:63,88` expect `toHaveURL(/\/design/)` and read `chat-message-user` test ids. These move with the slice.
- A17. Unit tests that pin hrefs or routes: `confirm-page.test.tsx:209`, `cart-page.test.tsx:164-169`, `maker-cta-hrefs.test.tsx:92`, `studio-client.test.tsx:513`, `proxy.test.ts:50,111,123`, `funnel-routes.test.ts:6`, `nav.test.ts:13,18,40`, `site-header.test.tsx:325`, `image-lightbox.test.tsx:333-380` (`guestPublishNext`).
- A18. Bookmarks and shared links to `/design?id=` and `/design?prompt=`. Not enumerable. Treat as permanent.

Checked and clean: no email in `src/lib/order-emails.ts` links to `/design`; no `/design` link in the site header (primary links are Studio, My Designs, Shop, src/components/site-header.tsx:134-136).

## (b) What `/design?id=` does that the Studio does not

Studio side for comparison: `src/app/studio/studio-client.tsx` (Composer, lanes, polling, `generateDesign` at :989, `cancelGeneration` at :1094, `closeConversation` at :1069, bulk `deleteConversations`) and `src/app/studio/focused-stage.tsx` (one result on its backdrop, Order, Open, New design, results strip, read-only History disclosure).

Ordered roughly by size of the gap:

1. Guest session mint. `/design` mints on mount (`design-client.tsx:386`). The Studio assumes a cookie already exists and the proxy refuses a sessionless request. Without a mint, the landing flow (A1) and the empty cart (A3) lose their first generation. Largest gap because it is a cold-start dependency, not a UI feature.
2. Ask (chat replies). `sendChatMessage` (`src/app/design/actions.ts:161`, called at `design-client.tsx:499`) lets a user talk with Claude about the design without rendering; it has its own quota (`consumeChatQuota`, #253, #260). The Studio has no Ask: History is read-only (`getConversationHistory`, `src/app/studio/actions.ts:159`) and Generate always renders. If the thread is retired, Ask has no UI and the chat quota and `chatAboutDesign` become unreachable code.
3. Reference-image upload. `uploadReferenceImage` (`actions.ts:1116`, called at `design-client.tsx:697`, file input in `chat-panel.tsx:259`). The Studio composer has no upload path. Uploaded images become `operation=upload` seeds for edits.
4. Landing seed. `?prompt=` auto-generate (`design-client.tsx:399-405`). The Studio has no prompt param.
5. Per-image Delete. `deleteDesignImage` (`actions.ts:1224`, `design-client.tsx:633`, with `deleteImageConsequence` copy). The Studio only has whole-conversation delete (`deleteConversations`, bulk) and My Designs has `deleteImages`.
6. Publish from the lightbox. `PublishModal` at `design-client.tsx:904`, `handlePublishImage` :681, behind `canPublish` (page.tsx:46). The stage links to the image detail page (Open), which has publish; so this is a reroute, not a loss.
7. Set primary. `selectImage` (`actions.ts:1171`, `design-client.tsx:755`, stage thumbnail tap, #147) and `setPrimaryImage` (`actions.ts:1307`). The Studio stage has no way to change which result is the conversation's hero. The image detail page has `setPrimaryImage` (`src/app/d/[imageId]/conversation-images.tsx:6`).
8. Close and Reopen. `closeConversation` / `reopenConversation` (`actions.ts:1274, 1284`, toggle at `design-client.tsx:725`). The Studio lane menu has Close (studio-client.tsx:1069); Reopen exists only through `openConversation` (A8) and My Designs. A closed conversation is a read-only thread on `/design` and not focusable on the Studio (`resolveFocus` null).
9. Gallery and sibling navigation. `ImageGallery`, `MobileGalleryDrawer`, `MobileGalleryStrip` (design-client.tsx:864); the stage's results strip covers it for open conversations.
10. Start from image. `startConversationFromImage` (`actions.ts:1486`, `design-client.tsx:742`). Also on the image detail page (A7); the stage has New design but not "new conversation seeded by this result".
11. Ordering the design's current image. Lightbox Order and `handleMakeProducts*` (design-client.tsx:766-784). Stage has Order (focused-stage.tsx:130). Covered.
12. Cancel. `cancelGeneration` (:621). Studio has it (studio-client.tsx:1094). Covered.
13. A conversation with no image yet (chat only, or a clarify turn). `/design` renders the chat; the stage needs an image to focus. Bench lanes with no cells exist and link back to `/design` (A6).
14. Thread cache and revalidation (`design-thread-cache.ts`, design-client.tsx:417-445). A /design-only optimisation; drops with the route.

## (c) Proposed shape

Principle: `/design` stays as a route that never renders a thread. It becomes a small server redirect, because old links (A14, A18) and the cold-start jobs (A1, A3) need it.

Redirect rules, evaluated on the server in `src/app/design/page.tsx` (keeps `maxDuration` only if a generation still starts from it; see Q1):

- `/design?id=<id>`, signed in or guest, owner of the conversation: `/studio?conversation=<id>&image=<imageId>` where `imageId` is the conversation's primary image, else its newest output (same rule as `laneStageHref`, `src/lib/studio-focus.ts`). A conversation with no image: `/studio` (the bench, where its lane shows) until Q2 is settled.
- `/design?id=<id>`, not the owner or missing: `/studio`.
- `/design?prompt=<text>`: the landing entry. Signed in or guest with a cookie: `/studio?prompt=<text>`; the Studio fires one generation and then drops the param. Sessionless: see Q1.
- `/design` with neither: `/studio` with a cookie; sessionless: Q1.
- Anything else in the query is dropped. Use `pathWithSearch` (`src/lib/redirect-path.ts`) only where a param should survive.

What moves into the Studio:

- Seed handling: `?prompt=` on `/studio`, a ref-guarded mount effect that calls the existing composer submit path, then removes the param. Per #311 the removal uses `history.pushState(null, …)`-style writes the stage already uses, or better, the server redirect removes it first (the page renders the Studio with the seed as a prop read once; the URL is then left alone). Recommended: a server-side `redirect` that strips the param after stashing nothing, with the seed passed as `initialSeed` prop on first render only. This avoids any history write racing the action. (Open design detail for the plan, not for Nico.)
- Guest mint: an opening step on the Studio client (`ensureGuestSession`) is not enough alone, because the proxy blocks the first request. Options in Q1.
- Reference upload and Ask: Q3 and Q4.

What is dropped:

- `src/app/design/design-client.tsx`, `chat-panel.tsx`, `design-stage.tsx`, `image-gallery.tsx`, `image-lightbox.tsx`, `mobile-gallery-*.tsx`, `src/lib/design-thread.ts`, `design-thread-cache.ts` and their tests, once nothing imports them. `actions.ts` stays (the Studio and `/d` import it: `generateDesign`, `cancelGeneration`, `closeConversation`, `selectImage`-family, `startConversationFromImage`). Dead exports (`getDesignThread`, `getDesignChat`, `getDesignGallery`, probably `sendChatMessage` and `uploadReferenceImage` depending on Q3 and Q4) are removed in the same slice; `server-action-exports.test.ts` pins exports and will need the matching edit.
- Nav and funnel references (A12, A13), the proxy's `/design` entries when Q1 allows.
- `GUEST_FUNNEL_ENABLED=false` path for `/design`: with the route a redirect, the flag gates only the Studio.

Link updates (A3 to A10): point at `/studio` where a session is certain (A5, A6 fallback, A7, A8, A9, A10); the pair that can be sessionless (A1, A2, A3, A4) stays on `/design` until Q1 is settled, then moves.

Order of work (each its own PR, none needs a migration):

1. Studio takes `?prompt=` and handles a conversation with no result (Q2). `/design` still serves the old thread.
2. Redirect `/design?id=` and `/design?prompt=` per the rules above; update A6 to A10 and their tests.
3. Delete the thread code, the dead exports, and the e2e rewrites in A16.

## (d) Risks

- Cold start. If the redirect for a sessionless `/design?prompt=` points at `/studio`, the proxy bounces it to sign-in and the landing page stops converting guests. This is the single risk that can silently hurt the funnel. The e2e `landing.spec.ts` covers a signed-out visitor, so it would catch it, but only if rewritten rather than deleted.
- Lost features (Ask, upload) reduce what a user can do. Ask in particular is the only free-form conversation with Claude; with it gone, `chatAboutDesign`, the chat quota buckets (`USER_CHAT_DAILY_CAP` and three siblings) and their tests are dead code.
- Closed and archived conversations. `/design?id=` renders them read-only; the Studio cannot focus them. A redirect for a closed conversation lands on a bench that does not show it. A8 only works because `openConversation` reopens first; a bookmark does not.
- Old `next=/design?id=…` values in sign-in links keep working only while the redirect exists. Keep it for good.
- The `/preview` redirect (`preview-redirect.ts`) and the order-confirm links return to `/design` today; pinned tests and the e2e `preview-redirect.spec.ts` must change in the same PR as the links.
- #311: any new `history.replaceState` for the seed param reintroduces the scroll-to-top and lost-Back problems found for the buy panel. Hence the server-side strip.
- Cancelled or in-flight generations started from `/design` when the deploy lands: the job rows are conversation-keyed and the Studio polls the same `image_generation` table, so they finish and appear on the bench. No state is lost, but a user mid-thread sees the page change.
- The `design-client.tsx` state (`userActed`, `seedFired`, cache write-back) encode fixes (#245 client job id, #127 revalidate). The Studio already ports the job-id one (`jobId: clientJobId`, studio-client.tsx:989); confirm the rest are not needed by reading the commit history before deleting.

## (e) Questions for Nico

1. How should a sessionless visitor (landing hero, empty cart, "Order not found.") get a guest session if `/design` stops rendering a page?
   Recommendation: keep `/design` as the only sessionless entry, as a thin client page that calls `ensureGuestSession()` and then `router.replace`s to `/studio` (carrying `prompt`). The proxy stays unchanged except that `/design` stays in `FUNNEL_ROUTES`. Cost if wrong: if instead `/studio` is opened to sessionless requests and mints a guest itself, the proxy and `requireStudioUser` (src/lib/require-user.ts:70) change, and the "sessionless `/studio` goes to sign-in" behaviour (ruling in #241 R2, pinned in `proxy.test.ts`) is reversed; more change, but one fewer hop for guests. Choosing the thin page costs one extra navigation on first visit.

2. What does a conversation with no result yet look like on the Studio (a chat-only thread, a clarify turn with no render, a lane whose first job failed)?
   Recommendation: redirect to the bench (`/studio`), where the lane already shows with its status; no stage for it. Cost if wrong: a user who followed a link to a chat-only conversation lands on the bench and has to find the lane; rare, since every Generate renders now (CLAUDE.md "Every Generate renders").

3. Ask (chat replies): drop it, or give it a place on the stage?
   Recommendation: drop it in this slice. Generate already renders on every submit and the History disclosure shows the past turns. Remove `sendChatMessage`, `chatAboutDesign`'s chat call site and the chat quota in a follow-up so the removal is its own PR. Cost if wrong: users lose a way to talk through an idea before spending a render; if you want it back, it is a new stage control and a new design round, not a revert.

4. Reference-image upload: keep it?
   Recommendation: keep it, move it into the Studio composer as an attach control. It feeds edits, which is core to the loop. Cost if wrong (we drop it instead): uploads become impossible from the UI; `uploadReferenceImage`, the `upload` operation and its luminance step (#307) have no caller. Cost of keeping: a composer change that needs its own slice before the redirect step 2, which delays the retirement.

5. Per-image Delete and Set primary from the stage?
   Recommendation: leave both on the image detail page (it has `setPrimaryImage`; My Designs has `deleteImages`) and add neither to the stage. Cost if wrong: a user must leave the stage to delete one result; the stage's primary is chosen by the bench's existing rule.

6. Closed and archived conversations: should `/design?id=<closed id>` reopen it, or land on the bench?
   Recommendation: land on `/studio` and let My Designs show it; do not reopen on a redirect (a GET that writes). Cost if wrong: a bookmark to a closed thread shows nothing until the user finds it in My Designs.

7. Keep `/design` redirecting indefinitely, or remove it after a grace period?
   Recommendation: keep it indefinitely; the cost is one small file and it protects every old `next=` link and A18. Cost if wrong: none beyond that file.

8. Should the empty-cart link (A3) and the order-confirm links (A4, A5) change in this slice?
   Recommendation: yes, in redirect step 2: A5 to `/studio`; A3 and A4 stay on `/design` until Q1's page exists, because they can be sessionless. Cost if wrong: a signed-out visitor from A3 lands on sign-in (reverse of ruling W1, accepted for the non-empty cart only).
