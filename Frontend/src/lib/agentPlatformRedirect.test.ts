import { describe, expect, it } from 'vitest'
import { detectExplicitSwitchRequest } from './agentPlatformRedirect'

describe('detectExplicitSwitchRequest', () => {
  it.each([
    ['switch to instagram agent', 'instagram'],
    ['Switch to Instagram agent', 'instagram'],
    ['switch to the linkedin agent', 'linkedin'],
    ['please switch me to X', 'twitter'],
    ['can you switch to twitter agent?', 'twitter'],
    ['go to instagram', 'instagram'],
    ['change to linkedin agent please', 'linkedin'],
    ['take me to the instagram agent', 'instagram'],
    ['use the linkedin agent', 'linkedin'],
    ['open instagram agent', 'instagram'],
    ['ok, switch to ig', 'instagram'],
  ])('%s -> %s', (text, expected) => {
    expect(detectExplicitSwitchRequest(text)).toBe(expected)
  })

  it.each([
    'instagram',
    'x',
    'write a linkedin post about coffee',
    'switch to instagram agent and write me a caption',
    'how is instagram different from linkedin?',
    'what should I use x for',
    'use instagram',
    'I want to switch my brand voice to bolder',
    '',
  ])('does not switch on: %s', (text) => {
    expect(detectExplicitSwitchRequest(text)).toBeNull()
  })
})
