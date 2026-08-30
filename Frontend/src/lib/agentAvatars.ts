/** Mock ContOS avatars — personal + two businesses (client-side demo pack). */

export type AvatarId = 'avatar_personal' | 'avatar_business_1' | 'avatar_business_2'

export type AvatarProfile = {
  id: AvatarId
  label: string
  role: 'personal' | 'business'
  /** Display initials for the chip avatar */
  initials: string
  business_name: string
  brand_voice: string
  target_audience: string
  goals: string
  industry: string
  bio?: string
  platforms?: string[]
  offers?: string[]
}

export const MOCK_AVATARS: AvatarProfile[] = [
  {
    id: 'avatar_personal',
    label: 'Personal',
    role: 'personal',
    initials: 'SA',
    business_name: 'Sara Al-Rashid',
    brand_voice:
      'Warm, reflective, and poetic. Speaks in short memorable lines. Blends personal story with cultural roots without sounding preachy.',
    target_audience:
      'Young professionals and creatives (22–35) who follow poetry, mindfulness, and Arabic-English bilingual culture content.',
    goals:
      'Grow a personal poetry brand, build trust through consistent voice, and convert followers into a newsletter / workshop waitlist.',
    industry: 'Personal branding / Poetry & culture',
    bio: 'Poet and essayist sharing bilingual reflections on resilience, faith, and everyday beauty.',
    platforms: ['instagram', 'linkedin', 'twitter'],
  },
  {
    id: 'avatar_business_1',
    label: 'Business 1',
    role: 'business',
    initials: 'NL',
    business_name: 'NovaLedger',
    brand_voice:
      'Clear, confident, and practitioner-first. Avoid buzzwords. Speak like a sharp operator who respects the founder’s time.',
    target_audience:
      'Series A–B B2B SaaS founders and heads of growth who need consistent multi-platform content without a full-time CMO.',
    goals:
      'Build category authority, convert competitor audience attention into pipeline, and ship platform-native content weekly.',
    industry: 'B2B SaaS / Marketing Technology',
    offers: ['Fractional CMO', 'Content systems', 'Competitor intelligence briefs'],
  },
  {
    id: 'avatar_business_2',
    label: 'Business 2',
    role: 'business',
    initials: 'HC',
    business_name: 'HarborCraft Coffee',
    brand_voice:
      'Cozy, community-first, and sensory. Celebrates craft without pretension. Invites people into the café story.',
    target_audience:
      'Local coffee lovers, remote workers, and weekend explorers ages 25–45 within a 10-mile radius of downtown locations.',
    goals:
      'Drive foot traffic, grow Instagram community, and launch seasonal drink campaigns that feel shareable.',
    industry: 'Food & beverage / Specialty coffee',
    offers: ['Seasonal drinks', 'Loyalty program', 'Café events'],
  },
]

export const AVATAR_IDS: AvatarId[] = MOCK_AVATARS.map((a) => a.id)

const MENTION_MAP: Record<string, AvatarId> = {
  personal: 'avatar_personal',
  '@personal': 'avatar_personal',
  business1: 'avatar_business_1',
  'business 1': 'avatar_business_1',
  '@business1': 'avatar_business_1',
  business2: 'avatar_business_2',
  'business 2': 'avatar_business_2',
  '@business2': 'avatar_business_2',
}

export function getAvatarById(id: string): AvatarProfile | undefined {
  return MOCK_AVATARS.find((a) => a.id === id)
}

export function resolveAvatarProfiles(ids: string[]): AvatarProfile[] {
  const unique = [...new Set(ids)]
  return unique
    .map((id) => getAvatarById(id))
    .filter((a): a is AvatarProfile => Boolean(a))
}

/** Merge chip selection with @mentions in the message text. */
export function resolveTaggedAvatarIds(
  selectedIds: string[],
  messageText: string,
): AvatarId[] {
  const found = new Set<AvatarId>()
  for (const id of selectedIds) {
    if (AVATAR_IDS.includes(id as AvatarId)) {
      found.add(id as AvatarId)
    }
  }
  const lower = messageText.toLowerCase()
  for (const [token, id] of Object.entries(MENTION_MAP)) {
    if (lower.includes(token.startsWith('@') ? token : `@${token}`) || lower.includes(`@${token}`)) {
      found.add(id)
    }
  }
  // Also match bare @Personal / @Business1 style labels
  if (/\b@personal\b/i.test(messageText)) found.add('avatar_personal')
  if (/\b@business[_\s-]?1\b/i.test(messageText)) found.add('avatar_business_1')
  if (/\b@business[_\s-]?2\b/i.test(messageText)) found.add('avatar_business_2')
  return AVATAR_IDS.filter((id) => found.has(id))
}

export function toggleAvatarId(current: string[], id: AvatarId): string[] {
  return current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
}
