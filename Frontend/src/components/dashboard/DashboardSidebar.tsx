import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Project } from '../../lib/projects'
import type { Competitor } from '../../lib/competitors'
import { MAX_COMPETITORS_PER_AVATAR } from '../../lib/competitors'
import { displayCompetitorHandle } from '../../lib/instagram-display'
import {
  MAX_AVATARS,
  avatarTypeLabel,
  deleteAvatar,
  setDefaultAvatar,
} from '../../lib/avatars'
import { PlusIcon } from '../icons/ActionIcons'

type DashboardSidebarProps = {
  projects: Project[]
  activeProject: Project | null
  competitors: Competitor[]
  selectedCompetitorId: string | null
  onSelectCompetitor: (competitorId: string) => void
  onAddCompetitor: () => void
  isAddCompetitorOpen: boolean
  onAvatarsChanged?: (avatars: Project[]) => void
  /** When set on the Agents page, replaces “Open chat” with New / Previous chat controls. */
  chatActions?: {
    onNewChat: () => void
    onToggleHistory: () => void
    historyOpen: boolean
    previousChatCount: number
  }
}

export function DashboardSidebar({
  projects,
  activeProject,
  competitors,
  selectedCompetitorId,
  onSelectCompetitor,
  onAddCompetitor,
  isAddCompetitorOpen,
  onAvatarsChanged,
  chatActions,
}: DashboardSidebarProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const atCompetitorCap = competitors.length >= MAX_COMPETITORS_PER_AVATAR
  const atAvatarCap = projects.length >= MAX_AVATARS
  const onAgentsPage =
    !!activeProject && location.pathname === `/dashboard/${activeProject.id}/agents`
  const [busyAvatarId, setBusyAvatarId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function handleSetDefault(avatarId: string) {
    setActionError(null)
    setBusyAvatarId(avatarId)
    try {
      await setDefaultAvatar(avatarId)
      const next = projects.map((project) => ({
        ...project,
        is_default: project.id === avatarId,
      }))
      onAvatarsChanged?.(next)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to set default avatar.')
    } finally {
      setBusyAvatarId(null)
    }
  }

  async function handleDelete(avatarId: string) {
    if (
      !window.confirm(
        'Delete this avatar? Profiling answers and competitors for it will be removed.',
      )
    ) {
      return
    }

    setActionError(null)
    setBusyAvatarId(avatarId)
    try {
      await deleteAvatar(avatarId)
      const next = projects.filter((project) => project.id !== avatarId)
      onAvatarsChanged?.(next)
      if (activeProject?.id === avatarId) {
        const fallback = next.find((project) => project.is_default) ?? next[0]
        navigate(fallback ? `/dashboard/${fallback.id}` : '/dashboard')
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to delete avatar.')
    } finally {
      setBusyAvatarId(null)
    }
  }

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-border-hairline bg-canvas-raised sm:w-64 lg:w-72">
      <div className="border-b border-border-hairline p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-accent-primary-deep">Avatars</p>
        <nav className="mt-3 space-y-1">
          {projects.map((project) => {
            const isActive = activeProject?.id === project.id

            return (
              <div
                key={project.id}
                className={`rounded-xl px-3 py-2 transition ${
                  isActive
                    ? 'bg-accent-primary-soft'
                    : 'hover:bg-canvas'
                }`}
              >
                <Link
                  to={`/dashboard/${project.id}`}
                  className={`block text-sm ${
                    isActive
                      ? 'font-medium text-accent-primary-deep'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span aria-hidden="true">{project.is_default ? '●' : '○'}</span>
                    <span className="truncate">{project.name}</span>
                  </span>
                  <span className="mt-0.5 block pl-5 text-xs capitalize opacity-80">
                    {avatarTypeLabel(project.type)}
                    {project.is_default ? ' · Default' : ''}
                  </span>
                </Link>
                <div className="mt-2 flex flex-wrap gap-1 pl-5">
                  {!project.is_default ? (
                    <button
                      type="button"
                      disabled={busyAvatarId === project.id}
                      onClick={() => void handleSetDefault(project.id)}
                      className="rounded-lg px-2 py-0.5 text-[11px] text-accent-primary-deep hover:bg-canvas"
                    >
                      Set default
                    </button>
                  ) : null}
                  <Link
                    to={`/dashboard/${project.id}/profiling`}
                    className="rounded-lg px-2 py-0.5 text-[11px] text-ink-muted hover:bg-canvas hover:text-ink"
                  >
                    Edit profile
                  </Link>
                  <button
                    type="button"
                    disabled={busyAvatarId === project.id}
                    onClick={() => void handleDelete(project.id)}
                    className="rounded-lg px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </nav>
        {actionError ? <p className="mt-2 text-xs text-red-600">{actionError}</p> : null}
        {atAvatarCap ? (
          <p className="mt-3 text-center text-xs text-ink-muted">
            Avatar limit reached ({MAX_AVATARS}). Upgrade to add more.
          </p>
        ) : (
          <Link
            to="/projects/new"
            className="mt-3 block rounded-xl border border-dashed border-border-hairline px-3 py-2 text-center text-xs font-medium text-accent-primary-deep hover:bg-accent-primary-soft"
          >
            + Create Avatar
          </Link>
        )}
      </div>

      {activeProject ? (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-accent-primary-deep">
              Competitors
            </p>
            <span className="text-xs text-ink-muted">
              {competitors.length}/{MAX_COMPETITORS_PER_AVATAR}
            </span>
          </div>

          {onAgentsPage && chatActions ? (
            <div className="mb-3 space-y-2">
              <button
                type="button"
                onClick={chatActions.onNewChat}
                className="contos-btn contos-btn--rect contos-btn--primary contos-btn--block"
              >
                New chat
              </button>
              <button
                type="button"
                onClick={chatActions.onToggleHistory}
                className={`contos-btn contos-btn--rect contos-btn--block ${
                  chatActions.historyOpen
                    ? 'contos-btn--selected'
                    : 'contos-btn--secondary'
                }`}
              >
                Previous chats
                {chatActions.previousChatCount > 0
                  ? ` (${chatActions.previousChatCount})`
                  : ''}
              </button>
            </div>
          ) : (
            <Link
              to={`/dashboard/${activeProject.id}/agents`}
              className="contos-btn contos-btn--rect contos-btn--secondary contos-btn--block text-accent-primary-deep"
            >
              Open chat
            </Link>
          )}

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {competitors.length === 0 ? (
              <p className="text-sm text-ink-muted">No competitors yet.</p>
            ) : (
              competitors.map((competitor) => {
                const isSelected = selectedCompetitorId === competitor.id

                return (
                  <button
                    key={competitor.id}
                    type="button"
                    onClick={() => onSelectCompetitor(competitor.id)}
                    className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                      isSelected
                        ? 'bg-accent-primary text-btn-primary-fg'
                        : 'text-ink hover:bg-accent-primary-soft'
                    }`}
                  >
                    <span className="block truncate font-medium">
                      {displayCompetitorHandle(competitor.handle_or_url, competitor.platform)}
                    </span>
                    <span
                      className={`mt-0.5 block text-xs capitalize ${
                        isSelected ? 'text-btn-primary-fg/70' : 'text-ink-muted'
                      }`}
                    >
                      {competitor.platform === 'linkedin' ? 'LinkedIn · ' : 'Instagram · '}
                      {competitor.pipeline_step === 'done'
                        ? 'Ready'
                        : competitor.pipeline_step === 'failed'
                          ? 'Failed'
                          : 'In progress'}
                    </span>
                  </button>
                )
              })
            )}
          </div>

          <div className="mt-4 border-t border-border-hairline pt-4">
            <button
              type="button"
              onClick={onAddCompetitor}
              disabled={atCompetitorCap}
              title={
                atCompetitorCap
                  ? t('onboarding.competitors.maxReached', {
                      max: MAX_COMPETITORS_PER_AVATAR,
                    })
                  : t('competitors.addCompetitor')
              }
              className="contos-btn contos-btn--rect contos-btn--primary contos-btn--block"
            >
              <PlusIcon />
              {isAddCompetitorOpen
                ? t('competitors.addingCompetitor')
                : t('competitors.addCompetitor')}
            </button>
            {atCompetitorCap ? (
              <p className="mt-2 text-center text-xs text-ink-muted">
                {t('competitors.limitReached', { max: MAX_COMPETITORS_PER_AVATAR })}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </aside>
  )
}
