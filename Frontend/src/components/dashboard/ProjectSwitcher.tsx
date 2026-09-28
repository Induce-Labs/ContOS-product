import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '../ConfirmDialog'
import {
  MAX_AVATARS,
  avatarTypeLabel,
  deleteAvatar,
  setDefaultAvatar,
} from '../../lib/avatars'
import type { Project } from '../../lib/projects'

type ProjectSwitcherProps = {
  projects: Project[]
  activeProject: Project | null
  onAvatarsChanged: (projects: Project[]) => void
  collapsed?: boolean
}

export function ProjectSwitcher({
  projects,
  activeProject,
  onAvatarsChanged,
  collapsed = false,
}: ProjectSwitcherProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [busyAvatarId, setBusyAvatarId] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const atAvatarCap = projects.length >= MAX_AVATARS

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function suffixForPath(pathname: string, currentId: string) {
    const prefix = `/dashboard/${currentId}`
    if (!pathname.startsWith(prefix)) {
      return ''
    }
    return pathname.slice(prefix.length)
  }

  function switchToProject(project: Project) {
    const suffix = activeProject ? suffixForPath(location.pathname, activeProject.id) : ''
    const nextPath = `/dashboard/${project.id}${suffix}`
    setOpen(false)
    navigate(nextPath)
  }

  async function handleSetDefault(avatarId: string) {
    setActionError(null)
    setBusyAvatarId(avatarId)
    try {
      await setDefaultAvatar(avatarId)
      onAvatarsChanged(
        projects.map((project) => ({
          ...project,
          is_default: project.id === avatarId,
        })),
      )
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t('projectSwitcher.failedSetDefault'),
      )
    } finally {
      setBusyAvatarId(null)
    }
  }

  function requestDelete(avatarId: string) {
    setActionError(null)
    setDeleteTargetId(avatarId)
    setOpen(false)
  }

  async function confirmDelete() {
    if (!deleteTargetId) {
      return
    }

    const avatarId = deleteTargetId
    setActionError(null)
    setBusyAvatarId(avatarId)
    try {
      await deleteAvatar(avatarId)
      const next = projects.filter((project) => project.id !== avatarId)
      onAvatarsChanged(next)
      setDeleteTargetId(null)
      if (activeProject?.id === avatarId) {
        const fallback = next.find((project) => project.is_default) ?? next[0]
        navigate(fallback ? `/dashboard/${fallback.id}` : '/dashboard')
      }
    } catch (error) {
      setDeleteTargetId(null)
      setOpen(true)
      setActionError(
        error instanceof Error ? error.message : t('projectSwitcher.failedDelete'),
      )
    } finally {
      setBusyAvatarId(null)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        title={t('projectSwitcher.projectPrefix', {
          name: activeProject?.name ?? t('projectSwitcher.selectProject'),
        })}
        aria-label={t('projectSwitcher.selectProject')}
        className={
          collapsed
            ? 'flex h-10 w-10 items-center justify-center rounded-xl bg-[#ebe4fe] text-sm font-semibold text-ink transition dark:border dark:border-border-hairline dark:bg-canvas-raised'
            : 'inline-flex w-full max-w-full items-center gap-2 rounded-full border border-transparent bg-[#ebe4fe] px-3.5 py-2 text-sm text-ink transition dark:border-border-hairline dark:bg-canvas-raised'
        }
      >
        {collapsed ? (
          <span aria-hidden="true">
            {(activeProject?.name?.trim()?.[0] ?? 'P').toUpperCase()}
          </span>
        ) : (
          <>
            <span className="truncate">
              {t('projectSwitcher.projectPrefix', {
                name: activeProject?.name ?? t('projectSwitcher.selectProject'),
              })}
            </span>
            <span aria-hidden="true" className="text-ink-muted">
              ▾
            </span>
          </>
        )}
      </button>

      {open ? (
        <div className="absolute left-0 z-30 mt-2 w-72 rounded-2xl border border-border-hairline bg-canvas-raised p-2 shadow-[0_18px_40px_rgba(28,27,41,0.12)]">
          {projects.length === 0 ? (
            <p className="px-3 py-4 text-sm text-ink-muted">{t('projectSwitcher.noProjectsYet')}</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {projects.map((project) => {
                const isActive = activeProject?.id === project.id

                return (
                  <li key={project.id} className="rounded-xl px-2 py-2 hover:bg-canvas">
                    <button
                      type="button"
                      onClick={() => switchToProject(project)}
                      className={`block w-full truncate text-left text-sm ${
                        isActive ? 'font-semibold text-ink' : 'text-ink-muted'
                      }`}
                    >
                      {project.name}
                      {project.is_default ? t('projectSwitcher.defaultSuffix') : ''}
                    </button>
                    <p className="text-xs text-ink-muted">{avatarTypeLabel(project.type)}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {!project.is_default ? (
                        <button
                          type="button"
                          disabled={busyAvatarId === project.id}
                          onClick={() => void handleSetDefault(project.id)}
                          className="rounded-lg px-2 py-0.5 text-[11px] text-accent-primary-deep hover:bg-accent-primary-soft"
                        >
                          {t('projectSwitcher.setDefault')}
                        </button>
                      ) : null}
                      <Link
                        to={`/dashboard/${project.id}/profiling`}
                        onClick={() => setOpen(false)}
                        className="rounded-lg px-2 py-0.5 text-[11px] text-ink-muted hover:bg-canvas hover:text-ink"
                      >
                        {t('projectSwitcher.editProfile')}
                      </Link>
                      <button
                        type="button"
                        disabled={busyAvatarId === project.id}
                        onClick={() => requestDelete(project.id)}
                        className="rounded-lg px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-50"
                      >
                        {t('projectSwitcher.delete')}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {actionError ? <p className="px-2 pt-2 text-xs text-red-600">{actionError}</p> : null}

          {atAvatarCap ? (
            <p className="px-2 pt-2 text-xs text-ink-muted">
              {t('projectSwitcher.avatarLimitReached', { max: MAX_AVATARS })}
            </p>
          ) : (
            <Link
              to="/projects/new"
              onClick={() => setOpen(false)}
              className="mt-2 block rounded-xl px-3 py-2 text-sm font-medium text-accent-primary-deep hover:bg-accent-primary-soft"
            >
              {t('projectSwitcher.newProject')}
            </Link>
          )}
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteTargetId !== null}
        title={t('projectSwitcher.deleteDialogTitle', {
          name:
            projects.find((project) => project.id === deleteTargetId)?.name ??
            t('projectSwitcher.deleteDialogFallbackName'),
        })}
        description={t('projectSwitcher.deleteDialogBody')}
        confirmLabel={t('projectSwitcher.deleteDialogConfirm')}
        confirming={deleteTargetId !== null && busyAvatarId === deleteTargetId}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (busyAvatarId !== deleteTargetId) {
            setDeleteTargetId(null)
          }
        }}
      />
    </div>
  )
}
