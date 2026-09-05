# Dashboard UI Redesign

## Purpose

Restyle the authenticated ContOS workspace to a premium editorial shell without changing authentication, scraping, chat/agents, or project data flows.

## Scraping-first behavior

Post-login and post-onboarding still land on `/dashboard/:projectId` (Overview). That page continues to show competitor scrape progress as the primary content.

While research is in progress, users stay on Overview. When research becomes ready, `DashboardPage` still auto-redirects once to `/dashboard/:projectId/agents`.

## Navigation

Sidebar contains only:

- Projects: Profiling, Analytics
- Overview
- Content Agent: Chatbot, Chat History, Calendar, Insights

Project switching lives in the header dropdown. `+ New Project` remains at the bottom of the sidebar.

## New Project from dashboard

`/projects/new` (and `/avatars/new`) reuses the onboarding project-setup screens (`ProjectTypeStep` → `ProfilingStep` → `CompetitorsStep`) with local wizard state. It does not update `user_profiles` onboarding fields or call `completeOnboarding()`. After competitors submit, the user lands on `/dashboard/:avatarId` (scraping-first Overview).

## Routes

| Path | Screen |
|------|--------|
| `/dashboard/:projectId` | Overview / scraping dashboard |
| `/dashboard/:projectId/agents` | Chatbot |
| `/dashboard/:projectId/agents?panel=history` | Chat history panel |
| `/dashboard/:projectId/profiling` | Profiling — review list when required answers complete; step wizard when incomplete |
| `/dashboard/:projectId/analytics` | Competitor progress + summaries; Add competitor |
| `/dashboard/:projectId/calendar` | Coming soon |
| `/dashboard/:projectId/insights` | Coming soon |

## Architecture

Shared chrome: `DashboardLayout`, `DashboardTopBar`, `ProjectSwitcher`, `DashboardSidebarNav`.

Competitor list + add action live on Overview via `CompetitorWorkspacePanel`. Analytics (`/dashboard/:projectId/analytics`) also exposes **Add competitor** so users can expand research after Overview auto-redirects to chat.

## Profiling tab

`/dashboard/:projectId/profiling` branches on server-owned `avatars.profiling_completeness`:

- **Incomplete (< 100%)** — step-by-step [`ProfilingStep`](../Frontend/src/components/project-setup/ProfilingStep.tsx) wizard (resumes at first unanswered required question). On finish, the page switches to review mode.
- **Complete (100%)** — scrollable all-answers review via [`ProfilingReviewPanel`](../Frontend/src/components/dashboard/ProfilingReviewPanel.tsx) inside `DashboardLayout`. Users edit any fields and click **Save changes** once; changed answers persist and trigger profile summary regeneration.

Shared input controls live in [`ProfilingQuestionField`](../Frontend/src/components/project-setup/ProfilingQuestionField.tsx). Review state: [`useProfilingReview`](../Frontend/src/hooks/useProfilingReview.ts).

## Chatbot incomplete-profiling prompt

When the active project has `profiling_completeness < 100`, [`AgentsPage`](../Frontend/src/pages/AgentsPage.tsx) shows [`IncompleteProfilingBanner`](../Frontend/src/components/dashboard/IncompleteProfilingBanner.tsx) at the top of the chat screen with progress and a **Complete profiling** link to `/dashboard/:projectId/profiling`. The banner is informational only (chat is not blocked). `AgentsPage` calls `refreshProjects()` on mount so the banner hides after the user finishes profiling and returns to chat.

## Security

All new routes remain behind `ProtectedRoute` and `RequireOnboardingComplete`. Project switcher only lists avatars returned by the signed-in user's query.
