import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  CHAT_LINKEDIN_CONTENT_LIMIT,
  CHAT_X_SOFT_LIMIT,
  canSubmitChatDraft,
  linkedInOverLimit,
  xOverSoftLimit,
  type ChatDraftPlatform,
} from '../../lib/chatDraftPrefill'
import { userFacingMessage } from '../../lib/devLog'
import {
  POSTIZ_MAX_POST_IMAGES,
  POSTIZ_MAX_X_POST_IMAGES,
  PostizApiError,
  createPostizPost,
  getPostizStatus,
  nowAsOffsetIso,
  postizContentLength,
  uploadPostizMedia,
  type PostizMediaItem,
  type PostizPostType,
} from '../../lib/postiz'
import {
  MEDIA_ACCEPT,
  isAddMediaDisabled,
  validateNewFiles,
  type MediaKind,
} from '../../lib/postizMedia'
import { ChatSchedulePopover } from './ChatSchedulePopover'

type AttachmentRow = {
  localId: string
  kind: MediaKind
  previewUrl: string
  file?: File
  status: 'pending' | 'uploading' | 'ready' | 'error'
  media?: PostizMediaItem
  error?: string
}

type ChatDraftComposerProps = {
  avatarId: string
  platform: ChatDraftPlatform
  initialContent: string
}

