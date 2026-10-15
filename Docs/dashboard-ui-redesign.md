# Dashboard UI Redesign

## Purpose

Restyle the authenticated ContOS workspace to a premium editorial shell without changing authentication, scraping, chat/agents, or project data flows.

## Fonts

- UI and headings: **Inter** only (`font-sans` / `font-serif` both resolve to Inter)
- Sidebar section labels: Inter with increased letter spacing

## Scraping-first behavior

Post-login and post-onboarding still land on `/dashboard/:projectId` (Overview). That page is the Workspace: header with **Open chat**, competitor and total-posts stat cards, a content-distribution donut, and a competitor table. Users stay on Overview when research finishes; chat is available via **Open chat** or the Chatbot sidebar item (no auto-redirect to Agents).

## Overview

- Header is one row: `dashboard.workspaceTitle`, `dashboard.workspaceSubtitle`, and **Open chat** (`/dashboard/:projectId/agents`). Fonts stay Inter (`font-sans` / `font-serif`).
- **Competitors** is the tracked count. **Total posts scraped** sums each competitor’s stored `aggregated_engagement_metrics.total_content_count`. A scraped-row count (`instagram_scraped_content`, `linkedin_scraped_content`, `twitter_scraped_content`, exact `head` count, signed-in client) is used only when that competitor has no summary row. A failed count query or an unreadable summary is an error; the card and cell show — rather than 0.
- The donut groups those summary post counts by the first non-empty `content_strategies_themes` value. Slice colors and the table’s primary-strategy pills share one palette. Theme names come from the summaries. The visible one-word strategy label is translated for non-English UI languages (`hi`, `zh`, `fr`, `es`) through the existing on-demand translator; colors, grouping, and the hover title stay on the English theme. With no themes, the card shows an empty ring and a short empty message.
- The table replaces the chip list and per-competitor progress cards. It shows handle search, `n/10 tracked`, and **Add competitor** (opens `AddCompetitorPanel` in a modal, disabled at 10). The platform field is a custom menu (Instagram, LinkedIn, X / Twitter), portaled so the dialog scroll area does not clip it. Columns: number, username, platform, posts scraped, primary strategy, status (`done` / in progress / `failed` from `pipeline_step`), `last_scraped_at`, and actions. Retry stays available for queued or failed rows. The row menu is portaled to `document.body` and opens upward when the row sits near the bottom of the viewport, so the table’s horizontal scroller does not clip it. Delete still uses `ConfirmDialog`.

## Navigation

Sidebar chrome matches the ContOS home design:

- Brand header (mark + ContOS / Fractional CMO). Light mode uses `contos-mark.png`; dark mode uses `src/assets/image.png`.
- Desktop **collapse** control (panel + chevron) switches to an **icon-only rail** (~72px); preference persists in `localStorage` (`contos_sidebar_collapsed`). Mobile keeps a full-width overlay drawer.
- Project switcher in the sidebar (initials chip when rail-collapsed). **Delete** opens the shared `ConfirmDialog` (project name, what will be removed, Delete avatar / Cancel) instead of the browser confirm. The dialog is portaled to `document.body` so the sidebar transform does not clip it.
- Primary: Chatbot, **Chat History** (sidebar dropdown of past chats — selecting one opens that session in the chatbot; each row can delete that session after confirmation; no right-panel history view), Calendar, Insights
- **PROJECTS:** Profiling, Overview
- **CONTENT AGENT:** LinkedIn, Instagram, X (opens Agents; LinkedIn/Instagram set existing agent-type session)
- Bottom **account menu**: translucent initials card on the sidebar (no divider above it). The trigger shows the name, full email, and a right chevron. The upward **profile card** has **Account** (initials avatar, name, `@handle` from email local-part, soft ContOS pill — no photo yet), **Appearance** (borderless Dark mode row), **Language** (settings-row selector), and a filled pink **Sign out** row (subtitle “See you soon!”; reuses existing `onSignOut`)

## Theme (light / dark)

- Preference stored in `localStorage` per user (`contos_theme_user:<userId>`); default **light** when missing (new users always land in light).
- `contos_theme` holds the last-applied value for FOUC on dashboard and signed-in new-project routes.
- Applied as `class="dark"` on `<html>` (FOUC script in `index.html` + `ThemeProvider`).
- **Dark follows the signed-in preference** on `/dashboard/*` and the new-project wizard (`/projects/new`, `/avatars/new`), including project type, profiling, and competitors. The same profiling questions therefore look the same on the first pass and after **Save draft** resume. Auth (`/login`, `/signup`), welcome, and `/onboarding/*` always render light. Users with no stored preference still start light.
- Choosing Dark in the account menu persists for that user across later logins on the same browser.
- Design tokens in `Frontend/src/index.css`: light defaults in `@theme`, dark overrides under `.dark` (main `#030304`, sidebar/cards `#161618`, ink white / muted `#a1a1aa`, hairline `#2d2d30`). Accent buttons use soft pastel lavender (`#D8C7F5` / dark `#BFA4F5`) with deep purple label on the fill (`btn-primary-fg`); see [button-system.md](./button-system.md).
- Light-mode **main column** (right of sidebar) uses `#FFFFFF` with `bg-right-content.png` as a full-bleed soft lavender wash behind the top bar and page content (`DashboardLayout`); sidebar stays `canvas-raised` with no background image. Dark mode main column still uses solid `canvas` (`#030304`) and hides the wash.
- Toggle lives in the sidebar account menu only (not a top-bar control): a single **Dark mode** switch (on = dark, off = light).

Top bar: mobile hamburger only. On Agents, **+ New chat** and **+ New Project** sit in the page header on the same row as the project title (right-aligned), so they share vertical alignment with the heading; agent pills stay on the row below.

## Chatbot UI

