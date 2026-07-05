# ContOS — Design System & Visual Theme

> Reference doc for design/frontend work on the ContOS marketing site and product UI. Companion to `prd.md` and `todo.md`. Use this to keep every screen, component, and piece of copy consistent with the brand's point of view: **content marketing as an engineered operating system, not a guessing game.**
> 

---

## 1. Conceptual Theme

**Positioning:** ContOS (the Content Intelligence Operating System) is an autonomous, data-driven platform that orchestrates and scales organic growth. It turns raw market signals, audience metrics, and competitive data into active, platform-specific content strategies.

**Core framing:** Content marketing is not creative guesswork — it's an engineered system with inputs, processing, and outputs. Every visual and copy decision should reinforce this: precise, systematic, intelligent, in control.

**The five phases of organic growth** (the spine of the product narrative — use consistently across marketing site sections, product onboarding, and dashboard information architecture):

| # | Phase | What it means |
| --- | --- | --- |
| 1 | **Understand Your Competitors** | Real-time competitor tracking and intelligence audits |
| 2 | **Discover Content Opportunities** | Spotting high-impact niche keyword gaps and content demand before anyone else |
| 3 | **Build Platform-Specific Strategies** | Adapting one core idea into native viral formats per platform (LinkedIn carousels, X/Twitter threads, YouTube scripts, Instagram bento slides) |
| 4 | **Generate Creative Assets** | Auto-generating visual carousels, layouts, and copy blueprints |
| 5 | **Stay Ahead of the Market** | Predictive analytics forecasting growth curves and recommending proactive counter-campaigns |

These five phases are a **real sequence** — each depends on the last — so numbered markers (01–05) are appropriate here, unlike in generic marketing sites where numbering is decorative. Use this sequence as a structural device: a horizontal stepper, a scroll-triggered narrative, or a sidebar nav in-product.

**Voice:** Confident, systems-literate, precise. Speak like an operator, not a hype machine. Prefer "orchestrate," "engineer," "signal," "system" over "supercharge," "unlock," "revolutionize." Name things by what the user controls (e.g., "Track a competitor," "Generate a carousel") rather than how the system works internally.

---

## 2. Color System

**Palette identity:** Aesthetic purples & slate — premium, tech-forward, calm. A soft off-white canvas, not stark white; deep slate for headings, not pure black; one signature royal purple/lavender accent; emerald green reserved strictly as a functional signal.

| Token | Hex (approx.) | Usage |
| --- | --- | --- |
| `--canvas` | `#FAF9F7` | Page background — soft off-white, never pure white |
| `--canvas-raised` | `#FFFFFF` | Card/module surfaces sitting above canvas |
| `--ink` | `#1C1B29` | Primary heading text — deep slate, near-black with a cool/purple undertone |
| `--ink-muted` | `#5B5868` | Body copy, secondary text |
| `--accent-primary` | `#744FB9` | Signature royal purple/lavender — primary brand accent, CTAs, active states, key highlights |
| `--accent-primary-soft` | `#EDE7F9` | Lavender tint — backgrounds for badges, hover states, subtle fills |
| `--accent-primary-deep` | `#4E3380` | Darker purple — pressed states, gradient endpoints |
| `--signal-positive` | `#1FA97E` | Emerald green — **functional only**: high match scores, positive growth deltas, "on track" states |
| `--signal-positive-soft` | `#E4F7EF` | Emerald tint — background for positive-signal badges/pills |
| `--border-hairline` | `#E7E4DE` | Subtle dividers and card borders on the off-white canvas |

**Rules of use:**

- Purple is the brand's expressive color — reserve it for the things that matter (primary actions, active nav state, the signature visual element). Don't let it become ambient decoration everywhere.
- Emerald green is **never decorative**. It only appears when reporting an actual positive metric (match score, growth %, "ahead of schedule" flags). This keeps it meaningful — if it shows up, it means something good just happened.
- Never introduce a second accent hue without updating this doc — the palette's restraint is the point.
- Maintain WCAG AA contrast for `-ink` on `-canvas` and for white text on `-accent-primary`.

