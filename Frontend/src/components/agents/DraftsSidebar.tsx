import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '../ConfirmDialog'
import { TrashIcon } from '../icons/ActionIcons'
import {
  CHAT_LINKEDIN_CONTENT_LIMIT,
  CHAT_X_SOFT_LIMIT,
  linkedInOverLimit,
} from '../../lib/chatDraftPrefill'
import { userFacingMessage } from '../../lib/devLog'
import {
  POSTIZ_MAX_POST_IMAGES,
  POSTIZ_MAX_X_POST_IMAGES,
  postizContentLength,
  uploadPostizMedia,
  type PostizMediaItem,
} from '../../lib/postiz'
import { MEDIA_ACCEPT, validateNewFiles, type MediaKind } from '../../lib/postizMedia'
import type { ScheduleRow } from '../../lib/draftSchedule'
import {
  browserTimeZone,
  scheduleSkipReason,
  type ReviewPost,
  type ReviewStatus,
} from '../../lib/reviewableDrafts'

export type AcceptedDraftRevision = {
  token: string
  postId: string
  text: string
  entries: string[] | null
}

type DraftsSidebarProps = {
  posts: ReviewPost[]
  avatarId: string
  busy: boolean
  scheduling: boolean
  acceptedRevision: AcceptedDraftRevision | null
  report: { succeeded: ScheduleRow[]; failed: ScheduleRow[]; skipped: ScheduleRow[]; uncertain: ScheduleRow[] } | null
  onClose: () => void
  onPatch: (post: ReviewPost) => void
  onDelete: (post: ReviewPost) => void
  onAddToChat: (post: ReviewPost) => void
  onCommit: (post: ReviewPost, localDateTime: string, mode: 'draft' | 'schedule') => void
}

type LocalDraft = { text: string; entries: string[] | null }

/** One editor box. A thread keeps a tweet wherever the text has a blank line. */
function editedDraft(post: ReviewPost, text: string): LocalDraft {
  if (!post.entries) return { text, entries: null }
  const entries = text
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  return { text, entries: entries.length > 0 ? entries : [''] }
}

/** Same entry shape as acceptRevision, so the box matches the stored post. */
function acceptedDraft(
  post: ReviewPost,
  proposal: { text: string; entries: string[] | null },
): LocalDraft {
  if (proposal.entries) return { text: proposal.text, entries: proposal.entries }
  if (post.entries) return { text: proposal.text, entries: proposal.text.split('\n\n') }
  return { text: proposal.text, entries: null }
}

const STATUS_KEY: Record<ReviewStatus, string> = {
  needs_review: 'agents.drafts.statusNeedsReview',
  draft: 'agents.drafts.statusDraft',
  scheduled: 'agents.drafts.statusScheduled',
  published: 'agents.drafts.statusPublished',
  uncertain: 'agents.drafts.statusUncertain',
  failed: 'agents.drafts.statusFailed',
}

function platformKey(post: ReviewPost): string {
  if (post.platform === 'linkedin') return 'agents.drafts.platformLinkedin'
  if (post.platform === 'x') return 'agents.drafts.platformX'
  return 'agents.drafts.platformInstagram'
}

function preview(post: ReviewPost, local: LocalDraft | undefined): string {
  const text = local?.text ?? post.text
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length > 140 ? `${trimmed.slice(0, 139)}…` : trimmed
}

