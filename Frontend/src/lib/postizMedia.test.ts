import { describe, expect, it } from 'vitest'
import {
  isAddMediaDisabled,
  isImageFile,
  isMp4VideoFile,
  mediaKindFromPath,
  validateNewFiles,
} from './postizMedia'
import { POSTIZ_MAX_POST_IMAGES, POSTIZ_MAX_VIDEO_BYTES } from './postiz'

function fakeFile(
  name: string,
  type: string,
  size = 100,
): File {
  const buffer = new ArrayBuffer(Math.min(size, 64))
  const file = new File([buffer], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('postizMedia detection', () => {
  it('accepts image MIME and extension fallback', () => {
    expect(isImageFile(fakeFile('a.jpg', 'image/jpeg'))).toBe(true)
    expect(isImageFile(fakeFile('a.png', ''))).toBe(true)
    expect(isImageFile(fakeFile('a.mp4', 'image/jpeg'))).toBe(false)
  })

  it('accepts one MP4 with video/mp4 or empty MIME', () => {
    expect(isMp4VideoFile(fakeFile('clip.mp4', 'video/mp4'))).toBe(true)
    expect(isMp4VideoFile(fakeFile('clip.mp4', ''))).toBe(true)
  })

  it('rejects webm/quicktime/avi/mkv and invalid mp4 combos', () => {
    expect(isMp4VideoFile(fakeFile('a.webm', 'video/webm'))).toBe(false)
    expect(isMp4VideoFile(fakeFile('a.mov', 'video/quicktime'))).toBe(false)
    expect(isMp4VideoFile(fakeFile('a.avi', 'video/x-msvideo'))).toBe(false)
    expect(isMp4VideoFile(fakeFile('a.mkv', 'video/x-matroska'))).toBe(false)
    expect(isMp4VideoFile(fakeFile('clip.jpg', 'video/mp4'))).toBe(false)
    expect(isImageFile(fakeFile('fake.mp4', 'image/jpeg'))).toBe(false)
  })

  it('hydrates path kinds', () => {
    expect(mediaKindFromPath('https://cdn.example.com/a.mp4')).toBe('video')
    expect(mediaKindFromPath('https://cdn.example.com/a.jpg')).toBe('image')
    expect(mediaKindFromPath('https://cdn.example.com/a.mp4?x=1')).toBe('video')
  })
})

describe('validateNewFiles', () => {
  it('allows image-only batches within the limit', () => {
    const result = validateNewFiles(
      [{ kind: 'image' }],
      [fakeFile('b.png', 'image/png'), fakeFile('c.jpg', 'image/jpeg')],
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.accepted).toHaveLength(2)
    }
  })

  it('allows exactly one MP4 with empty existing', () => {
    const result = validateNewFiles([], [fakeFile('clip.mp4', 'video/mp4')])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.accepted[0]?.kind).toBe('video')
    }
  })

  it('allows empty MIME + .mp4', () => {
    const result = validateNewFiles([], [fakeFile('clip.mp4', '')])
    expect(result.ok).toBe(true)
  })

  it('rejects two videos', () => {
    const result = validateNewFiles(
      [],
      [fakeFile('a.mp4', 'video/mp4'), fakeFile('b.mp4', 'video/mp4')],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorKey).toBe('mediaVideoOnlyOne')
    }
  })

  it('rejects image + video in one batch', () => {
    const result = validateNewFiles(
      [],
      [fakeFile('a.jpg', 'image/jpeg'), fakeFile('b.mp4', 'video/mp4')],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorKey).toBe('mediaCannotMixVideoAndImages')
    }
  })

  it('rejects existing image + new video', () => {
    const result = validateNewFiles(
      [{ kind: 'image' }],
      [fakeFile('b.mp4', 'video/mp4')],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorKey).toBe('mediaCannotMixVideoAndImages')
    }
  })

  it('rejects existing video + new image', () => {
    const result = validateNewFiles(
      [{ kind: 'video' }],
      [fakeFile('b.jpg', 'image/jpeg')],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorKey).toBe('mediaVideoOnlyOne')
    }
  })

  it('rejects existing video + new video', () => {
    const result = validateNewFiles(
      [{ kind: 'video' }],
      [fakeFile('b.mp4', 'video/mp4')],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorKey).toBe('mediaVideoOnlyOne')
    }
  })

  it('rejects unsupported video types', () => {
    for (const [name, type] of [
      ['a.webm', 'video/webm'],
      ['a.mov', 'video/quicktime'],
      ['a.avi', 'video/x-msvideo'],
      ['a.mkv', 'video/x-matroska'],
    ] as const) {
      const result = validateNewFiles([], [fakeFile(name, type)])
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errorKey).toBe('mediaUnsupportedType')
      }
    }
  })

  it('rejects video larger than 1 GB', () => {
    const result = validateNewFiles(
      [],
      [fakeFile('huge.mp4', 'video/mp4', POSTIZ_MAX_VIDEO_BYTES + 1)],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorKey).toBe('mediaVideoTooLarge')
    }
  })

  it('rejects exceeding image max', () => {
    const existing = Array.from({ length: POSTIZ_MAX_POST_IMAGES }, () => ({
      kind: 'image' as const,
    }))
    const result = validateNewFiles(existing, [fakeFile('x.jpg', 'image/jpeg')])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorKey).toBe('mediaMaxReached')
    }
  })
})

describe('isAddMediaDisabled', () => {
  it('disables when a video is present even if length is 1', () => {
    expect(isAddMediaDisabled([{ kind: 'video' }])).toBe(true)
  })

  it('disables at 10 images', () => {
    const existing = Array.from({ length: 10 }, () => ({ kind: 'image' as const }))
    expect(isAddMediaDisabled(existing)).toBe(true)
  })

  it('allows adding when fewer than 10 images', () => {
    expect(isAddMediaDisabled([{ kind: 'image' }])).toBe(false)
  })
})

describe('validateNewFiles X max of 4', () => {
  it('accepts 4 images', () => {
    const existing = Array.from({ length: 3 }, () => ({ kind: 'image' as const }))
    const result = validateNewFiles(existing, [fakeFile('d.jpg', 'image/jpeg')], 4)
    expect(result.ok).toBe(true)
  })

  it('rejects a 5th image', () => {
    const existing = Array.from({ length: 4 }, () => ({ kind: 'image' as const }))
    const result = validateNewFiles(existing, [fakeFile('e.jpg', 'image/jpeg')], 4)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorKey).toBe('mediaMaxReached')
      expect(result.errorParams).toEqual({ max: 4 })
    }
  })

  it('accepts one MP4 and rejects a second, a mix, and two videos', () => {
    const video = fakeFile('clip.mp4', 'video/mp4')
    expect(validateNewFiles([], [video], 4).ok).toBe(true)
    expect(validateNewFiles([{ kind: 'video' }], [video], 4).ok).toBe(false)
    expect(
      validateNewFiles([{ kind: 'image' }], [video], 4).ok,
    ).toBe(false)
    const two = validateNewFiles([], [video, fakeFile('other.mp4', 'video/mp4')], 4)
    expect(two.ok).toBe(false)
    if (!two.ok) {
      expect(two.errorKey).toBe('mediaVideoOnlyOne')
    }
  })

  it('disables add at 4 images and still allows fewer', () => {
    const four = Array.from({ length: 4 }, () => ({ kind: 'image' as const }))
    expect(isAddMediaDisabled(four, 4)).toBe(true)
    expect(isAddMediaDisabled([{ kind: 'image' }], 4)).toBe(false)
  })
})