---

## 3. Typography

- **Display face:** A characterful, geometric-but-warm sans (or a refined grotesk) for headlines — used with restraint, large sizes only, tight tracking. This carries the "engineered system" personality; avoid anything that reads as a generic SaaS default (no default Inter-at-64px headlines).
- **Body face:** A clean, highly legible sans for paragraph copy and UI text — should recede and let the display face do the personality work.
- **Utility/mono face:** A monospace or semi-mono face for data readouts, metrics, timestamps, and dashboard mockup labels — reinforces the "operating system" feel wherever real numbers appear (engagement metrics, growth %, scrape timestamps).
- **Type scale:** Define a clear scale with intentional jumps (not evenly-spaced defaults) — hero headlines should feel dramatically larger than section headers, which should be dramatically larger than body text. Use weight and letter-spacing changes deliberately, not just size.

---

## 4. Layout & Geometry

- **Bento-grid modules:** The primary layout pattern for feature sections and dashboard views — asymmetric grids of cards at varying sizes, each surfacing one distinct capability or metric. Avoid uniform 3-column grids; let card size communicate importance.
- **Container geometry:** Large, soft container radii — `rounded-[2.5rem]` for standard cards/modules, `rounded-[52px]` for hero-level containers and feature showcases. This oversized rounding is a signature trait — don't mix in sharp-cornered cards elsewhere, it will read as inconsistent.
- **Negative space:** Generous padding and breathing room around modules. The premium feel comes from restraint — resist the urge to fill every bento cell.
- **Borders:** Clean, deliberate container borders (hairline or soft-shadow, per `-border-hairline`) that define each module clearly against the off-white canvas without heavy drop shadows.

---

## 5. Glassmorphism, Illusion & Motion

- **Glassmorphic elements:** Used sparingly on key visual assets — dashboard mockup panels, floating metric cards, overlay tooltips. Subtle blur + translucency + soft border, not heavy frosted-glass overload.
- **Layered card illusion:** Stacked/offset card compositions (a card peeking from behind another) to imply depth and an active system with more happening underneath than what's on top.
- **Simulated dashboard mockups:** High-fidelity, realistic product mockups (not abstract illustrations) showing the actual ContOS UI — these are the site's proof of substance, not decoration.
- **Framer Motion animation:**
    - Dashboard mockups **slide in** with elegant, orchestrated entrance animations — treat this as one deliberate page-load or scroll-triggered moment, not scattered micro-animations everywhere.
    - **Interactive showcase behavior:** as the user toggles between the five growth-phase playbooks (or platform formats — LinkedIn, X, YouTube, Instagram), the dashboard mockup on-screen updates seamlessly, giving the impression of interacting with live software rather than watching a static image swap.
    - Favor a small number of well-orchestrated motion moments over many small hover effects — restraint keeps it feeling premium rather than AI-generated-default.
    - Respect `prefers-reduced-motion`.

---

## 6. Signature Element

The **interactive dashboard showcase** — a live-feeling product mockup that updates in place as the user toggles through the five growth phases or platform formats — is the single most memorable element on the page and should get the most design attention and polish. Everything else on the page (typography, bento cards, color) should stay disciplined and quiet so this element reads as the payoff.

---

## 7. Component Patterns

- **Bento feature cards:** Icon or mini-mockup + short label + one-line description. Use `-accent-primary-soft` fills sparingly for the "active" or "featured" card in a set.
- **Metric/signal pills:** Small rounded badges showing a stat (e.g., "+34% reach," "92% match") — use `-signal-positive` / `-signal-positive-soft` only when the number is genuinely positive; otherwise use neutral `-ink-muted` styling.
- **Platform-format tabs/toggles:** Used to switch the dashboard mockup between LinkedIn / X / YouTube / Instagram views — should feel like switching a real app's view, not a marketing carousel.
- **Step indicators:** For the five-phase growth sequence — numbered, since order is real and meaningful here.

---

## 8. Copy & Content Guidelines

