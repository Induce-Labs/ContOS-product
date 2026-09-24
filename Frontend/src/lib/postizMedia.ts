/**
 * Calendar media attach helpers (UX validation only).
 * ContOS backend remains the authoritative MIME/size/combination validator.
 */
import {
  POSTIZ_MAX_POST_IMAGES,
  POSTIZ_MAX_VIDEO_BYTES,
  POSTIZ_VIDEO_MIME,
} from './postiz'

export type MediaKind = 'image' | 'video'

export type MediaErrorKey =
  | 'mediaUnsupportedType'
  | 'mediaMaxReached'
  | 'mediaVideoOnlyOne'
  | 'mediaCannotMixVideoAndImages'
  | 'mediaVideoTooLarge'

export type ExistingAttachmentKind = { kind: MediaKind }

const IMAGE_EXTENSION_RE = /\.(jpe?g|png|gif|webp|avif|bmp|tiff?)$/i
const MP4_EXTENSION_RE = /\.mp4$/i

export function mediaKindFromPath(path: string): MediaKind {
  const cleaned = path.trim().split('?')[0].split('#')[0]
  return MP4_EXTENSION_RE.test(cleaned) ? 'video' : 'image'
}

export function isImageFile(file: File): boolean {
  if (file.type === POSTIZ_VIDEO_MIME || MP4_EXTENSION_RE.test(file.name)) {
    return false
  }
  if (file.type.startsWith('image/')) {
    return true
  }
  // Some OS/browsers report an empty MIME type; fall back to extension.
  return IMAGE_EXTENSION_RE.test(file.name)
}

export function isMp4VideoFile(file: File): boolean {
  const mime = (file.type || '').trim().toLowerCase()
  if (mime === POSTIZ_VIDEO_MIME) {
    return MP4_EXTENSION_RE.test(file.name)
  }
  if (!mime) {
    return MP4_EXTENSION_RE.test(file.name)
  }
  return false
}

function classifyFile(file: File): MediaKind | null {
  if (isMp4VideoFile(file)) {
    return 'video'
  }
  if (isImageFile(file)) {
    return 'image'
  }
  return null
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return ''
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export type ValidateNewFilesResult =
  | { ok: true; accepted: Array<{ file: File; kind: MediaKind }> }
  | { ok: false; errorKey: MediaErrorKey; errorParams?: Record<string, string | number> }

/**
 * Validate a newly picked FileList against existing attachments.
 * Rules: ≤10 images XOR exactly 1 MP4; empty existing + empty new is caller concern.
 */
export function validateNewFiles(
  existing: ExistingAttachmentKind[],
  files: File[],
): ValidateNewFilesResult {
  if (files.length === 0) {
    return { ok: true, accepted: [] }
  }

  const existingVideoCount = existing.filter((item) => item.kind === 'video').length
  const existingImageCount = existing.filter((item) => item.kind === 'image').length

  if (existingVideoCount > 0) {
    return { ok: false, errorKey: 'mediaVideoOnlyOne' }
  }

  const accepted: Array<{ file: File; kind: MediaKind }> = []
  let newImageCount = 0
  let newVideoCount = 0

  for (const file of files) {
    const kind = classifyFile(file)
    if (kind == null) {
      return { ok: false, errorKey: 'mediaUnsupportedType' }
    }
    if (kind === 'video') {
      if (file.size > POSTIZ_MAX_VIDEO_BYTES) {
        return { ok: false, errorKey: 'mediaVideoTooLarge' }
      }
      newVideoCount += 1
    } else {
      newImageCount += 1
    }
    accepted.push({ file, kind })
  }

  if (newVideoCount > 1) {
    return { ok: false, errorKey: 'mediaVideoOnlyOne' }
  }
  if (newVideoCount === 1 && (newImageCount > 0 || existingImageCount > 0)) {
    return { ok: false, errorKey: 'mediaCannotMixVideoAndImages' }
  }
  if (newImageCount > 0 && existingImageCount + newImageCount > POSTIZ_MAX_POST_IMAGES) {
    return {
      ok: false,
      errorKey: 'mediaMaxReached',
      errorParams: { max: POSTIZ_MAX_POST_IMAGES },
    }
  }

  return { ok: true, accepted }
}

export function isAddMediaDisabled(existing: ExistingAttachmentKind[]): boolean {
  if (existing.some((item) => item.kind === 'video')) {
    return true
  }
  const imageCount = existing.filter((item) => item.kind === 'image').length
  return imageCount >= POSTIZ_MAX_POST_IMAGES
}

export const MEDIA_ACCEPT =
  'image/jpeg,image/png,image/gif,image/webp,image/avif,image/bmp,image/tiff,.jpg,.jpeg,.png,.gif,.webp,.avif,.bmp,.tif,.tiff,video/mp4,.mp4'
