# Dashboard UI Redesign

## Purpose

Restyle the authenticated ContOS workspace to a premium editorial shell without changing authentication, scraping, chat/agents, or project data flows.

## Fonts

- UI and headings: **Inter** only (`font-sans` / `font-serif` both resolve to Inter)
- Sidebar section labels: Inter with increased letter spacing

## Scraping-first behavior

Post-login and post-onboarding still land on `/dashboard/:projectId` (Overview). That page shows add-competitor, the full competitor list, and scrape/profile progress as the primary content. Competitor summary cards are not shown on Overview.

Users stay on Overview when research finishes; chat is available via **Open chat** or the Chatbot sidebar item (no auto-redirect to Agents).

## Navigation

Sidebar chrome matches the ContOS home design:

- Brand header (mark + ContOS / Fractional CMO)
- Desktop **collapse** control (panel + chevron) switches to an **icon-only rail** (~72px); preference persists in `localStorage` (`contos_sidebar_collapsed`). Mobile keeps a full-width overlay drawer.
- Project switcher in the sidebar (initials chip when rail-collapsed)
- Primary: Chatbot, **Chat History** (sidebar dropdown of past chats — selecting one opens that session in the chatbot; no right-panel history view), Calendar, Insights
- **PROJECTS:** Profiling, Overview
- **CONTENT AGENT:** LinkedIn, Instagram, X (opens Agents; LinkedIn/Instagram set existing agent-type session)
- Bottom **account menu**: avatar + name trigger; upward popover with user row, **Appearance (Light / Dark)**, language selector, and sign out (reuses existing `onSignOut`)

## Theme (light / dark)

- Preference stored in `localStorage` per user (`contos_theme_user:<userId>`); default **light** when missing (new users always land in light).
- `contos_theme` holds the last-applied value for FOUC on dashboard routes only.
- Applied as `class="dark"` on `<html>` (FOUC script in `index.html` + `ThemeProvider`).
- **Dark is dashboard-only:** honored on `/dashboard/*`. Auth (`/login`, `/signup`), welcome, `/onboarding/*`, and New Project wizards (`/projects/new`, `/avatars/new`) always render light even if the stored preference is dark.
- Choosing Dark in the account menu persists for that user across later logins on the same browser.
- Design tokens in `Frontend/src/index.css`: light defaults in `@theme`, dark overrides under `.dark` (main `#0d0d0d`, sidebar/cards `#161618`, ink white / muted `#a1a1aa`, hairline `#2d2d30`, accent soft `#25164d`).
- Toggle lives in the sidebar account menu only (not a top-bar control).

Top bar: mobile hamburger only. On Agents, **+ New chat** and **+ New Project** sit in the page header on the same row as the project title (right-aligned), so they share vertical alignment with the heading; agent pills stay on the row below.

## Chatbot UI

Agents chat uses canvas-raised rounded cards on the canvas (white in light mode; charcoal in dark):

- Empty state: ContOS mark, greeting, agent pills, suggestion **pills** (research / content / calendar — same handlers as before), shared composer
- Active thread: project title + agent pills above the card; assistant rows keep the ContOS mark avatar; user bubbles use `accent-primary-soft` (lavender / deep purple wash in dark) without a user-initial avatar
- Composer: decorative mic on the left (no `+`), text field, purple circular send — mentions and send behavior unchanged; mic is not wired
- No message timestamps (messages do not store `createdAt`)
- **Research in progress** amber banner (with **View progress**) only when the project has at least one competitor and research is not finished (`status !== ready` and no competitor `pipeline_step === done`). Hidden when there are no competitors.

## New Project from dashboard

`/projects/new` (and `/avatars/new`) reuses the onboarding project-setup screens (`ProjectTypeStep` → `ProfilingStep` → `CompetitorsStep`) with local wizard state. It does not update `user_profiles` onboarding fields or call `completeOnboarding()`. After competitors submit, the user lands on `/dashboard/:avatarId` (scraping-first Overview). If the user **Save draft**s mid-profiling and later finishes via `/dashboard/:id/profiling`, competitor intake still appears when the project has zero competitors (same `CompetitorsStep` UI).

Profiling on `/projects/new` stays light (wizard routes are outside dark scope). Dashboard Profiling (`/dashboard/:id/profiling`) follows the account theme. Shared [`ProfilingQuestionField`](../Frontend/src/components/project-setup/ProfilingQuestionField.tsx) controls use theme tokens with bordered typed fields (text, URL, textarea, competitor names, “Other”) so placeholders and typed text stay visible in light and dark. **Save draft** appears beside **Next** on New Project and incomplete dashboard Profiling resume — not during first-time onboarding.

## Routes

| Path | Screen |
|------|--------|
| `/dashboard/:projectId` | Overview — add competitor, full list, scrape progress (no summaries) |
| `/dashboard/:projectId/agents` | Chatbot |
| `/dashboard/:projectId/agents?session=:sessionId` | Opens a specific chat session (param cleared after load) |
| `/dashboard/:projectId/profiling` | Profiling — review list when required answers complete; step wizard when incomplete |
| `/dashboard/:projectId/analytics` | Redirects to Overview (legacy bookmarks) |
| `/dashboard/:projectId/calendar` | Coming soon |
| `/dashboard/:projectId/insights` | Coming soon |

## Architecture

Shared chrome: `DashboardLayout`, `DashboardTopBar`, `ProjectSwitcher`, `DashboardSidebarNav`, `SidebarUserMenu`. Chat presentational bubble: `ChatMessageBubble`.

Competitor list + add action live on Overview via `CompetitorWorkspacePanel` and the full progress list. The former Analytics tab is retired; `/analytics` redirects to Overview.

## Profiling tab

`/dashboard/:projectId/profiling` branches on server-owned `avatars.profiling_completeness` and whether the project already has competitors:

- **Incomplete (< 100%)** — step-by-step [`ProfilingStep`](../Frontend/src/components/project-setup/ProfilingStep.tsx) wizard (resumes at first unanswered required question). **Save draft** beside **Next** saves the current answer and returns to Overview.
- **Complete (100%) and zero competitors** — same full-screen [`CompetitorsStep`](../Frontend/src/components/project-setup/CompetitorsStep.tsx) intake as onboarding / New Project (submit enqueues scrapes and lands on Overview; Back returns to Overview). Does not call `completeOnboarding()`.
- **Complete (100%) with competitors** — scrollable all-answers review via [`ProfilingReviewPanel`](../Frontend/src/components/dashboard/ProfilingReviewPanel.tsx) inside `DashboardLayout`. Users edit any fields and click **Save changes** once; changed answers persist and trigger profile summary regeneration.

Shared input controls live in [`ProfilingQuestionField`](../Frontend/src/components/project-setup/ProfilingQuestionField.tsx). Review state: [`useProfilingReview`](../Frontend/src/hooks/useProfilingReview.ts).

## Chatbot incomplete-profiling prompt

When the active project has `profiling_completeness < 100`, [`AgentsPage`](../Frontend/src/pages/AgentsPage.tsx) shows [`IncompleteProfilingBanner`](../Frontend/src/components/dashboard/IncompleteProfilingBanner.tsx) at the top of the chat screen with progress and a **Complete profiling** link to `/dashboard/:projectId/profiling`. The banner is informational only (chat is not blocked). `AgentsPage` calls `refreshProjects()` on mount so the banner hides after the user finishes profiling and returns to chat.

## Security

All new routes remain behind `ProtectedRoute` and `RequireOnboardingComplete`. Project switcher only lists avatars returned by the signed-in user's query.
