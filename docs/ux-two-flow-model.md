# UX: the two-flow model

Shared starting point for the homepage / funnel rethink with Manine. A sketch to react to, not a spec. Phone-first.

## Two flows

- **Buy an existing design.** Browse published designs, pick size + color, check out. Open to strangers — no account to browse or buy (email is collected at checkout). Account optional after purchase.
- **Design your own.** The chat/generate loop. Requires an account.

The line: consumption and purchase are open; creation requires an account.

## Where the product is today

- The discover grid is already the storefront, but every tile routes to `/d/[imageId]`, whose only CTA ("Make one like this") forks the design into a chat thread. A buyer who wants that exact shirt has no buy path.
- Publishing auto-fires: no chance to set a name, description, or background before it goes public.
- Title/description are owner-editable after publishing (the `EditableNaming` editor on `/d/[imageId]`), but it isn't surfaced and isn't offered at publish time.

## Near-term goals (the homepage and the buy-existing flow are the same project)

1. Make the discover grid read as a shop.
2. Add a Buy path per design (design page -> size/color -> `/order`, skipping chat) alongside the existing Remix path.
3. Make "design your own" a distinct, obvious entry.

## Open decisions

- Guest checkout, or require an account at the order step?
- On a design page: Buy primary, Remix secondary?
- Is the background behind a published (transparent) image the publisher's choice?
- How prominent is "design your own" vs. the shop on the homepage?

## Publishing UX (near-term — issue #16)

Replace auto-publish with a publish step where the owner sets title + description (surface the existing editor) and picks the background color shown behind the image. Editable afterward.

## Parked (not now)

- In-product marketing + social proof — issue #17.
- Full marketplace (buy + royalties + `/marketplace`) — issue #6.
