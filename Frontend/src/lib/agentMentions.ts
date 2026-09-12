/** Resolve @avatar mentions in Agents chat against the user's real avatars. */

export type MentionableAvatar = {
  id: string
  name: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Avatar IDs mentioned as @Name in the message (longest name wins). */
export function parseMentionedAvatarIds(
  messageText: string,
  avatars: MentionableAvatar[],
): string[] {
  const text = messageText.trim()
  if (!text || avatars.length === 0) {
    return []
  }

  const ranked = [...avatars]
    .filter((avatar) => avatar.name.trim())
    .sort((left, right) => right.name.trim().length - left.name.trim().length)

  const found: string[] = []
  for (const avatar of ranked) {
    const name = avatar.name.trim()
    const pattern = new RegExp(`@${escapeRegExp(name)}\\b`, 'i')
    if (pattern.test(text) && !found.includes(avatar.id)) {
      found.push(avatar.id)
    }
  }
  return found
}

/**
 * Active chat avatar plus every chip/@mention.
 * Tagged avatars add context; they do not replace the current avatar.
 */
export function resolveInvokeTaggedAvatarIds(options: {
  activeAvatarId: string
  selectedIds: string[]
  messageText: string
  avatars: MentionableAvatar[]
}): string[] {
  const known = new Set(options.avatars.map((avatar) => avatar.id))
  const ordered: string[] = []

  const push = (id: string) => {
    if (!id || !known.has(id) || ordered.includes(id)) {
      return
    }
    ordered.push(id)
  }

  push(options.activeAvatarId)
  for (const id of options.selectedIds) {
    push(id)
  }
  for (const id of parseMentionedAvatarIds(options.messageText, options.avatars)) {
    push(id)
  }
  return ordered
}