export function DraftsSidebar({
  posts,
  avatarId,
  busy,
  scheduling,
  acceptedRevision,
  report,
  onClose,
  onPatch,
  onDelete,
  onAddToChat,
  onCommit,
}: DraftsSidebarProps) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ReviewPost | null>(null)
  const [drafts, setDrafts] = useState<Record<string, LocalDraft>>({})
  const [times, setTimes] = useState<Record<string, string>>({})
  const [discarding, setDiscarding] = useState(false)
  const appliedRevisionToken = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const zone = browserTimeZone()
  const selected = posts.find((post) => post.id === selectedId) ?? null

  useEffect(() => {
    if (selectedId && !posts.some((post) => post.id === selectedId)) {
      setSelectedId(null)
    }
  }, [posts, selectedId])

  useEffect(() => {
    if (!acceptedRevision || appliedRevisionToken.current === acceptedRevision.token) return
    const post = posts.find((item) => item.id === acceptedRevision.postId)
    if (!post) return
    appliedRevisionToken.current = acceptedRevision.token
    const next = acceptedDraft(post, acceptedRevision)
    setDrafts((current) => ({ ...current, [post.id]: next }))
  }, [acceptedRevision, posts])
  const local = selected ? drafts[selected.id] : undefined
  const dirty = Boolean(
    selected &&
      local &&
      (local.text !== selected.text ||
        JSON.stringify(local.entries) !== JSON.stringify(selected.entries)),
  )

  const groups = useMemo(() => {
    const order: string[] = []
    const buckets = new Map<string, ReviewPost[]>()
    for (const post of posts) {
      const key = post.proposedDate ?? ''
      if (!buckets.has(key)) {
        buckets.set(key, [])
        order.push(key)
      }
      buckets.get(key)?.push(post)
    }
    return order.map((key) => ({ key, posts: buckets.get(key) ?? [] }))
  }, [posts])

  function remember(post: ReviewPost, next: LocalDraft) {
    setDrafts((current) => ({ ...current, [post.id]: next }))
  }

  function currentBody(post: ReviewPost): LocalDraft {
    return drafts[post.id] ?? { text: post.text, entries: post.entries ? [...post.entries] : null }
  }

  function saveLocal(post: ReviewPost) {
    const body = currentBody(post)
    if (post.platform === 'linkedin' && linkedInOverLimit(body.text)) return
    onPatch({
      ...post,
      text: body.text,
      entries: body.entries,
    })
    setDrafts((current) => {
      const next = { ...current }
      delete next[post.id]
      return next
    })
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setNotice(t('agents.drafts.copied'))
      setError(null)
    } catch (copyError) {
      setNotice(null)
      setError(userFacingMessage(copyError, t('agents.drafts.copyFailed')))
    }
  }

  async function addMedia(post: ReviewPost, files: File[]) {
    const maxImages = post.platform === 'x' ? POSTIZ_MAX_X_POST_IMAGES : POSTIZ_MAX_POST_IMAGES
    const existing = post.media.map((item) => ({
      kind: (item.original_name ?? item.path).toLowerCase().endsWith('.mp4') ? 'video' : 'image',
    })) as Array<{ kind: MediaKind }>
    const validated = validateNewFiles(existing, files, maxImages)
    if (!validated.ok) {
      setError(t(`postiz.calendar.${validated.errorKey}`, validated.errorParams ?? {}))
      return
    }
    setUploading(true)
    setError(null)
    try {
      const uploaded: PostizMediaItem[] = []
      for (const item of validated.accepted) {
        uploaded.push(await uploadPostizMedia(avatarId, item.file))
      }
      onPatch({ ...post, media: [...post.media, ...uploaded] })
    } catch (uploadError) {
      setError(userFacingMessage(uploadError, t('agents.drafts.statusFailed')))
    } finally {
      setUploading(false)
    }
  }

  const selectedTime = selected ? (times[selected.id] ?? '') : ''
  const selectedSkip = selected
    ? scheduleSkipReason(selected, selectedTime, new Date())
    : null

  return (
    <aside className="flex h-full min-h-0 w-full flex-1 flex-col border-l border-border-hairline bg-canvas-raised text-ink">
      <div className="flex items-center justify-between gap-3 border-b border-border-hairline px-4 py-3">
        <h2 className="font-serif text-xl text-ink">{t('agents.drafts.title')}</h2>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition hover:bg-canvas hover:text-ink"
          aria-label={t('agents.drafts.close')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <p className="px-4 pt-3 text-xs text-ink-muted">{t('agents.drafts.timezone', { zone })}</p>
      {error ? <p className="mx-4 mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="mx-4 mt-3 text-sm text-ink-muted">{notice}</p> : null}

      {selected ? (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="contos-btn contos-btn--pill contos-btn--secondary inline-flex items-center gap-1.5"
              onClick={() => setSelectedId(null)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4" aria-hidden>
                <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('agents.drafts.back')}
            </button>
            <button
              type="button"
              className="contos-btn contos-btn--pill shrink-0"
              disabled={busy || dirty}
              onClick={() => onAddToChat(selected)}
            >
              {t('agents.drafts.addToChat')}
            </button>
          </div>
          <p className="text-sm text-ink-muted">
            {t(platformKey(selected))} · {t(STATUS_KEY[selected.status])}
          </p>
          <textarea
            className="w-full rounded-xl border border-border-hairline bg-canvas-raised px-3 py-2 text-ink"
            rows={8}
            aria-label={t('agents.draftComposer.editLabel')}
            value={local?.text ?? selected.text}
            onChange={(event) => remember(selected, editedDraft(selected, event.target.value))}
          />
          <p className="text-xs text-ink-muted">
            {t('agents.draftComposer.charCountOf', {
              count: postizContentLength(local?.text ?? selected.text),
              limit: selected.platform === 'linkedin' ? CHAT_LINKEDIN_CONTENT_LIMIT : CHAT_X_SOFT_LIMIT,
            })}
          </p>
          {selected.platform === 'instagram' ? (
            <p className="text-sm text-ink-muted">{t('agents.drafts.instagramOnly')}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {selected.media.map((item) => (
              <button
                key={item.id}
                type="button"
                className="contos-btn contos-btn--pill contos-btn--secondary"
                onClick={() => onPatch({ ...selected, media: selected.media.filter((media) => media.id !== item.id) })}
              >
                {item.name || item.original_name || t('agents.drafts.removeMedia')}
              </button>
            ))}
          </div>
          {selected.platform !== 'instagram' ? (
            <label className="contos-btn contos-btn--pill contos-btn--secondary inline-flex">
              {t('postiz.calendar.addMedia')}
              <input
                className="sr-only"
                type="file"
                accept={MEDIA_ACCEPT}
                multiple
                disabled={uploading || busy}
                onChange={(event) => {
                  const files = event.target.files ? [...event.target.files] : []
                  event.target.value = ''
                  if (files.length > 0) void addMedia(selected, files)
                }}
              />
            </label>
          ) : null}
          <label className="block text-sm">
            {t('agents.drafts.time')}
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-xl border border-border-hairline bg-canvas-raised px-3 py-2"
              value={selectedTime}
              onChange={(event) => setTimes((current) => ({ ...current, [selected.id]: event.target.value }))}
            />
          </label>
          {selected.proposedDate ? (
            <p className="text-xs text-ink-muted">{t('agents.drafts.proposedDate', { date: selected.proposedDate })}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="contos-btn contos-btn--rect"
              disabled={!dirty || (selected.platform === 'linkedin' && linkedInOverLimit(local?.text ?? selected.text))}
              onClick={() => saveLocal(selected)}
            >
              {t('agents.drafts.save')}
            </button>
            <button
              type="button"
              className="contos-btn contos-btn--rect contos-btn--secondary"
              onClick={() => {
                if (dirty) setDiscarding(true)
                else setSelectedId(null)
              }}
            >
              {t('agents.drafts.cancel')}
            </button>
            <button type="button" className="contos-btn contos-btn--pill contos-btn--secondary" onClick={() => void copyText(local?.text ?? selected.text)}>
              {t('agents.drafts.copy')}
            </button>
            <button
              type="button"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition hover:bg-canvas hover:text-red-600"
              aria-label={t('agents.drafts.delete')}
              onClick={() => setPendingDelete(selected)}
            >
              <TrashIcon />
            </button>
          </div>
          {selected.platform !== 'instagram' ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="contos-btn contos-btn--pill contos-btn--secondary"
                disabled={busy || scheduling || uploading || dirty}
                onClick={() => onCommit(selected, selectedTime, 'draft')}
              >
                {t('agents.draftComposer.saveDraft')}
              </button>
              <button
                type="button"
                className="contos-btn contos-btn--pill"
                disabled={busy || scheduling || uploading || dirty || selectedSkip != null}
                onClick={() => onCommit(selected, selectedTime, 'schedule')}
              >
                {t('agents.draftComposer.schedule')}
              </button>
            </div>
          ) : null}
          {selected.postizPostId && selected.entries && selected.entries.length > 1 ? (
            <p className="text-xs text-ink-muted">{t('agents.drafts.threadUpdate')}</p>
          ) : null}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {posts.length === 0 ? <p className="text-sm text-ink-muted">{t('agents.drafts.empty')}</p> : null}
          {report ? (
            <div className="mb-3 space-y-2 text-xs text-ink-muted">
              {(['succeeded', 'failed', 'skipped', 'uncertain'] as const).map((bucket) =>
                report[bucket].length === 0 ? null : (
                  <div key={bucket}>
                    <p>{t(`agents.drafts.${bucket}`)}: {report[bucket].length}</p>
                    <ul>
                      {report[bucket].map((row) => (
                        <li key={`${bucket}-${row.post.id}`}>
                          {preview(row.post, drafts[row.post.id])} ({row.reason})
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              )}
            </div>
          ) : null}
          {groups.map((group) => (
            <section key={group.key || 'undated'} className="mb-4">
              <h3 className="mb-2 text-xs uppercase tracking-wide text-ink-muted">
                {group.key ? t('agents.drafts.proposedDate', { date: group.key }) : t('agents.drafts.noDate')}
              </h3>
              <ul className="space-y-2">
                {group.posts.map((post) => (
                  <li key={post.id} className="flex items-stretch gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-xl border border-border-hairline px-3 py-3 text-left"
                      onClick={() => {
                        setSelectedId(post.id)
                        setError(null)
                        setNotice(null)
                      }}
                    >
                      <span className="text-xs text-ink-muted">
                        {t(platformKey(post))} · {t(STATUS_KEY[post.status])}
                      </span>
                      <span className="mt-1 block text-sm text-ink">{preview(post, drafts[post.id])}</span>
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-lg text-ink-muted transition hover:bg-canvas hover:text-red-600"
                      aria-label={t('agents.drafts.delete')}
                      onClick={() => setPendingDelete(post)}
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={pendingDelete != null}
        title={t('agents.drafts.deleteTitle')}
        description={t('agents.drafts.deleteBody')}
        confirmLabel={t('agents.drafts.deleteConfirm')}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete)
          setPendingDelete(null)
        }}
      />
      <ConfirmDialog
        open={discarding}
        title={t('agents.drafts.discardTitle')}
        description={t('agents.drafts.discardBody')}
        confirmLabel={t('agents.drafts.discardConfirm')}
        onCancel={() => setDiscarding(false)}
        onConfirm={() => {
          if (selected) {
            setDrafts((current) => {
              const next = { ...current }
              delete next[selected.id]
              return next
            })
          }
          setDiscarding(false)
          setSelectedId(null)
        }}
      />
    </aside>
  )
}