- Write from the operator's side of the screen: name actions by what the user controls ("Track a competitor," "Generate this week's carousel"), not system internals ("run scrape job").
- Be specific over clever. "See what's working on your competitors' Reels this month" beats "Unlock content superpowers."
- Active voice, consistent vocabulary through a flow — if a button says "Generate," the resulting toast says "Generated," not "Success."
- Empty and loading states (e.g., the dashboard progress card from `prd.md` Section 4.7) should use plain, system-voice copy: "Researching your competitors...", "Analyzing top content..." — informative, not cutesy.
- Errors state what happened and how to fix it, without apologizing or being vague.

---

## 9. What to Avoid

- Pure white backgrounds or pure black text — always use the off-white canvas / deep slate ink pairing.
- Overusing the purple accent as ambient decoration — it should feel intentional every time it appears.
- Emerald green on anything that isn't a genuine positive signal.
- Sharp, zero-radius containers mixed in with the signature large-radius modules.
- Generic 3-equal-column feature grids — use bento asymmetry instead.
- Scattered micro-animations on every element — orchestrate one strong motion moment (the dashboard showcase) rather than many small ones.
- Hype-driven copy ("revolutionize," "supercharge," "unlock") — stay in the precise, systems-literate voice.

---

## 10. Product Dashboard Layout (Sidebar + Main Content)

This is the actual in-product screen a logged-in user lands on (see `prd.md` Section 4.7 / `todo.md` Phase 5) — distinct from the marketing site. It should feel like a natural extension of the marketing site's dashboard mockups: same tokens, same radii, same restraint, but now it's the real thing, not a showcase.

### 10.1 Overall structure

```
┌───────────────┬──────────────────────────────────────────────┐
│               │  Topbar: project name · status   [Add Comp.] │
│   SIDEBAR     ├──────────────────────────────────────────────┤
│  (fixed, left)│                                                │
│               │              MAIN CONTENT (scrolls)            │
│  · Projects   │   ┌──────────────┐  ┌──────────────┐          │
│  · Competitors│   │ Progress card │  │ Progress card │  ...     │
│  · Add Comp.  │   │  competitor A │  │  competitor B │          │
│               │   └──────────────┘  └──────────────┘          │
│  [User/acct]  │   ┌────────────────────────────────────────┐  │
│               │   │      Summary card — competitor A         │  │
│               │   └────────────────────────────────────────┘  │
└───────────────┴──────────────────────────────────────────────┘
```

- **Sidebar:** fixed width (~272–288px desktop), full viewport height, `-canvas-raised` surface against the `-canvas` page background, separated by a single `-border-hairline` vertical rule — not a heavy shadow. No large border-radius here; the sidebar is structural, not a "module," so it reads as the frame the modules live inside.
- **Main content:** everything else, scrolls independently of the sidebar, sits directly on `-canvas`. This is where the bento/rounded-module language from Sections 4–5 fully applies.
- **Topbar (within main content, sticky):** current project name (editable inline), a small status pill (`-signal-positive-soft` once fully processed, neutral `-ink-muted` pill while in progress), and the primary "Add Competitor" action styled as a solid `-accent-primary` button — the one clearly "brand-colored" element in the header, everything else stays quiet.

### 10.2 Sidebar detail

- **Top:** ContOS wordmark/mark, small, top-left, sets the "operating system" tone even in-product.
- **Projects list:** each project is a simple text row, not a card — active project indicated by a left-edge `-accent-primary` bar plus `-accent-primary-soft` background tint on that row only. This is the signature "active state" pattern — reuse it anywhere else something needs an active/selected treatment (platform-format tabs, nav items).
- **Competitors sub-list** (shown once a project is selected, nested/indented under it): each competitor row shows a tiny live status dot —
    - `-ink-muted` (neutral gray) = queued
    - pulsing `-accent-primary` = actively processing (scraping/analyzing)
    - `-signal-positive` = done
    - a small warning tone (muted red/amber, not yet in the core palette — pick one and add it to Section 2 as `-signal-negative` if adopted) = failed
    - Clicking a competitor row scrolls the main content to that competitor's card.
