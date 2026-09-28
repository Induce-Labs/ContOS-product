export type XThreadDraft = {
  localId: string
  content: string
}

let threadDraftSeq = 0

export function createXThreadDraft(content = ''): XThreadDraft {
  threadDraftSeq += 1
  return { localId: `x-thread-${threadDraftSeq}`, content }
}

export function addXThreadEntry(entries: readonly XThreadDraft[]): XThreadDraft[] {
  return [...entries, createXThreadDraft()]
}

export function removeXThreadEntry(
  entries: readonly XThreadDraft[],
  index: number,
): XThreadDraft[] {
  if (entries.length <= 1 || index < 0 || index >= entries.length) {
    return [...entries]
  }
  return entries.filter((_, entryIndex) => entryIndex !== index)
}

export function moveXThreadEntry(
  entries: readonly XThreadDraft[],
  index: number,
  direction: -1 | 1,
): XThreadDraft[] {
  const target = index + direction
  if (index < 0 || index >= entries.length || target < 0 || target >= entries.length) {
    return [...entries]
  }
  const next = [...entries]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}
