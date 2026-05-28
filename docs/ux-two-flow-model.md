# UX: the two-flow model

High-level shared starting point for the UX rethink with Manine. This is a vision sketch to react to, **not** a spec or a build plan. Phone-first throughout.

## The core idea

PRNTD has two distinct audiences arriving at the same homepage, and today they're funneled into the same path (the create-your-own loop). Split them:

**Flow A — Buy an existing design.** A stranger lands, browses published designs, finds one they like, picks size + color, and checks out. Lowest possible friction. This is the storefront. No account required to browse or buy; an email is collected at checkout (Stripe already does this). Account creation is optional and can happen after purchase.

**Flow B — Design your own.** A user opens the chat/generate loop, iterates with the AI, previews on a shirt, and orders. This requires an account — generation costs money, design threads persist to a user, and publishing/forking all assume an owner.

The dividing line: **consumption and purchase are open; creation requires an account.**

## What the product does today (the gap)

- The discover grid on the homepage already *is* the storefront for Flow A — but every tile routes to `/d/[imageId]`, whose only CTA is "Make one like this," which **forks the design into a chat thread** (Flow B). A buyer who just wants that exact shirt has no buy path; they're forced into the creation loop.
- Publishing **auto-fires**: hitting publish immediately makes the image public with AI-generated naming and a hardcoded checkerboard background. The owner gets no chance to set a name, write a description, or choose how the image is presented.
- Naming *is* owner-editable after the fact (the `EditableNaming` editor on `/d/[imageId]`), but it isn't discoverable and isn't offered at publish time.

## Near-term homepage goals

The homepage redesign (with Manine) and the "buy existing" flow are the same project. Goals:

1. Make the discover grid **read as a shop** — browsable, appealing, phone-first.
2. Give each design a **Buy path** (design page -> size/color -> `/order`, skipping chat) alongside the existing Remix path.
3. Make the **create-your-own** entry obvious and distinct from buying.
4. Embed the **ibuild4you feedback widget** (see below) so early users can report bugs/ideas inline.

## Open decisions (for Manine / us)

- Does "buy existing" allow **fully guest checkout**, or require an account at the order step? (Leaning: guest checkout with email, account optional post-purchase.)
- On a design page, is **Buy** the primary CTA and **Remix** secondary? (Leaning: yes, for strangers.)
- What does the **background behind a published (transparent) image** look like — and is it the *publisher's* choice? (Leaning: per-image publish setting; could echo shirt-color options.)
- How prominent is the **create-your-own** entry vs. the shop on the homepage?

## Publishing UX (concrete, near-term)

Replace auto-publish with a small publish step (modal) where the owner sets:
- Title + description (editor already exists; surface it here and keep it editable afterward).
- Background color shown behind the transparent PNG on the grid / `/d` / admin (new per-image setting).

## Deferred / vision (explicitly parked — not now)

- **In-product marketing.** Use the inside-shirt / second print location for PRNTD branding or something cool — marketing PRNTD within the physical product. (Issue filed; for Manine to explore.)
- **Social proof.** Show how many people have ordered a design ("you're ordering #7 of this design"), on the design page and/or in account. Overlaps the `purchaseCount` in the #6 marketplace plan.
- **Full marketplace (#6).** Buy + 10% royalty attribution + `/marketplace`. The remix half shipped early; buy-direct and royalties are still open.

## Feedback widget (ibuild4you)

ibuild4you (sister repo) exposes a feedback widget we can embed in PRNTD:
- Copy two files: `components/FeedbackWidget.tsx` + `lib/feedback/payload.ts`.
- Render `<FeedbackWidget projectId="<prntd-slug>" endpoint="https://ibuild4you.com/api/feedback" />`.
- Or POST directly to `https://ibuild4you.com/api/feedback` (CORS open). Body needs `projectId` (must match an existing `projects.slug`), `type` ("bug" | "idea" | "other"), `body` (<=5000 chars), and `_ts` set to `Date.now()` **at render time** (must be 2s-24h old — caching breaks this). Honeypot `website` must stay empty. Limit: 5 submissions/IP/hour.
- Submissions land in the ibuild4you `/admin/feedback` inbox and trigger an admin email.
- Caveat: no standalone embeddable bundle — it's a React component you copy in. (PRNTD is React, so this is fine.)

Prereq: a `projects.slug` for PRNTD must exist in ibuild4you.
