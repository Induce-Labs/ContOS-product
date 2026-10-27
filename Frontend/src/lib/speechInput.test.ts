import { describe, expect, it } from 'vitest'
import {
  appendTranscript,
  applyDictationResult,
  dictationText,
  getSpeechRecognition,
  speechFailure,
  speechLanguageTag,
  type SpeechRecognitionConstructor,
} from './speechInput'

describe('appendTranscript', () => {
  it('keeps typed text, skips an empty result, and inserts one space', () => {
    expect(appendTranscript('Hi', 'there')).toBe('Hi there')
    expect(appendTranscript('Hi ', 'there')).toBe('Hi there')
    expect(appendTranscript('', 'hello')).toBe('hello')
    expect(appendTranscript('Hi', '   ')).toBe('Hi')
    expect(appendTranscript('Hi ', '')).toBe('Hi ')
  })

  it('drops an unfinished interim phrase when listening ends', () => {
    expect(dictationText('Draft', 'add a line', ' still talking')).toBe('Draft add a line still talking')
    expect(dictationText('Draft', 'add a line', '')).toBe('Draft add a line')
  })
})

describe('applyDictationResult', () => {
  const idle = { appliedFinals: '', lastInterim: '' }

  it('appends new speech after text the user kept', () => {
    const first = applyDictationResult('Draft', idle, 'hello', '')
    expect(first.field).toBe('Draft hello')
    const edited = 'Draft'
    const next = applyDictationResult(edited, first.cursor, 'hello world', '')
    expect(next.field).toBe('Draft world')
  })

  it('does not restore an interim phrase the user deleted', () => {
    const first = applyDictationResult('Draft', idle, '', 'hello world')
    expect(first.field).toBe('Draft hello world')
    const next = applyDictationResult('Draft hello', first.cursor, 'hello world', 'today')
    expect(next.field).toBe('Draft hello today')
  })

  it('replaces the live interim phrase when the user has not edited it', () => {
    const first = applyDictationResult('Draft', idle, '', 'hello')
    const next = applyDictationResult(first.field, first.cursor, '', 'hello there')
    expect(next.field).toBe('Draft hello there')
    const ended = applyDictationResult(next.field, next.cursor, 'hello there', '')
    expect(ended.field).toBe('Draft hello there')
  })
})

describe('getSpeechRecognition', () => {
  it('returns null when the browser has no speech constructor', () => {
    expect(getSpeechRecognition(undefined)).toBeNull()
    expect(getSpeechRecognition(null)).toBeNull()
    expect(getSpeechRecognition({})).toBeNull()
  })

  it('prefers SpeechRecognition and falls back to the webkit constructor', () => {
    const Standard = class {} as unknown as SpeechRecognitionConstructor
    const Webkit = class {} as unknown as SpeechRecognitionConstructor
    expect(getSpeechRecognition({ SpeechRecognition: Standard, webkitSpeechRecognition: Webkit })).toBe(Standard)
    expect(getSpeechRecognition({ webkitSpeechRecognition: Webkit })).toBe(Webkit)
  })
})

describe('speech language and errors', () => {
  it('maps the UI language and ignores an aborted session', () => {
    expect(speechLanguageTag('en')).toBe('en-US')
    expect(speechLanguageTag('hi')).toBe('hi-IN')
    expect(speechLanguageTag('zh-Hans')).toBe('zh-CN')
    expect(speechFailure('aborted')).toBeNull()
    expect(speechFailure('not-allowed')).toBe('permission')
    expect(speechFailure('no-speech')).toBe('empty')
    expect(speechFailure('network')).toBe('unavailable')
    expect(speechFailure('audio-capture')).toBe('failed')
  })
})
