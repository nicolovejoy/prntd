# SDD ledger — plan: docs/superpowers/plans/2026-09-05-188-paper-slice-1.md

Branch: feat/188-paper-slice-1 (worktree .claude/worktrees/188-paper-slice-1), base 25252b2 (main after #207/#208), plan restructured into Task headings at 9b85cc1.
Spec: docs/ux-design-review-2026-09.md ("Shared components audit", "Hardcoded darks", "Rollout plan" 1) + Nico's decisions (PaperB quieter, light only, rose One Mark). Reachable. Merge ruling from Nico 2026-09-06: merge on green + clean final review.

## Preflight conflict scan
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 × T2 | T1 defines tokens; T2's classes (`bg-surface-well`, `text-accent-rose`, …) need Tailwind v4 `@theme` `--color-*` aliases | Ruling: T1 MUST add the `--color-*` alias for every new token in the `@theme` block (carried in T1's dispatch). Cost if wrong: T2 classes silently no-op. |
| T1 × T3 | T1 aliases `.bg-checkerboard` to the paper well; T3 leaves the 14 call sites | consistent |
| T2 × T3 | T2 defines the Modal's ink scrim; T3 re-points lightbox/drawer/stage scrims | Ruling: T3 reuses the exact class/token T2 chose (T2's report names it; carried into T3's dispatch). |
| T2 × T3 | T2 adds the rose Generate variant; T3 wires the two Generate buttons + wordmark | consistent; T3 dispatch carries the variant name from T2's report |
| T3 × T4 | T3 sweeps Tailwind literals in tsx; `og-site-card.tsx`/`email.ts` use inline hex, owned by T4 | Ruling: T3 excludes `src/lib/og-site-card.tsx` and `src/lib/email.ts`. |
| T4 × T5 | T4 verifies OG via `next start`; T5 screenshots via `next start` | both need env; controller supplies `--env-file=/Users/nico/src/prntd/.env.local` by PATH (never printed) |
| T1 | "no component files change" vs `.bg-checkerboard` alias in globals.css | css only, consistent |
| T5 | says "no code changes" while plan header says screenshots go in the PR body | consistent: artefacts live in the workspace, `pr-body.md` is copied into the PR by the controller |
Doc line numbers are stale (files moved in #196/#199/#200/#203/#205): every dispatch says grep, don't trust `:line`.

Task 1: review (Sonnet) — ✅ tokens/aliases/doc mechanics; ❌ plan-mandated: `--text-faint` #868480 = 3.43:1 fails "every text/ground pair AA"; reviewer's grep shows ~90 call sites, dozens at `text-sm` body/status copy, so the report's "fine-print/text-xs only" rationale is false.
Ruling: raise faint to ≥ 4.5:1 on the ground (spec is binding; a "quieter" faint that fails AA is not the deal). Cost if wrong: the faint tier reads slightly less faint than the mock; token-only, reversible in one line.
Task 1: minor (deferred → carried into Task 3 dispatch): chat-panel.tsx user bubble = `bg-surface-raised` + literal `text-white` → white-on-white until the T3 sweep. Must not be missed.
Task 1: minor (deferred → carried into Task 2 dispatch): hairline `--border` #bfbdb8 is 1.73:1 on the ground; input/button borders should use ink (plan: "1px ink borders"), hairline only for dividers.
Task 1: fix round 1 dispatched.
Task 1: fix round 1/5 (1 addressed, 0 open — faint #6f6d6a 4.74:1, muted #4b4946 8.25:1; commits 42133da..a4777d9)
Task 1: complete (commits 9b85cc1..a4777d9, review clean after 1 fix round). Tokens for later tasks: ground #f8f5ef (oklch(0.97 0.008 80)), ink #141311, muted #4b4946, faint #6f6d6a, border #bfbdb8 (hairline), accent = ink / accent-fg = ground, rose #a83250, surface/surface-raised #ffffff, surface-well + .bg-checkerboard alias; every token has a --color-* alias.
Task 2: complete (commits a4777d9..dd9b38f, review clean — 0 Critical/Important). Interfaces: Button `variant="generate"` (solid rose, unwired); Modal scrim class `bg-foreground/20`; `EmptyState` {label, message, action, testId, className}. Card had zero diff (already Paper via tokens — verified).
Task 2: minor (deferred): three EmptyState sites went py-8/py-12 → py-16 (orders-list filtered-empty, both cart states) — a density change the ONE-component mandate forced; eyeball on /cart + /orders in Task 5's screenshots.
Task 2: minor (deferred): new primitive tests assert class presence only, matching the files' existing convention.
Carried into T3: chat-panel user bubble `text-white` (white-on-white now), chat-panel upload button `hover:text-white`, `shadow-lg` in site-header.tsx + feedback-launcher.tsx.
Task 3: complete (commits dd9b38f..e748d97, review clean — 0 Critical/Important). Literals 23→0; rose on exactly three sites; `#ececec` dark-shirt neutral is the one sanctioned literal; `prose-invert` removal ruled in scope (same species of dark leftover).
Task 3: minor (deferred → T5 eyeball): preview hero mockup gained `border border-border` where shadow-lg left no edge.
Task 4: implemented (98b351e), review dispatched. Note from the implementer worth a follow-up, not this branch: `/d/<id>/opengraph-image` 500s on a schema-less DB (DB error ≠ "no row"); the site-card fallback covers only the missing-row case.
Ruling: Task 5 dispatched in parallel with T4's review — T5 writes no code and commits nothing; if T4 needs a fix round it is sequenced AFTER T5's build finishes (shared `.next`). Cost if wrong: one stale screenshot set, re-shot.
Task 4: review (Sonnet) — ✅ email/metadata/icon/snapshots (every snapshot delta is chroma or the −1px CTA padding compensation); ❌ 1 Important: `og-site-card.tsx` underline strip recoloured white → ROSE, a solid rose fill outside the two sanctioned surfaces. Ruling: strip → INK (not dropped: it is the card's one structural line). Fix held until T5's build/server finishes (shared `.next`).
Task 4: minor (deferred → PR body "judgment calls"): hairline borders added to email header separator + image wells (structural, not just chroma). Redundant INK on wrapper + tagline div.
Task 5: complete (no commits; 21 screenshots + pr-body.md in the workspace). Defects: none caused by this slice; the /preview 390 sticky-bar overlap is pre-existing `position: fixed` behaviour. Gotcha recorded: a build under the CI dummy env inlines the fake NEXT_PUBLIC_R2_PUBLIC_URL into server code too — rebuild with the real public URL for any local screenshot pass.
Task 4: fix round 1 dispatched (strip → INK).
Task 4: fix round 1/5 (1 addressed — strip → INK; commits 98b351e..f35e052; PNGs re-fetched and eyeballed)
Task 4: complete (commits e748d97..f35e052, review clean after 1 fix round)
All five tasks complete. Rebasing onto origin/main (807e832; overlap: studio-client.tsx only) before the final whole-branch review.
Rebased onto 807e832 clean (7 commits replayed, studio-client.tsx auto-merged); combined tree: typecheck clean, lint 0 errors, 1577/1577 tests. Final whole-branch review dispatched (Opus).

Final review (Opus): 1 Critical, 3 Important, 10 Minor, 5 PR-body corrections. Ready "with fixes".
Critical 1: `.bg-checkerboard` (Task 1's alias) sets `border: 1px solid var(--border)` UNLAYERED (globals.css is after `@import "tailwindcss"`), so it beats every `@layer utilities` border class on the same element — five `border-accent`/`border-2` selection indicators (preview back picker, /d back picker, conversation-images aria-current, design-stage strip, studio isPrimary) are now hairlines. Verified against the built CSS byte offsets. Class-presence tests cannot see it.
Ruling: drop `border` from `.bg-checkerboard`; the four wells that relied on it (`image-gallery.tsx`, `design-stage.tsx` well, `admin/published`, `cart`) get `border border-border` at the call site; add a source-level guard test asserting the `.bg-checkerboard` rule sets no border property (jsdom cannot evaluate the Tailwind cascade; the guard names the cascade reason). Cost if wrong: a well loses its edge — cosmetic.
Important 2: `/admin` `text-blue-400` links 2.34:1 → `text-foreground underline`. Important 3: `/preview` fullscreen zoom scrim `bg-foreground/20` → opaque `bg-background`, matching image-lightbox per the #205 ruling (the plan's "ink 20% scrim" predates it). Important 4: design-system.md gap #2 (dark-only) → RESOLVED under Paper; gap #4 updated after Critical 1.
Minors folded into the wave: 7 (doc + PR body: Generate pair is ground #f8f5ef on rose = 5.96:1), 8 (stale "checkerboard"/"dark" comments in 7 sites), 9 (`favicon.ico` still the dark mark → replace with a 32px PNG rasterised from icon.svg via sharp, keep the .ico name so old browsers get the new mark), 14 (PR body OG line). PR body corrections 1-5 applied in `pr-body-final.md`.
Minors 10 (Generate outlined on /design vs rose elsewhere) and 11 (disabled primary == disabled secondary on /preview) → "Judgment calls for Nico" in the PR body, not changed. 5/6 (screenshot coverage), 12 (auth 3px gutters, pre-existing), 13 (mothballed dashboard amber) → noted in PR body only.
Final fix wave dispatched (fresh Sonnet implementer — the five task implementers each own a slice; this wave spans four).
Final fix wave: 14/14 addressed (commit 330a3bf); re-reviewer ran the guard test, recomputed 5.96:1, eyeballed the new favicon, checked every bg-checkerboard site against faf6ac9. Out-of-scope: design-system.md:399 still said "+ a 1px hairline".
Ruling: controller edited that one prose sentence directly (docs only, no code) — recorded here because controller edits skip review. Cost if wrong: a doc sentence.
Final review clean. Merge on CI green.
