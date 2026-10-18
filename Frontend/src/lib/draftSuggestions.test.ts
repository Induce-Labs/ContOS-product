import { describe, expect, it } from 'vitest'
import {
  confirmSuggestions,
  hasSuggestions,
  isConfirmMessage,
  outputHasSuggestions,
  splitSuggestions,
  stripSuggestionMarkers,
} from './draftSuggestions'

describe('splitSuggestions', () => {
  it('splits plain and bold parts in order', () => {
    expect(splitSuggestions('I **built a CRM agent** last year. **Then it broke.**')).toEqual([
      { text: 'I ', suggestion: false },
      { text: 'built a CRM agent', suggestion: true },
      { text: ' last year. ', suggestion: false },
      { text: 'Then it broke.', suggestion: true },
    ])
  })

  it('returns one plain segment when nothing is bold', () => {
    expect(splitSuggestions('Just a post.')).toEqual([{ text: 'Just a post.', suggestion: false }])
  })

  it('keeps a lone asterisk as plain text', () => {
    expect(splitSuggestions('5 * 3 = 15')).toEqual([{ text: '5 * 3 = 15', suggestion: false }])
  })
})

describe('markers', () => {
  it('strips markers and keeps the words', () => {
    expect(stripSuggestionMarkers('a **b** c')).toBe('a b c')
    expect(hasSuggestions('a **b** c')).toBe(true)
    expect(hasSuggestions('a b c')).toBe(false)
  })
})

const draft = {
  agent: 'linkedin',
  reply: 'Here is the post.',
  thesis: 'angle',
  next_question: 'What did you build?',
  ideas: [{ title: 'x', why: 'y' }],
  post_ideas: [{ topic: 'Mon', post_structure: 'I **built a CRM agent**.\n\nIt worked.', hook: 'I **built**' }],
  thread_structures: [{ tweets: ['**one** two'] }],
}

describe('outputHasSuggestions / confirmSuggestions', () => {
  it('detects bold in draft fields only', () => {
    expect(outputHasSuggestions(draft)).toBe(true)
    expect(outputHasSuggestions({ reply: 'a **b**', post_ideas: [] })).toBe(false)
    expect(outputHasSuggestions('nothing')).toBe(false)
  })

  it('removes the markers, keeps the draft text, and replaces the chatter with the note', () => {
    const out = confirmSuggestions(draft, 'Final version.') as typeof draft
    expect(out.post_ideas[0].post_structure).toBe('I built a CRM agent.\n\nIt worked.')
    expect(out.post_ideas[0].hook).toBe('I built')
    expect(out.thread_structures[0].tweets).toEqual(['one two'])
    expect(out.reply).toBe('Final version.')
    expect(out.next_question).toBe('')
    expect(out.ideas).toEqual([])
    expect(outputHasSuggestions(out)).toBe(false)
  })

  it('does not change the original output', () => {
    confirmSuggestions(draft, 'x')
    expect(draft.post_ideas[0].post_structure).toContain('**')
  })
})

describe('isConfirmMessage', () => {
  it.each([
    'confirm',
    'Confirm.',
    'confirmed',
    'yes confirm',
    'ok, confirm it',
    'looks good, confirm',
    'I confirm',
    "that's final",
    'confirm the draft',
    '确认',
    'पुष्टि',
    'confirmer',
    'confirmar',
  ])('accepts %s', (text) => expect(isConfirmMessage(text)).toBe(true))

  it.each([
    '',
    'yes',
    'ok',
    'confirm the switch to instagram and write a caption',
    'can you confirm the number of followers?',
    'do not confirm yet',
    'change the first bold part to something about AI',
  ])('rejects %s', (text) => expect(isConfirmMessage(text)).toBe(false))
})
