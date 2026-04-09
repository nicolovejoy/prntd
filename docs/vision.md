# PRNTD Product Vision

*April 2026*

---

## 1. Current State

### User Journey Today

```mermaid
flowchart TD
    Landing[Landing Page] -->|Start designing| Design
    Landing -->|Sign in| Auth[Sign Up / In]
    Auth --> Designs[My Designs]
    Designs -->|New or resume| Design[Chat + Generate]
    Design -->|Use Design| Preview[Product Preview]
    Preview -->|Refine| Design
    Preview -->|Order this| Order[Size / Color / Pay]
    Order -->|Checkout| Stripe[Stripe Checkout]
    Stripe -->|Success| Confirm[Confirmation]
    Stripe -->|Cancel| Order
    Confirm --> Orders[Order History]
```

### Design Record Lifecycle

```mermaid
stateDiagram-v2
    [*] --> draft : User creates design
    draft --> draft : Chat, generate, iterate
    draft --> approved : "Order this product"
    approved --> ordered : Stripe payment + Printful submit
    ordered --> archived : User archives
    archived --> [*]
```

### Order Record Lifecycle

```mermaid
stateDiagram-v2
    [*] --> pending : Checkout session created
    pending --> paid : Stripe webhook
    paid --> submitted : Printful order created
    submitted --> shipped : Printful ships
    shipped --> delivered : Tracking confirms
    submitted --> canceled : Printful cancels
    paid --> paid : Printful failed, retry later
```

### Current Design Flow (Detail)

```mermaid
sequenceDiagram
    actor User
    participant Chat as Chat Panel
    participant Claude as Claude API
    participant Ideogram as Ideogram (Replicate)
    participant R2 as Cloudflare R2

    User->>Chat: Describes design idea
    Chat->>Claude: Chat context + user message
    Claude-->>Chat: Conversational response
    User->>Chat: "generate" / "do it" / clicks Generate
    Chat->>Claude: Construct Ideogram prompt
    Claude-->>Chat: {fluxPrompt, message, referenceImage}
    Chat->>Ideogram: Generate image (prompt + optional style ref)
    Ideogram-->>Chat: Image URL
    Chat->>R2: Upload + remove background
    R2-->>Chat: Permanent URL
    Chat-->>User: Image appears in chat + gallery
    Note over User: Can iterate (refine prompt) or approve
```

### What's Missing Today

- **Iteration is clumsy**: refining a design means describing changes in chat and re-generating the entire image. No way to say "keep everything but change the text" with precision.
- **Text is unreliable**: Ideogram handles typography well but you can't fine-tune font, size, or position after generation.
- **Single placement only**: front print only. No back, sleeve, or label.
- **Design is locked after ordering**: ordered designs disappear from the editable flow.
- **Mobile is fragmented**: 4 separate pages to go from idea to order.
- **No social or sharing features**.
- **No attribution tracking** for promo codes beyond what Stripe captures.

---

## 2. Future Vision

### Improved Design Iteration

Text overlay and refinement can happen through the chat flow rather than requiring a separate canvas editor. This keeps the initial implementation simple — a visual editor may make sense later.

```mermaid
sequenceDiagram
    actor User
    participant Chat as Chat Panel
    participant Claude as Claude API
    participant Ideogram as Ideogram (Replicate)
    participant Compose as Compositor
    participant R2 as R2

    User->>Chat: "A wolf howling at the moon"
    Chat->>Claude: Construct prompt
    Claude-->>Chat: Ideogram prompt
    Chat->>Ideogram: Generate base image
    Ideogram-->>R2: Base image stored
    R2-->>User: Image #1 in gallery

    User->>Chat: "Add 'STAY WILD' underneath in bold"
    Chat->>Claude: Construct prompt (text-aware)
    Claude-->>Chat: Ideogram prompt with text spec
    Chat->>Ideogram: Re-generate with text
    Ideogram-->>R2: Image #2
    R2-->>User: Image #2 — user compares with #1

    Note over User: Future: side-by-side diff view

    User->>Chat: "Use #1 but add the text as a subtitle below"
    Chat->>Claude: Understand intent: overlay, not re-generate
    Claude-->>Compose: {base: image #1, text: "STAY WILD", position: bottom, style: bold sans}
    Compose-->>R2: Composited image #3
    R2-->>User: Image #3 — base preserved, text added

    Note over User: Compositor = server-side Sharp/Canvas,<br/>not a client-side editor
```

