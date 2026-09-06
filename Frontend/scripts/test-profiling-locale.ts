/**
 * Unit checks for profilingLocaleCore (no Agents API).
 * Run: npx --yes tsx scripts/test-profiling-locale.ts
 */
import assert from 'node:assert/strict'
import type { ProfilingQuestionDef } from '../src/config/onboardingProfilingQuestions'
import { SUPPORTED_LANGUAGES } from '../src/i18n/resources'
import {
  buildLocalizedQuestionnaire,
  looksLikeUrl,
  selectAnswerToEnglish,
  shouldTranslateAnswerToEnglish,
} from '../src/lib/profilingLocaleCore'

assert.deepEqual([...SUPPORTED_LANGUAGES], ['en', 'hi', 'zh', 'fr', 'es'])

const question: ProfilingQuestionDef = {
  key: 'audience',
  sectionLabel: 'Audience',
  question: 'Who is your audience?',
  required: true,
  input: {
    kind: 'single_select',
    options: ['Founders', 'Other'],
    allowOther: true,
  },
}

const map = new Map<string, string>([
  ['Who is your audience?', '¿Quién es tu audiencia?'],
  ['Audience', 'Audiencia'],
  ['Founders', 'Fundadores'],
  ['Other', 'Otro'],
])

const { displayQuestions, optionMaps } = buildLocalizedQuestionnaire([question], map)
const display = displayQuestions[0]!
assert.equal(display.question, '¿Quién es tu audiencia?')
assert.deepEqual(
  display.input.kind === 'single_select' ? display.input.options : [],
  ['Fundadores', 'Otro'],
)
assert.deepEqual(
  display.input.kind === 'single_select' ? display.input.englishOptions : [],
  ['Founders', 'Other'],
)
assert.equal(optionMaps.audience?.toEnglish['Fundadores'], 'Founders')
assert.equal(optionMaps.audience?.toLocale['Founders'], 'Fundadores')

assert.equal(
  selectAnswerToEnglish(question, 'Fundadores', optionMaps.audience),
  'Founders',
)
assert.equal(
  selectAnswerToEnglish(question, 'texto libre', optionMaps.audience),
  'texto libre',
)

assert.equal(shouldTranslateAnswerToEnglish('en', 'hello'), false)
assert.equal(shouldTranslateAnswerToEnglish('es', ''), false)
assert.equal(shouldTranslateAnswerToEnglish('es', 'hola'), true)
for (const lang of ['hi', 'zh', 'fr', 'es'] as const) {
  assert.equal(shouldTranslateAnswerToEnglish(lang, 'hola'), true)
}

assert.equal(looksLikeUrl('https://example.com'), true)
assert.equal(looksLikeUrl('example.com'), true)
assert.equal(looksLikeUrl('not a url'), false)

console.log('profilingLocaleCore tests passed')
