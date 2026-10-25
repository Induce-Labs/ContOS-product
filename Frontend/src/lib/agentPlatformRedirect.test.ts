import { describe, expect, it } from 'vitest'
import {
  detectExplicitSwitchRequest,
  detectNamedPlatforms,
  detectSingleNamedPlatform,
  multiPlanPlatforms,
  redirectTarget,
} from './agentPlatformRedirect'

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

describe('detectSingleNamedPlatform', () => {
  it.each([
    ['write a linkedin post about coffee', 'linkedin'],
    ['draft an Instagram carousel', 'instagram'],
    ['tweet about launch on twitter', 'twitter'],
    ['post this on x please', 'twitter'],
    ['ig caption ideas', 'instagram'],
  ])('%s -> %s', (text, expected) => {
    expect(detectSingleNamedPlatform(text)).toBe(expected)
  })

  it.each([
    'how is instagram different from linkedin?',
    'linkedin and twitter calendar',
    'I want to switch my brand voice to bolder',
    '',
  ])('returns null for: %s', (text) => {
    expect(detectSingleNamedPlatform(text)).toBeNull()
  })
})

describe('detectNamedPlatforms', () => {
  it('returns platforms in plan order', () => {
    expect(detectNamedPlatforms('linkedin and twitter calendar')).toEqual(['linkedin', 'twitter'])
    expect(detectNamedPlatforms('draft instagram and linkedin and x')).toEqual([
      'linkedin',
      'instagram',
      'twitter',
    ])
  })

  it('returns one platform or none', () => {
    expect(detectNamedPlatforms('write a linkedin post')).toEqual(['linkedin'])
    expect(detectNamedPlatforms('what should I post this week')).toEqual([])
    expect(detectNamedPlatforms('')).toEqual([])
  })
})

describe('redirectTarget', () => {
  it('switches off the current content agent when one other platform is named', () => {
    expect(redirectTarget('twitter', 'can u give me ideas for instagram content?')).toBe(
      'instagram',
    )
    expect(redirectTarget('twitter', 'can u give me 1 week worth of content for linkedin')).toBe(
      'linkedin',
    )
    expect(redirectTarget('linkedin', 'post this on x please')).toBe('twitter')
    expect(redirectTarget('instagram', 'draft a linkedin post')).toBe('linkedin')
  })

  it('stays put for the same platform, two platforms, or no platform', () => {
    expect(redirectTarget('instagram', 'ideas for instagram content')).toBeNull()
    expect(redirectTarget('twitter', 'linkedin and instagram ideas')).toBeNull()
    expect(redirectTarget('linkedin', 'what should I post this week')).toBeNull()
    expect(redirectTarget('chatbot', 'can u give me ideas for instagram content?')).toBeNull()
  })
})

describe('multiPlanPlatforms', () => {
  it('returns two or more platforms in plan order from Chat or a content agent', () => {
    expect(multiPlanPlatforms('twitter', 'linkedin and instagram ideas')).toEqual([
      'linkedin',
      'instagram',
    ])
    expect(multiPlanPlatforms('chatbot', 'draft instagram and linkedin and x')).toEqual([
      'linkedin',
      'instagram',
      'twitter',
    ])
    expect(multiPlanPlatforms('linkedin', 'instagram and x this week')).toEqual([
      'instagram',
      'twitter',
    ])
  })

  it('returns null for one platform, none, or playbook', () => {
    expect(multiPlanPlatforms('twitter', 'ideas for instagram content')).toBeNull()
    expect(multiPlanPlatforms('linkedin', '')).toBeNull()
    expect(multiPlanPlatforms('playbook', 'linkedin and instagram')).toBeNull()
  })
})