**How this works:**
- Claude determines whether the user's request needs a full re-generation or just a text overlay on an existing image
- A server-side compositor (Sharp or node-canvas) handles text overlay, positioning, and basic transforms
- All generated images are stored so the user can compare versions and go back
- A side-by-side comparison view in the gallery would help with iteration
- A visual editor could replace or supplement the chat-based approach later if needed

### Multi-Placement Design

```mermaid
flowchart TB
    subgraph Design["Design Workspace"]
        Chat["Chat Panel"]
        Gallery["Image Gallery"]
        Placements["Placement Selector"]
    end

    subgraph Product["Product Configuration"]
        Front["Front\n12 x 16 in"]
        Back["Back\n12 x 16 in"]
        Sleeve["Sleeve\n3 x 3 in"]
        Label["Inside Label\n2 x 1 in"]
    end

    Chat -->|generates images for| Placements
    Placements -->|active placement| Front
    Placements -->|switch to| Back
    Placements -->|switch to| Sleeve
    Placements -->|switch to| Label
    Gallery -->|assign image to| Front
    Gallery -->|assign image to| Back
```

**Data model change**: a design becomes a collection of placements, each with its own image and chat context:

```
design
  ├── placements: [
  │     { position: "front", imageUrl: "...", chatHistory: [...] },
  │     { position: "back",  imageUrl: "...", chatHistory: [...] },
  │     { position: "sleeve", imageUrl: null },
  │     { position: "label",  imageUrl: "...", generated: false }
  │   ]
  ├── currentPlacement: "front"
  └── ...existing fields
```

The chat panel operates in the context of the active placement. Switching placement = switching chat thread. Gallery shows images for all placements.

### Custom Inside Label

A special placement type with a structured template rather than free-form design:

```
┌─────────────────────────┐
│                         │
│     [ PRNTD logo ]      │
│                         │
│   Order #a1b2c3d4       │
│                         │
│   ── Made for ──        │
│   Sarah Johnson         │
│   sarah@email.com       │
│                         │
│   1 of 1                │
│                         │
└─────────────────────────┘
```

