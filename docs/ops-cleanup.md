# Ops cleanup: bulk-deleting conversations

`scripts/delete-designs-since.ts` deletes one user's conversations created inside
a time window. It exists for cleaning up throwaway conversations after a smoke
round (#189). The logic lives in `src/lib/delete-designs-since.ts` on top of
`src/lib/delete-design.ts`, the same plan/execute core the Delete button uses,
so the script applies exactly the rules the UI does.

## What it does per conversation

- Referenced by an order (header `design_id`, an `order_item` line, or one of
  its images pinned in a line's placements) — **skipped whole**. Orders are
  financial records and never cascade; there is no partial delete.
- FK'd by an organizer `product` — skipped whole (delete the product first).
- Otherwise the conversation goes: `chat_message`, `conversation_image`,
  `placement_render`, `cart_item`, `image_generation`, then the `design` row,
  in one `db.batch`. Per image:
  - `delete` — the `image` row, its `listing` and its mirror `product` go, and
    on `--apply` its R2 object is removed afterwards (best-effort; a failed
    object delete is counted and reported, never re-raised).
  - `detach-seed` / `detach-product-pin` / `detach-cart-pin` — the image is
    referenced from another conversation, a shop product, or another design's
    cart line, so only this conversation's link goes; the image row and object
    survive.
  - `BLOCKED-by-order` — the pin that blocked the conversation.

Only designs owned by the `--user` email match (case-insensitive; Better-Auth
stores emails lowercased), with `created_at` inside `[--since, --until]`
inclusive (`--until` defaults to now). `created_at` is a whole-seconds column.

`--since` / `--until` must be ISO-8601 with an explicit zone — `Z` or a
`±HH:MM` offset, e.g. `2026-09-04T00:00:00Z` or `2026-09-03T17:00:00-07:00`.
A naive `2026-09-04T00:00:00` is rejected: JS would parse it as local time
(07:00Z on a Pacific laptop) while a bare `2026-09-04` parses as UTC, so a
window typed without a zone lands hours away from what was meant. The header
line prints the resolved UTC bounds; check them.

## Running it

Dry run by default. It prints the DB target it resolved (`dev` / `preview` /
`prod` / `memory` / `unknown`) and one line per matching conversation, with one
indented line per image saying what would happen. Read that output before
adding `--apply`.

`--apply` is gated on that target:

- `dev` or a file/in-memory DB — no flag needed.
- `prod` — also pass `--confirm-prod`.
- `preview` — also pass `--confirm-preview`.
- `unknown` — refused outright. The Turso dashboard hands out `https://` and
  `wss://` URLs that `classifyDbTarget` can't place; use the `libsql://` form
  so the guard can see what it is targeting.

Dry run against the `.env.local` (dev) DB:

```
npx tsx scripts/delete-designs-since.ts --user nlovejoy@me.com --since 2026-09-04T00:00:00Z
```

Apply on dev:

```
npx tsx scripts/delete-designs-since.ts --user nlovejoy@me.com --since 2026-09-04T00:00:00Z --apply
```

Prod is targeted with inline creds, the same shape as `db:migrate` in
CLAUDE.md's "Migration discipline" section. A prod target refuses `--apply`
unless `--confirm-prod` is also given.

Prod dry run:

```
DATABASE_URL=libsql://prntd-nicolovejoy.aws-us-west-2.turso.io DATABASE_AUTH_TOKEN=$(turso db tokens create prntd) npx tsx scripts/delete-designs-since.ts --user nlovejoy@me.com --since 2026-09-04T00:00:00Z
```

Prod apply:

```
DATABASE_URL=libsql://prntd-nicolovejoy.aws-us-west-2.turso.io DATABASE_AUTH_TOKEN=$(turso db tokens create prntd) npx tsx scripts/delete-designs-since.ts --user nlovejoy@me.com --since 2026-09-04T00:00:00Z --apply --confirm-prod
```

Add `--until <ISO-8601>` to cap the window. Preview is the same one-liner with
`prntd-preview` in the host, `turso db tokens create prntd-preview`, and
`--confirm-preview` in place of `--confirm-prod`.

Notes:

- R2 is one bucket shared by every environment, so the R2 credentials always
  come from `.env.local`; only `DATABASE_URL` / `DATABASE_AUTH_TOKEN` change.
- The DB batch runs before the R2 deletes. If an object delete fails the rows
  are already gone and the script exits 1 with the failed keys listed; the
  orphaned object is harmless and can be removed by hand.
- The script does not archive. A conversation the Delete button would archive
  (order-referenced) is reported as skipped and left exactly as it was.
