import { describe, expect, it } from 'vitest'
import { parseChatMessage } from './chatMessageFormat'

describe('parseChatMessage', () => {
  it('keeps a short reply as one plain paragraph', () => {
    const blocks = parseChatMessage('Great question. Two sentences, and no list.')
    expect(blocks).toEqual([
      {
        kind: 'paragraph',
        inlines: [{ kind: 'text', value: 'Great question. Two sentences, and no list.' }],
      },
    ])
  })

  it('turns closed bold into strong and numbered lines into one list', () => {
    const blocks = parseChatMessage('1. **Lead.** The rest\n2. Second item')
    expect(blocks).toEqual([
      {
        kind: 'ol',
        start: 1,
        items: [
          [
            { kind: 'strong', value: 'Lead.' },
            { kind: 'text', value: ' The rest' },
          ],
          [{ kind: 'text', value: 'Second item' }],
        ],
      },
    ])
  })

  it('keeps numbered items separated by blank lines in one list that starts at the first number', () => {
    const blocks = parseChatMessage('3. Alpha\n\n4. Beta')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      kind: 'ol',
      start: 3,
      items: [[{ kind: 'text', value: 'Alpha' }], [{ kind: 'text', value: 'Beta' }]],
    })
  })

  it('leaves an unclosed bold marker and a dangling list marker as plain text', () => {
    const blocks = parseChatMessage('See **done** now\n\n**still open\n\n1. Ready\n\n2.')
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      inlines: [
        { kind: 'text', value: 'See ' },
        { kind: 'strong', value: 'done' },
        { kind: 'text', value: ' now' },
      ],
    })
    expect(blocks[1]).toEqual({
      kind: 'paragraph',
      inlines: [{ kind: 'text', value: '**still open' }],
    })
    expect(blocks[2]).toMatchObject({ kind: 'ol', start: 1 })
    expect(blocks[3]).toEqual({
      kind: 'paragraph',
      inlines: [{ kind: 'text', value: '2.' }],
    })
  })

  it('keeps a lone list marker plain until item text arrives', () => {
    expect(parseChatMessage('1.')).toEqual([
      { kind: 'paragraph', inlines: [{ kind: 'text', value: '1.' }] },
    ])
    expect(parseChatMessage('1')).toEqual([
      { kind: 'paragraph', inlines: [{ kind: 'text', value: '1' }] },
    ])
  })

  it('turns a bold-only line and a hash heading into headings, and dashes into a list', () => {
    const blocks = parseChatMessage('**This week**\n\n# Detail\n\n- First\n- Second')
    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'heading', 'ul'])
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 4, text: 'This week' })
    expect(blocks[1]).toMatchObject({ kind: 'heading', level: 3, text: 'Detail' })
    expect(blocks[2]).toMatchObject({
      kind: 'ul',
      items: [[{ kind: 'text', value: 'First' }], [{ kind: 'text', value: 'Second' }]],
    })
  })
})
