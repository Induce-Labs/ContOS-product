/**
 * Node test for Instagram strategy display (no React, no API keys).
 * Run: node Frontend/scripts/test-agent-output-display.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const tsPath = join(__dirname, '../src/lib/agentOutputDisplay.ts')
const source = readFileSync(tsPath, 'utf8')
const { code } = transformSync(source, {
  loader: 'ts',
  format: 'cjs',
  target: 'node18',
})

const require = createRequire(import.meta.url)
const Module = require('node:module')
const mod = new Module(tsPath)
mod._compile(code, tsPath)
const {
  isStructuredAgentOutput,
  buildInstagramDisplaySections,
  formatStructuredAgentOutput,
  composePublishablePosts,
} = mod.exports

const sample = {
  agent: 'instagram',
  platform: 'instagram',
  response_type: 'analysis',
  content_calendar: [],
  top_hooks: [
    'Quranic references anchoring universal truths',
    'Emotional resilience narratives with poetic framing',
  ],
  caption_formulas: [
    'Open with a relatable tension or question + poetic metaphor + closing reflection question',
  ],
  posting_frequency: '3-4 carousels per week, 1-2 Reels for reach, daily Stories',
  competitor_comparison: [
    {
      competitor_handle: 'poetryandgahwa',
      platform: 'instagram',
      strengths: ['Carousel dominance for deep reflective content'],
      weaknesses: ['Zero Reel presence misses algorithmic reach opportunity'],
      hooks_and_themes: ['Kun fa-yakun and Quranic anchors for spiritual authority'],
      key_signals: ['Carousel-first format for theological depth'],
    },
  ],
  comparison_summary: 'PoetryandGahwa wins through carousel depth.',
  differentiation_angles: [
    'Launch Reels that animate poetic lines with voiceover and ambient sound',
  ],
  analysis:
    'Based on competitor intelligence for poetryandgahwa, carousels dominate for deep engagement.',
}

assert.equal(isStructuredAgentOutput(sample), true)

const sections = buildInstagramDisplaySections(sample)
const titles = sections.map((s) => s.title)
assert.ok(titles.includes('Strategy'), 'must show Strategy narrative')
assert.ok(titles.includes('Top hooks'), 'must show Top hooks')
assert.ok(titles.includes('Caption formulas'), 'must show Caption formulas')
assert.ok(titles.includes('Posting cadence'), 'must show Posting cadence')
assert.ok(titles.includes('poetryandgahwa'), 'must show competitor handle')
assert.ok(titles.includes('How to differentiate'), 'must show differentiation')

const text = formatStructuredAgentOutput(sample)
assert.ok(text.includes('carousels dominate'), 'analysis body present')
assert.ok(text.includes('Top hooks'), 'hooks heading present')
assert.ok(!text.trim().startsWith('{'), 'must not dump raw JSON object')
assert.ok(!text.includes('"response_type"'), 'must not dump schema keys as JSON')

// Regression: old AgentsPage behavior stringified the whole payload
const badDump = JSON.stringify(sample, null, 2)
assert.notEqual(text.trim(), badDump.trim(), 'must not equal JSON.stringify dump')

const linkedIn = {
  agent: 'linkedin',
  post_ideas: [
    {
      topic: 'Secret topic title',
      content_type: 'CAROUSEL',
      hook: 'Ship the work.',
      post_structure: 'Ship the work.\n\nThen tell them what broke.',
      cta: 'Reply with yours.',
      reasoning: 'Because operators remember specifics.',
    },
    {
      topic: 'Second topic',
      content_type: 'TEXT',
      hook: 'Second hook',
      post_structure: 'The body of the second post.',
      cta: 'Follow along.',
      reasoning: 'Hidden on purpose.',
    },
  ],
}
const linkedInText = formatStructuredAgentOutput(linkedIn)
const linkedInDraft = composePublishablePosts([
  {
    hook: 'Ship the work.',
    body: 'Ship the work.\n\nThen tell them what broke.',
    cta: 'Reply with yours.',
  },
  {
    hook: 'Second hook',
    body: 'The body of the second post.',
    cta: 'Follow along.',
  },
])
assert.equal(linkedInText, linkedInDraft, 'saved LinkedIn text matches the on-screen draft')
assert.equal(linkedInText.split('Ship the work.').length - 1, 1, 'hook is not repeated')
assert.ok(linkedInText.includes('\n'), 'composed draft contains real newlines')
assert.equal(linkedInText.includes('---'), false, 'draft must not use dash dividers')
assert.ok(
  linkedInText.includes('Reply with yours.\n\nSecond hook'),
  'two posts are separated by a blank line',
)
assert.equal(
  linkedInDraft,
  'Ship the work.\nThen tell them what broke.\nReply with yours.\n\nSecond hook\nThe body of the second post.\nFollow along.',
)
for (const label of ['CAROUSEL', 'HOOK', 'CTA:', 'POST IDEAS', 'Reasoning:', 'Secret topic title']) {
  assert.equal(linkedInText.includes(label), false, `draft must not show ${label}`)
}
assert.ok(linkedInText.includes('Reply with yours.'))
assert.ok(linkedInText.includes('Second hook'))

const alreadyClosed = composePublishablePosts([
  {
    hook: 'Open here',
    body: 'Open here\n\nBody already ends with the ask.',
    cta: 'Body already ends with the ask.',
  },
])
assert.equal(alreadyClosed, 'Open here\nBody already ends with the ask.')
assert.equal(alreadyClosed.includes('\n\n'), false, 'single draft collapses blank lines')

const tweets = formatStructuredAgentOutput({
  agent: 'twitter',
  tweet_ideas: [
    {
      type: 'THREAD',
      hook: 'Already in the tweet',
      full_tweet: 'Already in the tweet\nSecond line',
      reasoning: 'Do not show this.',
    },
  ],
})
assert.equal(tweets, 'Already in the tweet\nSecond line')
assert.equal(tweets.includes('THREAD'), false)
assert.equal(tweets.includes('Reasoning:'), false)

console.log('OK — Instagram strategy renders as readable sections, not raw JSON')
console.log(`Sections (${sections.length}): ${titles.join(' | ')}`)
console.log('--- preview ---')
console.log(text.slice(0, 700))
console.log('...')