- **"Add Competitor":** a simple `+` row at the bottom of the competitor sub-list, styled as a ghost/text button in `-accent-primary`, not a filled button — the filled button budget is spent on the topbar action. Disabled/greyed with a tooltip once the project hits 10 competitors (per `prd.md` 4.7).
- **Bottom:** account/avatar + sign-out, visually separated by a hairline, deliberately understated — this screen is about the work, not the account chrome.

### 10.3 Main content: progress cards

- Rendered as a **row of compact cards** (bento-style, `rounded-[2.5rem]`, `-canvas-raised` surface, hairline border) — one per competitor currently in `queued`/`scraping`/`analyzing`.
- Each card:
    - Competitor handle/avatar at top
    - A horizontal 3–4 step tracker (Queued → Researching → Analyzing → Done) using small filled/unfilled dots connected by a thin line; the current step's label uses the friendly copy from `prd.md` ("Researching your competitors...", "Analyzing top content...") in `-ink`, completed steps in `-ink-muted`, upcoming steps lighter still.
    - The *current* step's dot pulses gently in `-accent-primary` (this is the one place continuous, ambient motion is acceptable — it's functionally communicating "still working," not decorative flourish).
    - On failure: the step tracker halts at the failed step in a muted warning tone, with `error_message` shown as a single line of small `-ink-muted` text and a "Retry" ghost-button in `-accent-primary`.
- Once a competitor reaches `done`, its progress card **animates out** (brief fade/collapse via Framer Motion — consistent with the "orchestrated, not scattered" motion principle) and is replaced by its summary card below. Don't let both exist for the same competitor at once — it should feel like a clean handoff, not clutter.

### 10.4 Main content: summary cards

- Each completed competitor gets one **summary module**, full-width or large-bento (`rounded-[2.5rem]`), the most visually rich element in the main content area besides the sidebar's active-state pattern — but still restrained: information-dense, not decorated.
- Suggested internal layout (bento sub-grid within the card):
    - **Header row:** competitor handle/avatar, "Analyzed [N] reels · last 30 days," small mono-face timestamp of `generated_at`.
    - **Top-performing content:** a small horizontal scroll or 2–3 column list of top reels — each entry shows a metric pill (likes/views) using `-signal-positive` styling only where a metric is genuinely standout (e.g., "top 10% engagement") — otherwise neutral styling, per the palette rule that green must mean something.
    - **Hooks & patterns:** short tag/pill list in `-accent-primary-soft` fills — these are qualitative findings, so the neutral-purple tint (not green) is correct here; green is reserved for quantitative wins.
    - **Strategy summary:** a short paragraph block in the body typeface, `-ink-muted`, reads like an analyst's note rather than a marketing blurb.
    - **Aggregated metrics:** a small row of mono-face numbers (avg likes/views/shares, engagement rate) — this is the one place the utility/mono typeface from Section 3 is essential, it should look like a real data readout.

### 10.5 States

- **Empty (no competitors yet on a project):** main content shows a single centered invitation module — plain-language, action-oriented copy ("Add your first competitor to start tracking") with the same `-accent-primary` button as the topbar. No illustration needed; let the typography and whitespace carry it, consistent with the "premium restraint" direction.
- **All processing:** main content is just the row of progress cards, sidebar competitor dots mostly `-accent-primary` pulsing.
- **Mixed (some done, some processing, one failed):** this is the normal steady state — progress cards and summary cards coexist above/below each other in whatever order competitors finish; sidebar dots give the user an at-a-glance read without needing to scroll.
- **At the 10-competitor cap:** sidebar's "Add Competitor" becomes a disabled ghost element with a tooltip ("Limit reached — 10 competitors per project"); no need for a separate main-content banner, keep the messaging local to where the action lives.

### 10.6 Responsive behavior

- Below a tablet breakpoint, the sidebar collapses to a top strip or slide-over drawer (triggered by a simple icon button in the topbar) rather than disappearing — the project/competitor list is core navigation, not optional chrome.
- Progress cards stack to a single column; summary card internal bento sub-grid collapses to a single column as well, keeping the header row → top content → hooks → strategy → metrics order intact top-to-bottom.