**Fields** (all optional except logo):
- PRNTD logo (always present)
- Order number
- Customer name
- Contact info (email or phone, customer's choice)
- Edition number (for limited runs: "3 of 50")

This is not AI-generated — it's a template rendered server-side with the customer's data. The user opts in during checkout ("Add personalized label — free").

**Printful support**: Printful supports inside label printing on many products. The label image is sent as an additional placement in the order API call.

### Unified Mobile Flow

```mermaid
flowchart TB
    subgraph Mobile["Mobile: Single-Page Workspace"]
        Tab1["Chat"]
        Tab2["Gallery"]
        Tab3["Product"]
        Tab4["Order"]
    end

    Tab1 -->|"swipe / tab"| Tab2
    Tab2 -->|"swipe / tab"| Tab3
    Tab3 -->|"swipe / tab"| Tab4

    Tab1 -.->|generates| Tab2
    Tab2 -.->|"Use Design"| Tab3
    Tab3 -.->|"Preview + Scale"| Tab3
    Tab4 -.->|"Checkout"| Stripe["Stripe"]
```

One option for mobile: replace the 4 separate pages with a tabbed or swipeable workspace. Each tab has its own scroll context. Design, preview, and order configuration would happen in one place. Desktop could keep the current layout since the two-column chat+gallery works at wider viewports.

---

## 3. Social & Competition Features

### Design Showcase

```mermaid
flowchart LR
    Design["My Design"] -->|"Share"| Gallery["Public Gallery"]
    Gallery -->|"Vote"| Leaderboard["Weekly Leaderboard"]
    Leaderboard -->|"Winner gets"| Prize["Discount / Feature"]
    Gallery -->|"Buy"| Order["Order someone else's design"]
```

**Concepts:**
- **Public gallery**: users opt-in to share finished designs (after ordering or explicitly)
- **Voting**: simple upvote, time-bounded (weekly/monthly)
- **Competitions**: themed challenges ("Best animal design this week"), winner gets a free shirt or featured placement
- **Buy others' designs**: any public design can be ordered by anyone. Original designer gets credit (and optionally a cut — future)

**Data implications:**
- `design.isPublic: boolean` — opt-in to gallery
- `design.shareSlug: text` — unique URL for sharing (`prntd.org/d/abc123`)
- `design.votes: integer` — vote count (or separate vote table for uniqueness)
- `design.originalDesignerId: text` — when someone orders another's design

**Privacy**: only the finished image is public, never the chat history or prompts.

### Design Sharing & Virality

```
prntd.org/d/abc123
  ├── Shows the design on a shirt mockup
  ├── "Order this design" CTA
  ├── "Create your own" CTA
  ├── Designer attribution (optional, opt-in)
  └── Social meta tags (OG image = mockup)
```

Shareable links with OG images (mockup as the preview) give designs a way to spread on social media. Each link doubles as an acquisition funnel.

---

## 4. Attribution & Ad Tracking

### Promo Code Attribution (Current)

```mermaid
flowchart LR
    Code["Promo Code\n(Stripe)"] -->|"used at checkout"| Order["Order\n.discountCode"]
    Order -->|"query"| Report["Revenue by code"]
```

Today: Stripe manages codes, webhook stores `discountCode` on orders. Query `SELECT discountCode, COUNT(*), SUM(totalPrice) FROM order GROUP BY discountCode` for basic attribution.

### Future: Campaign Tracking

```mermaid
flowchart LR
    Ad["Ad / Post\nUTM params"] -->|"lands on"| Landing["prntd.org/?utm_source=ig&utm_campaign=spring"]
    Landing -->|"stored in"| Session["Session\n.attribution"]
    Session -->|"carries to"| Design["Design\n.attributionSource"]
    Design -->|"carries to"| Order["Order\n.attributionSource"]
    Order -->|"query"| Report["CAC by channel"]

    Share["Shared Design\nprntd.org/d/abc123"] -->|"referrer tracked"| Session
    PromoCode["Promo Code"] -->|"Stripe"| Order
```

**New fields:**
- `design.attributionSource: text` — captured from UTM params or referrer at design creation time
- `order.attributionSource: text` — inherited from design, or overridden by promo code channel

**Tracking flow:**
1. User lands with UTM params → stored in cookie/session
2. When design is created, attribution source is recorded
3. When order is placed, attribution carries through
4. Admin dashboard: revenue, orders, and CAC by channel

**Promo code integration**: each promo code can be associated with a channel in the future local `promotion` table (Layer 2 from the discount code discussion). This ties Stripe promo redemptions to marketing channels.

---

## 5. Product Expansion & Custom Manufacturing

### Product Lineup Roadmap

```
Current:
  ├── Classic Tee (Bella Canvas 3001) — 13 colors
  ├── Box Tee (Cotton Heritage MC1087) — 5 colors
  └── Clear iPhone Case — 13 models

Near-term:
  ├── Women's Tee (3rd apparel)
  ├── Hoodie
  └── Poster / Art Print

Medium-term:
  ├── Canvas print
  ├── Stickers (die-cut)
  ├── Tote bag
  └── Mug

Longer-term:
  ├── Multi-placement (front + back + sleeve)
  ├── Custom inside labels
  └── All-over print
```

### Multi-Placement Order Flow

```mermaid
sequenceDiagram
    actor User
    participant Preview as Preview Page
    participant Printful as Printful API

    User->>Preview: Design front image
    User->>Preview: Design back image
    User->>Preview: Opt in to custom label
    User->>Preview: Select product, color, size
    Preview->>Preview: Generate mockup (front)
    Preview->>Preview: Generate mockup (back)
    User->>Preview: "Order this"
    Preview->>Printful: Create order with multiple files[]
    Note over Printful: files: [{placement: "front", ...},<br/>{placement: "back", ...},<br/>{placement: "label_inside", ...}]
    Printful-->>User: Order confirmed
```

Printful's API accepts multiple `files[]` entries with different `placement` values. The API-side support exists; the remaining work is the UI and data model for managing multiple images per design.

---

## 6. Phased Implementation

### Phase 1: Foundation Cleanup
- Remove quality (standard/premium) selector
- Finish discount code UI (banner, admin display)
- Design persistence (threads accessible after ordering)
- End-to-end promo code testing

### Phase 2: Iteration & Text
- Server-side compositor for text overlay (Sharp/node-canvas)
- Claude understands when to composite vs. re-generate
- Side-by-side image comparison in gallery
- Better mobile flow (tabbed workspace)

### Phase 3: Multi-Placement
- Placement selector in design workspace
- Per-placement chat context
- Multi-file Printful order submission
- Custom inside label template

### Phase 4: Social & Growth
- Public design gallery with shareable links
- Voting / competitions
- "Order someone else's design" flow
- UTM / attribution tracking
- Campaign analytics in admin

### Phase 5: Scale
- Rate limiting / generation caps
- Women's tee, hoodies, posters, stickers
- All-over print
- Edition numbering for limited runs
