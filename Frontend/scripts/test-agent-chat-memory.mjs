import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import Module from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cache = new Map()

function compile(abs, sourceOverride) {
  if (cache.has(abs) && sourceOverride == null) return cache.get(abs)
  const src = sourceOverride ?? readFileSync(abs, 'utf8')
  const { code } = transformSync(src, { loader: 'ts', format: 'cjs', target: 'node18' })
  const mod = new Module(abs)
  mod.filename = abs
  const req = createRequire(abs)
  mod.require = (id) => {
    if (id === './agentsApi') {
      return compile(
        join(root, 'src/lib/agentsApi.ts'),
        [
          "export const AGENTS_WELCOME_MESSAGE = 'Research for this project is ready.';",
          "export function isAgentsWelcomeMessage(content) {",
          "  const text = String(content || '').trim();",
          "  if (text === AGENTS_WELCOME_MESSAGE) return true;",
          "  if (text.includes(AGENTS_WELCOME_MESSAGE) && /^Good (morning|afternoon|evening|Morning|Afternoon|Evening),/.test(text)) return true;",
          "  return /^Good (morning|afternoon|evening|Morning|Afternoon|Evening),\\s+.+/.test(text) && !text.includes('\\n') && text.length < 80;",
          "}",
          "export type AgentType = 'chatbot' | 'linkedin' | 'instagram' | 'playbook' | 'twitter';",
        ].join('\n'),
      )
    }
    if (id === './agentOutputDisplay') {
      return compile(join(root, 'src/lib/agentOutputDisplay.ts'))
    }
    return req(id)
  }
  mod._compile(code, abs)
  cache.set(abs, mod.exports)
  return mod.exports
}

const { buildChatHistoryForInvoke } = compile(join(root, 'src/lib/agentChatMemory.ts'))
const { AGENTS_WELCOME_MESSAGE } = compile(
  join(root, 'src/lib/agentsApi.ts'),
  [
    "export const AGENTS_WELCOME_MESSAGE = 'Research for this project is ready.';",
    "export function isAgentsWelcomeMessage(content) {",
    "  const text = String(content || '').trim();",
    "  if (text === AGENTS_WELCOME_MESSAGE) return true;",
    "  if (text.includes(AGENTS_WELCOME_MESSAGE) && /^Good (morning|afternoon|evening|Morning|Afternoon|Evening),/.test(text)) return true;",
    "  return /^Good (morning|afternoon|evening|Morning|Afternoon|Evening),\\s+.+/.test(text) && !text.includes('\\n') && text.length < 80;",
    "}",
    "export type AgentType = 'chatbot' | 'linkedin' | 'instagram' | 'playbook' | 'twitter';",
  ].join('\n'),
)

const personalizedWelcome = 'Good morning, Ada'

const hist = buildChatHistoryForInvoke([
  { role: 'assistant', content: AGENTS_WELCOME_MESSAGE, agentType: 'chatbot' },
  { role: 'assistant', content: personalizedWelcome, agentType: 'chatbot' },
  { role: 'assistant', content: 'Good Morning, Ada! Research for this project is ready.', agentType: 'chatbot' },
  { role: 'user', content: 'I sell poetry' },
  { role: 'assistant', content: 'Try carousels', agentType: 'chatbot' },
  {
    role: 'assistant',
    content: '',
    agentType: 'linkedin',
    output: {
      agent: 'linkedin',
      post_ideas: [{ topic: 'Founder story', hook: 'I almost quit' }],
    },
  },
  { role: 'user', content: 'and Reels?' },
])

assert.equal(hist[0].content, 'I sell poetry')
assert.ok(hist.some((t) => t.content.includes('carousels') || t.content.includes('Founder')))
assert.equal(hist[hist.length - 1].content, 'and Reels?')
assert.ok(!hist.some((t) => t.content === AGENTS_WELCOME_MESSAGE))
assert.ok(!hist.some((t) => t.content === personalizedWelcome))
assert.ok(!hist.some((t) => t.content.startsWith('Good Morning, Ada!')))
console.log('OK frontend chat memory builder')