Agents chat sits flat on the page canvas (no nested raised chat card). Message bubbles keep distinct colors: user = `accent-primary-soft` (lavender / deep purple wash in dark); assistant = `canvas-raised` with hairline border.

- Empty state: ContOS mark, greeting, agent pills, suggestion **pills** (research / content / calendar — same handlers as before), shared composer — no bordered card wrapper
- Active thread: project title + agent pills above the messages; assistant rows keep the ContOS mark avatar; messages scroll on the page canvas with composer pinned below a hairline divider
- Composer: decorative mic on the left (no `+`), text field, pastel circular send (`.contos-btn--icon.contos-btn--primary`) — mentions and send behavior unchanged; mic is not wired
- Agent type pills (Chat / LinkedIn / Instagram): selected = pastel lavender + deep purple text; idle = ghost outline
- No message timestamps (messages do not store `createdAt`)
- **Research in progress** amber banner (with **View progress**) only when the project has at least one competitor and research is not finished (`status !== ready` and no competitor `pipeline_step === done`). Hidden when there are no competitors.

## New Project from dashboard

`/projects/new` (and `/avatars/new`) reuses the onboarding project-setup screens (`ProjectTypeStep` → `ProfilingStep` → `CompetitorsStep`) with local wizard state. It does not update `user_profiles` onboarding fields or call `completeOnboarding()`. After competitors submit, the user lands on `/dashboard/:avatarId` (scraping-first Overview). If the user **Save draft**s mid-profiling and later finishes via `/dashboard/:id/profiling`, competitor intake still appears when the project has zero competitors (same `CompetitorsStep` UI).

Signed-in new-project type, profiling, and competitors follow the account theme, matching dashboard resume (`/dashboard/:id/profiling`). First-time `/onboarding/*` stays light. Shared [`ProfilingQuestionField`](../Frontend/src/components/project-setup/ProfilingQuestionField.tsx) controls use theme tokens with bordered typed fields (text, URL, textarea, competitor names, “Other”) so placeholders and typed text stay visible in light and dark. **Save draft** appears beside **Next** on New Project and incomplete dashboard Profiling resume — not during first-time onboarding.

## Routes

| Path | Screen |
|------|--------|
| `/dashboard/:projectId` | Overview — workspace stats, summary distribution, competitor table |
| `/dashboard/:projectId/agents` | Chatbot |
| `/dashboard/:projectId/agents?session=:sessionId` | Opens a specific chat session (param cleared after load) |
| `/dashboard/:projectId/profiling` | Profiling — review list when required answers complete; step wizard when incomplete |
| `/dashboard/:projectId/analytics` | Redirects to Overview (legacy bookmarks) |
| `/dashboard/:projectId/calendar` | Calendar — connected accounts, month/week/day posts |
| `/dashboard/:projectId/insights` | Coming soon |

## Architecture

Shared chrome: `DashboardLayout`, `DashboardTopBar`, `ProjectSwitcher`, `DashboardSidebarNav`, `SidebarUserMenu`. Chat presentational bubble: `ChatMessageBubble`.

Competitor list and add action live on Overview in `WorkspaceOverview` (table plus the existing `AddCompetitorPanel`). The former Analytics tab is retired; `/analytics` redirects to Overview.

## Profiling tab

`/dashboard/:projectId/profiling` branches on server-owned `avatars.profiling_completeness` and whether the project already has competitors:

- **Incomplete (< 100%)** — step-by-step [`ProfilingStep`](../Frontend/src/components/project-setup/ProfilingStep.tsx) wizard (resumes at first unanswered required question). **Save draft** beside **Next** saves the current answer and returns to Overview.
- **Complete (100%) and zero competitors** — same full-screen [`CompetitorsStep`](../Frontend/src/components/project-setup/CompetitorsStep.tsx) intake as onboarding / New Project (submit enqueues scrapes and lands on Overview; Back returns to Overview). Does not call `completeOnboarding()`.
- **Complete (100%) with competitors** — scrollable all-answers review via [`ProfilingReviewPanel`](../Frontend/src/components/dashboard/ProfilingReviewPanel.tsx) inside `DashboardLayout`. The header keeps the existing title and subtitle, plus an outline **View in chatbot** link to `/dashboard/:projectId/agents`. Light mode uses a white page background; dark mode stays the dashboard canvas. Each question is its own numbered card (`01`, `02`, …) showing the existing section label, question text, and an Optional pill when the question is not required. Users edit any fields and click **Save changes** once; changed answers persist and trigger profile summary regeneration.

Shared input controls live in [`ProfilingQuestionField`](../Frontend/src/components/project-setup/ProfilingQuestionField.tsx). URL and text inputs show a small icon inside the field. Textareas show a live character count with no new length cap. Single-select options are a wrapping card grid (the option string is the label); **Other** still opens the existing free-text field. Competitor names stay separate inputs joined with ` | `. The incomplete wizard and competitor step keep their flow and use the same input chrome. Review state: [`useProfilingReview`](../Frontend/src/hooks/useProfilingReview.ts). No API or schema change.

## Chatbot incomplete-profiling prompt

When the active project has `profiling_completeness < 100`, [`AgentsPage`](../Frontend/src/pages/AgentsPage.tsx) shows [`IncompleteProfilingBanner`](../Frontend/src/components/dashboard/IncompleteProfilingBanner.tsx) at the top of the chat screen with progress and a **Complete profiling** link to `/dashboard/:projectId/profiling`. The banner is informational only (chat is not blocked). `AgentsPage` calls `refreshProjects()` on mount so the banner hides after the user finishes profiling and returns to chat.

## Security

All new routes remain behind `ProtectedRoute` and `RequireOnboardingComplete`. Project switcher only lists avatars returned by the signed-in user's query.
