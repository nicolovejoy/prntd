# Focused stage — spec (#188 slice 4, #187)

Ruled from the mock canvas https://claude.ai/artifact/2WL2YbSHEUNsgUz1PRHyp4
(boards A–G, real published artwork). Nico, 2026-10-08: board C (the image
on its backdrop colour). Nico, 2026-10-09: "I like F and G" — F is C with
the anchor chip kept, G is C at laptop width. Everything below that the
boards did not settle is Claude's ruling, marked *(ruling)*, each with what
it costs if wrong.

## What it is

A state of `/studio`: one result shown large, the composer directly under
it, the conversation's other results as a strip, the chat transcript behind
a collapsed disclosure. It replaces the Studio lightbox as what a cell tap
opens. The `/design?id=` thread page stays reachable in this slice (image
detail page "Open conversation", `/preview` fallbacks, the landing seed);
making it a redirect and deleting the thread code is slice 2, its own plan,
after this slice has been smoked.

## URL

`/studio?conversation=<designId>&image=<imageId>`. Both are needed: a seed
image is a link, so one image id can sit in two conversations. *(ruling —
cost if wrong: a param rename.)*

- The page server-renders the stage when both params name a cell in one of
  the viewer's lanes; otherwise it renders the bench and the client drops
  the params with `history.replaceState`.
- In-stage navigation (tap another result, "← Studio", a landed edit) uses
  `window.history.pushState` / `replaceState` on the client, not the Next
  router: the lanes are already in client state and a soft navigation
  would re-run the page's DB read on every tap. `popstate` re-derives the
  stage from the URL, so Back works. Every in-stage link is still a real
  `<a href>` so it can open in a new tab.
- The lane title on the bench links to the stage of the lane's primary
  cell, else its newest cell; a lane with no cells keeps its `/design?id=`
  link for this slice.

## Layout (phone, 390 wide; board C/F)

Top to bottom, 16px gutters, Paper tokens throughout:

1. A 44px mono row: `← Studio` on the left (back to the bench), `Result N
   of M` on the right. N is the cell's 1-based creation index in the
   conversation (the bench's `#N`), M the number of cells (pending excluded).
2. The image: full width, square, `border border-border`, 24px padding,
   `object-contain`. Background: the image's pinned Shop backdrop when it is
   published and not hidden (`publishedBackdrop(colorName)`), else the
   paper well (`bg-surface-well`). The #139 slice later decides the well's
   tone for unpublished artwork; nothing interim here (Nico, 2026-10-08).
3. Caption, 6px under the image, only when published: a 12px swatch of the
   backdrop and `Shown on <Colour>` in mono. Nothing when unpublished.
   *(ruling — cost: one conditional.)*
4. The composer — the bench `Composer` component unchanged (board F): label
   `New design`, placeholder `Describe the change` while anchored, the
   anchor chip `Editing · <conversation title>` with its 32px thumbnail and
   ✕, helper `Each line starts a design. Tap a result to change it.`, rose
   Generate. On the stage the anchor is the shown image. ✕ clears it: the
   next Generate starts a new conversation and the client goes to the bench
   where the new lane appears at the top (existing reveal behaviour).
5. The guest line (`GuestKeepLine`) under the composer for a guest, same
   rule as the bench.
6. A 44px action row of underlined text links: `Order` (the image detail
   page with the panel open, `buyPageHref(imageId, {order: true, from:
   "/studio"})`, the lightbox's existing link), `Open` (`/d/<imageId>`, the
   image detail page: publish, delete, start from this image all live
   there), `New design` (clears the anchor and goes to the bench with the
   composer focused). *(ruling: `Open` is added to the board's two links so
   nothing the lightbox offered is lost — cost: one link.)*
7. `Other results`: mono label, then a row of 56px thumbnails (all cells,
   creation order, the shown one outlined `border-2 border-foreground`,
   others `border border-border`, on `bg-surface-well`), scrollable
   sideways. A pending job renders as a 56px dashed cell with a pulsing
   `…`, and under the row one mono line per pending job: `Generating…
   <elapsed> · Cancel` (Cancel inert and invisible until the job id is
   known, as on the bench). *(ruling — cost: markup.)*
8. `History · N messages`: a 44px disclosure button with a top hairline,
   collapsed by default (board G; board F only omitted it for height).
   Opening it fetches the transcript once and shows it as a plain list with
   hairlines, no bubbles: label `You` or `PRNTD`, with ` · Result N` appended
   when the turn carries an image that is a cell of this conversation; then
   the text. Markdown is rendered as plain text. There is no Ask: the stage
   only generates. *(ruling — cost: a component.)*

## Laptop (board G, from `lg`)

Two columns: the image column 600px wide (image + caption), then a flexible
column holding composer, action row, other results (88px thumbnails) and the
history disclosure. Header row spans both. Below `lg`, the phone layout with
the image capped at 600px.

## Behaviour

- Cell tap on the bench opens the stage for that cell (select mode
  unchanged: a tap toggles selection). The bench lightbox and its "Edit this
  one" go away; anchoring is now "being on the stage".
- Generate on the stage with the anchor set: an edit in this conversation.
  The optimistic pending cell appears in the strip at once. The anchor is
  NOT spent by the accepted submit (the bench's #276 rule is for the bench,
  where the next idea is a new lane; on the stage the shown image stays the
  anchor). When the new result lands (the poll adds a cell to this lane that
  the stage has not seen), the stage moves to it with `replaceState` and
  the composer draft is kept. *(ruling — cost: if Nico prefers the stage to
  stay put, remove one effect.)*
- A refused or failed submit behaves as on the bench (notice in the
  composer, words given back).
- Cancel on a pending job: the bench's `cancelJob`.
- The focused lane leaving the lanes (closed from another tab, archived by
  the sweep) sends the stage back to the bench with `replaceState("/studio")`.
- Tapping the large image does nothing in this slice (no lightbox).
  *(ruling — cost: a follow-up if Nico wants a zoom.)*
- Select mode is not reachable from the stage (no ⋯ menu there).

## Data

- `StudioCell` gains `backdropColor: string | null` — the pinned
  `product.backdrop_color` when the image's `image_publication` row exists
  and is not hidden, else null.
- `StudioLane` gains `messageCount: number` — `count(*)` of `chat_message`
  for the conversation.
- New server action `getConversationHistory(designId)` in
  `src/app/studio/actions.ts`: owner-gated, returns the conversation's
  `chat_message` rows oldest first as `{ id, role, content, imageId,
  createdAt }`. Throws `Unauthorized` for a conversation the session does
  not own.

## Not in this slice

`/design?id=` as a redirect, deleting `design-client.tsx`, `chat-panel.tsx`,
`sendChatMessage` and the chat quota; the image detail page's "Open
conversation" target; closed conversations on the stage (they are not lanes);
a zoom on the stage image; the #139 well.

## Smoke (prod, after merge)

1. Signed in, open https://prntd.org/studio and tap a result in any lane.
   PASS: the page shows that image large with `Result N of M` above it and
   the composer under it; the URL carries `conversation=` and `image=`.
2. Type a change and Generate. PASS: a dashed cell appears in Other
   results at once; when it finishes the large image switches to the new
   result and `Result M of M` reads one higher.
3. Tap `History · N messages`. PASS: the prompts of this conversation are
   listed, newest last. Browser Back returns to the bench.
