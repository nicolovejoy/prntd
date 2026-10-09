# `/admin/usage` — who is using PRNTD, how much, and what they made

Date: 2026-10-08. Branch `claude/admin-usage`. No migration; reads only. Asked by Nico 2026-10-08 ("I'm seeing some new things… let's add some usage visibility").

## Context

Admin today: `/admin` (orders, financial summary), `/admin/orders/[id]`, `/admin/published` (moderation), `/admin/errors`. Nothing shows who is generating, how much, or what. All of it is in the database already: `user` (`is_anonymous`, `created_at`), `image` (`owner_id`, `operation`, `generation_cost`, `created_at`), `image_generation` (`user_id`, `status`, `operation`, `cost`, `ip`, `started_at`, `finished_at`), `design` (conversations), `chat_message` (via `design.user_id`), `image_publication`, `order` (`status`, `total_price`, `abandoned_at`), `cart_item`, `session` (`ip_address`). See `src/lib/db/schema.ts`.

Follow the existing admin pages for structure: `src/app/admin/page.tsx` + `actions.ts` for the gate (`isAdminUser()`) and data shape, `src/app/admin/errors/` as the smallest example of a sibling admin page. Admin pages print Pacific dates (see how they do it; "UTC at rest, Pacific on display" in AGENTS.md — never bucket by `toISOString().slice(0,10)` or bare `date(col)`).

## Rulings (Claude, 2026-10-08; Nico approved the page and asked Claude to pick the row fields)

- Two levels: a user list, and a per-user detail with their images. The detail shows unpublished images too (Nico, 2026-10-08: yes).
- "Last 7 days" and "today" are Pacific calendar days, computed with `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' })` in JS; the SQL filters by a UTC timestamp bound derived from the Pacific day start. Put the day math in a pure helper in `src/lib/` with unit tests.
- Spend = sum of `image_generation.cost` for finished jobs (Ideogram) — the column already holds `costFor()`'s value. Chat calls are counted, not priced (no cost column; counting is enough).
- A guest is shown as `guest · <first 8 of id>`; a signed-up user as their email. Admin's own account is listed like any other.
- Ordering: most recently active first, where "active" is the latest of last image created, last chat message, last order. Guests with no images and no messages and no orders are left out of the list entirely (they are session mints, not users). A "Show all" toggle is not needed.
- Totals row at the top: users active in the last 7 days, generations in the last 7 days, failed in the last 7 days, spend in the last 7 days, paid orders in the last 7 days.
- Pagination: the list shows the 100 most recently active; a `?limit=` query param raises it. No search in this slice.
- The page is server-rendered (no client shell: fetch in the page, like `/admin/errors`). Thumbnails use `next/image` with the R2 remote pattern already configured, lazy, 96px cells on phones, same grid primitives as `src/app/designs/library-grid.tsx` where reuse is cheap; do not import the library grid's selection machinery.
- Prompt text is shown on the detail page (first 140 chars per image, full on tap/expand) — it is what makes "what is this new thing" answerable. `design_spec_json` is not shown.

## Level 1 — the user list (`/admin/usage`)

One card per user (phone-first: a card, not a wide table). Each card:

- identity line: email or `guest · xxxxxxxx`; a mono label `GUEST` or `ACCOUNT`; first seen (Pacific date); last active (Pacific date, relative within 24 h is fine: "3 h ago")
- generations: today / 7 d / all time (count of `image_generation` rows with status finished, for that user; show as `3 · 12 · 48`), and the split `generate` vs `edit` all time
- failed or cancelled jobs, 7 d (status failed or `cancelled_at` set)
- spend to date (USD, two decimals)
- conversations (count of `design` rows), chat messages 7 d
- published (count of `image_publication` rows for images they own, `is_hidden` false), hidden count if > 0
- orders: paid orders (status not pending, not abandoned) count and revenue to date (sum `total_price` of paid orders); open cart lines if > 0
- last IP (latest `image_generation.ip`, else latest `session.ip_address`; blank if neither)

The card links to level 2.

Query shape: a handful of grouped aggregate queries (one per source table, `GROUP BY user_id`) merged in JS — not one query per user. libSQL over HTTP: no interactive transactions needed; plain selects. Keep each query simple enough that it is obviously indexed or cheap at prod size (hundreds of users, thousands of images).

## Level 2 — a user's images (`/admin/usage/[userId]`)

Header: the same card as level 1 for that user. Then their images newest first, grid of thumbnails; each cell: thumbnail (links to the image detail page `/d/<id>`, which for admin shows published images and 404s for others' private ones — so also show the direct R2 `imageUrl` link labelled `open image` for unpublished ones), Pacific date and time, operation (`generate` / `edit` / `upload`), the conversation id (short) it came from (`conversation_image` role `output`; seeds marked `seed`), published / hidden badge when applicable, and the prompt (first 140 chars, expand on tap with a `<details>` element, no client JS). 200 newest images; `?limit=` raises it.

404 for an unknown user id; the admin gate before any query.

## Nav

Add `Usage` to wherever the admin pages link to each other (look at how `/admin/published` and `/admin/errors` are reached from `/admin` and mirror it).

## Global constraints

- `isAdminUser()` gates both routes before any data read; a non-admin gets whatever the other admin pages give (match them exactly).
- `"use server"` files: async exports only. Pure helpers (day math, aggregation merge, formatting) in `src/lib/` with unit tests. `server-action-exports.test.ts` pins exports of four action files — read it before adding exports to any of them (adding a new `src/app/admin/usage/actions.ts` is fine).
- Real-DB integration tests (`createTestDb`, factories) for the aggregates: seed two users (one guest, one account) with images across today / last week / older, a failed job, a paid and an abandoned order, a published and a hidden image, chat messages; assert every number on both cards and the totals row; assert the empty-guest exclusion; assert ordering by last active.
- Copy: persona C, plain. Look: Paper, ink borders, mono uppercase labels, AA contrast, rose nowhere on these pages.
- No price string "From $" anywhere (guard test). No `/preview` literal.
- Fence: `src/app/admin/usage/**` (new), `src/app/admin/page.tsx` (nav link only) or the shared admin nav component if one exists, new `src/lib/admin-usage.ts` + tests, `src/lib/pacific-day.ts` (+ tests) if no equivalent helper exists already (grep for `America/Los_Angeles` first and reuse). Nothing else.
- Gate before reporting: `npm run lint && npm run typecheck && npm test`.

## Tasks

1. Pacific day helper (reuse or create) with unit tests; aggregation merge helper (`mergeUsageRows`) with unit tests.
2. `getUsageList` + `getUsageUser` in `src/app/admin/usage/actions.ts` with the real-DB tests above.
3. Level 1 page, then level 2 page, nav link. Render tests (jsdom) for both pages with seeded data: cards present, numbers in place, 404 for unknown id.
4. PR on `claude/admin-usage` via `gh pr create`: body with the rulings above, the queries' shape, screenshots are not needed; end with the attribution line from the session reminder. Include a four-step prod smoke in the body: open https://prntd.org/admin/usage, find your own account's card, open it, see your newest image with its prompt.
