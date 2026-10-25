import { beforeAll, describe, expect, it, vi } from 'vitest'

type BuildHistory = typeof import('./agentChatMemory').buildChatHistoryForInvoke
type FormatOutput = typeof import('./agentOutputDisplay').formatStructuredAgentOutput

let buildChatHistoryForInvoke: BuildHistory
let formatStructuredAgentOutput: FormatOutput

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test')
  ;({ buildChatHistoryForInvoke } = await import('./agentChatMemory'))
  ;({ formatStructuredAgentOutput } = await import('./agentOutputDisplay'))
})

const longPost = `${'Short line of the post goes here.\n\n'.repeat(40)}**A suggested detail.**`

const output = {
  agent: 'linkedin',
  mode: 'draft',
  reply: 'Here is your post.',
  thesis: 'Being underestimated is an edge.',
  ideas: [{ title: 'The label', why: 'It reframes the student founder tag.' }],
  post_ideas: [{ topic: 'Monday - Founder story', post_structure: longPost, hook: 'Short line' }],
  next_question: 'What did you build?',
}

describe('strategist output in chat history', () => {
  it('includes the reply, angle, ideas, the full draft with its bold markers, and the question', () => {
    const text = formatStructuredAgentOutput(output)
    expect(text).toContain('Here is your post.')
    expect(text).toContain('Angle: Being underestimated is an edge.')
    expect(text).toContain('- The label: It reframes the student founder tag.')
    expect(text).toContain('Draft (Monday - Founder story):')
    expect(text).toContain('**A suggested detail.**')
    expect(text).toContain('What did you build?')
  })

  it('keeps a full-length draft in the history sent to the model (more than 2000 characters)', () => {
    expect(longPost.length).toBeGreaterThan(1300)
    const history = buildChatHistoryForInvoke([
      { role: 'user', content: 'Write me a post' },
      { role: 'assistant', content: '', agentType: 'linkedin', output },
    ])
    const assistant = history.find((turn) => turn.role === 'assistant')
    expect(assistant?.content).toContain('**A suggested detail.**')
  })

  it('omits another specialist when the target is Instagram and keeps Instagram turns', () => {
    const history = buildChatHistoryForInvoke(
      [
        { role: 'user', content: 'what should I post on X', agentType: 'twitter' },
        { role: 'assistant', content: 'Your competitors on X chase engagement.', agentType: 'twitter' },
        { role: 'user', content: 'ideas for this week', agentType: 'instagram' },
        { role: 'assistant', content: 'Your Instagram competitors lead with the product.', agentType: 'instagram' },
        { role: 'assistant', content: 'A general note from Chat.', agentType: 'chatbot' },
      ],
      'instagram',
    )
    const text = history.map((turn) => turn.content).join('\n')
    expect(text).not.toContain('competitors on X')
    expect(text).not.toContain('post on X')
    expect(text).toContain('Instagram competitors')
    expect(text).toContain('ideas for this week')
    expect(text).toContain('general note from Chat')
  })
})