export function ChatDraftComposer({
  avatarId,
  platform,
  initialContent,
}: ChatDraftComposerProps) {
  const { t } = useTranslation()
  const fileInputId = useId()
  const scheduleBtnRef = useRef<HTMLButtonElement>(null)
  const [content, setContent] = useState(initialContent)
  const [attachments, setAttachments] = useState<AttachmentRow[]>([])
  const attachmentsRef = useRef(attachments)
  const [copied, setCopied] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  attachmentsRef.current = attachments

  const maxImages = platform === 'x' ? POSTIZ_MAX_X_POST_IMAGES : POSTIZ_MAX_POST_IMAGES
  const mediaUploading = attachments.some((item) => item.status === 'uploading')
  const overLinkedIn = platform === 'linkedin' && linkedInOverLimit(content)
  const softX = platform === 'x' && xOverSoftLimit(content)
  const charCount = postizContentLength(content)
  const canSubmit =
    canSubmitChatDraft(content, mediaUploading) && !overLinkedIn && !saving

  useEffect(() => {
    setContent(initialContent)
  }, [initialContent])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [content])

  useEffect(() => {
    return () => {
      for (const item of attachmentsRef.current) {
        if (item.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(item.previewUrl)
        }
      }
    }
  }, [])

  async function copyText() {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  async function uploadRow(localId: string, file: File): Promise<PostizMediaItem> {
    setAttachments((prev) =>
      prev.map((entry) =>
        entry.localId === localId
          ? { ...entry, status: 'uploading', error: undefined, file }
          : entry,
      ),
    )
    try {
      const uploaded = await uploadPostizMedia(avatarId, file)
      setAttachments((prev) =>
        prev.map((entry) =>
          entry.localId === localId
            ? { ...entry, status: 'ready', media: uploaded, error: undefined, file }
            : entry,
        ),
      )
      return uploaded
    } catch (err) {
      const message = userFacingMessage(err, t('postiz.calendar.mediaUploadFailed'))
      setAttachments((prev) =>
        prev.map((entry) =>
          entry.localId === localId ? { ...entry, status: 'error', error: message } : entry,
        ),
      )
      throw new PostizApiError(message)
    }
  }

  async function onPickFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setError(null)
    const existing = attachments.map((item) => ({ kind: item.kind }))
    const result = validateNewFiles(existing, Array.from(fileList), maxImages)
    if (!result.ok) {
      setError(
        t(`postiz.calendar.${result.errorKey}`, result.errorParams ?? {}),
      )
      return
    }
    const nextRows: AttachmentRow[] = result.accepted.map(({ file, kind }) => ({
      localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      previewUrl: URL.createObjectURL(file),
      file,
      status: 'pending',
    }))
    setAttachments((prev) => [...prev, ...nextRows])
    for (const row of nextRows) {
      if (row.file) {
        try {
          await uploadRow(row.localId, row.file)
        } catch {
          // Per-row error already stored.
        }
      }
    }
  }

  function removeAttachment(localId: string) {
    setAttachments((prev) => {
      const target = prev.find((item) => item.localId === localId)
      if (target?.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl)
      }
      return prev.filter((item) => item.localId !== localId)
    })
  }

  async function resolveImages(): Promise<PostizMediaItem[]> {
    if (attachments.some((item) => item.status === 'uploading')) {
      throw new PostizApiError(t('postiz.calendar.mediaStillUploading'))
    }
    const resolved: PostizMediaItem[] = []
    for (const item of attachments) {
      if (item.status === 'ready' && item.media) {
        resolved.push(item.media)
        continue
      }
      if (item.status === 'error') {
        throw new PostizApiError(item.error || t('postiz.calendar.mediaUploadFailed'))
      }
      if (item.file) {
        resolved.push(await uploadRow(item.localId, item.file))
        continue
      }
      throw new PostizApiError(t('postiz.calendar.mediaUploadFailed'))
    }
    return resolved
  }

  async function saveDraft() {
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    setStatusMessage(null)
    try {
      const status = await getPostizStatus(
        avatarId,
        platform === 'x' ? 'x' : 'linkedin',
      )
      if (!status.connected || !status.integration) {
        throw new PostizApiError(t('agents.draftComposer.connectBeforeSchedule'))
      }
      const images = await resolveImages()
      await createPostizPost({
        avatarId,
        type: 'draft',
        content: content.trim(),
        publishDate: nowAsOffsetIso(),
        images,
        ...(platform === 'x'
          ? { platform: 'x' as const, posts: [{ content: content.trim() }] }
          : {}),
      })
      setStatusMessage(t('agents.draftComposer.savedDraft'))
    } catch (err) {
      setError(userFacingMessage(err, t('postiz.calendar.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  function onScheduleSuccess(type: Exclude<PostizPostType, 'update'>) {
    if (type === 'now') {
      setStatusMessage(t('agents.draftComposer.publishedNow'))
    } else if (type === 'schedule') {
      setStatusMessage(t('agents.draftComposer.scheduled'))
    } else {
      setStatusMessage(t('agents.draftComposer.savedDraft'))
    }
  }

  const addDisabled = isAddMediaDisabled(
    attachments.map((item) => ({ kind: item.kind })),
    maxImages,
  )

  return (
    <div className="space-y-3">
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(event) => {
          const next = event.target.value
          if (platform === 'linkedin' && postizContentLength(next) > CHAT_LINKEDIN_CONTENT_LIMIT) {
            return
          }
          setContent(next)
          setStatusMessage(null)
        }}
        rows={4}
        className="w-full resize-none rounded-xl border border-border-hairline bg-canvas px-3 py-2.5 text-sm leading-relaxed text-ink outline-none focus:ring-2 focus:ring-accent-primary/30"
        aria-label={t('agents.draftComposer.editLabel')}
        placeholder={t('agents.draftComposer.placeholder')}
      />

      {attachments.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {attachments.map((item) => (
            <li
              key={item.localId}
              className="relative h-16 w-16 overflow-hidden rounded-lg border border-border-hairline bg-canvas"
            >
              {item.kind === 'video' ? (
                <video src={item.previewUrl} className="h-full w-full object-cover" muted />
              ) : (
                <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
              )}
              <button
                type="button"
                className="absolute right-0.5 top-0.5 rounded bg-canvas/90 px-1 text-[10px] text-ink"
                onClick={() => removeAttachment(item.localId)}
              >
                {t('common.remove')}
              </button>
              {item.status === 'uploading' ? (
                <span className="absolute inset-x-0 bottom-0 bg-canvas/80 text-center text-[9px] text-ink-muted">
                  {t('postiz.calendar.mediaUploading')}
                </span>
              ) : null}
              {item.status === 'error' ? (
                <span className="absolute inset-x-0 bottom-0 bg-red-50 text-center text-[9px] text-red-700">
                  {t('postiz.calendar.mediaUploadFailed')}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative flex flex-wrap items-center gap-2">
        <span
          className={`text-xs tabular-nums ${
            overLinkedIn || softX ? 'text-amber-700 dark:text-amber-300' : 'text-ink-muted'
          }`}
          title={
            platform === 'x'
              ? t('agents.draftComposer.xSoftLimitHint', { limit: CHAT_X_SOFT_LIMIT })
              : t('agents.draftComposer.charCountOf', {
                  count: charCount,
                  limit: CHAT_LINKEDIN_CONTENT_LIMIT,
                })
          }
        >
          {platform === 'linkedin'
            ? `${charCount}/${CHAT_LINKEDIN_CONTENT_LIMIT}`
            : charCount}
        </span>

        <button
          type="button"
          className="text-xs font-medium text-accent-primary"
          onClick={() => void copyText()}
        >
          {copied ? t('agents.output.copied') : t('agents.output.copyPost')}
        </button>

        <label
          htmlFor={fileInputId}
          className={`cursor-pointer text-xs font-medium text-accent-primary ${
            addDisabled ? 'pointer-events-none opacity-40' : ''
          }`}
        >
          {t('postiz.calendar.addMedia')}
          <input
            id={fileInputId}
            type="file"
            accept={MEDIA_ACCEPT}
            multiple={platform !== 'x'}
            className="sr-only"
            disabled={addDisabled}
            onChange={(event) => {
              void onPickFiles(event.target.files)
              event.target.value = ''
            }}
          />
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="contos-btn contos-btn--ghost contos-btn--pill px-3.5 py-2 text-xs"
            disabled={!canSubmit}
            onClick={() => void saveDraft()}
          >
            {t('agents.draftComposer.saveDraft')}
          </button>
          <button
            ref={scheduleBtnRef}
            type="button"
            className="contos-btn contos-btn--primary contos-btn--pill px-3.5 py-2 text-xs"
            disabled={!canSubmit}
            aria-expanded={scheduleOpen}
            onClick={() => setScheduleOpen((open) => !open)}
          >
            {t('agents.draftComposer.schedule')}
          </button>
        </div>

        <ChatSchedulePopover
          open={scheduleOpen}
          onClose={() => setScheduleOpen(false)}
          avatarId={avatarId}
          platform={platform}
          content={content}
          images={attachments
            .filter((item) => item.status === 'ready' && item.media)
            .map((item) => item.media as PostizMediaItem)}
          onSuccess={onScheduleSuccess}
          anchorRef={scheduleBtnRef}
        />
      </div>

      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}
      {statusMessage ? (
        <p className="text-xs text-ink-muted">
          {statusMessage}{' '}
          <Link
            to={`/dashboard/${encodeURIComponent(avatarId)}/calendar`}
            className="font-medium text-accent-primary"
          >
            {t('agents.draftComposer.viewCalendar')}
          </Link>
        </p>
      ) : null}
    </div>
  )
}
