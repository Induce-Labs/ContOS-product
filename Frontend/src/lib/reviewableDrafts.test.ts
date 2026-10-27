import { describe, expect, it } from 'vitest'
import { buildChatHistoryForInvoke } from './agentChatMemory'
import { PostizApiError } from './postiz'
import {
  acceptRevision,
  collectReviewPosts,
  extractRevision,
  hideReviewPost,
  literalReplacement,
  messageQualifiesForDrafts,
  patchReviewPost,
  preserveReviewPosts,
  requestedDraftDayCount,
  requestedDraftPostCount,
  scheduleSkipReason,
  stampMissingReviewPosts,
  stampReviewPosts,
  type DraftMessage,
  type ReviewPost,
} from './reviewableDrafts'
import {
  commitReviewPost,
  commitReviewPosts,
  createdPostId,
  isAmbiguousPostizError,
  matchListedPost,
  postizRequestFromReview,
} from './draftSchedule'

function ids() {
  let n = 0
  return () => `post-${++n}`
}

function withRequest(messages: DraftMessage[], request = 'Write 3 days of posts'): DraftMessage[] {
  return [{ id: 'ask', role: 'user', content: request }, ...messages]
}

function assistant(output: unknown, id = 'm1'): DraftMessage {
  return { id, role: 'assistant', content: 'done', agentType: 'linkedin', output }
}

describe('stampReviewPosts', () => {
  it('turns two LinkedIn bodies in one message into separate posts', () => {
    const stamped = stampReviewPosts(
      assistant({
        post_ideas: [
          { post_structure: 'First body', date: '2026-10-26' },
          { post_structure: 'Second body', date: '2026-10-27' },
        ],
      }),
      ids(),
    )
    const posts = collectReviewPosts(withRequest([stamped.message]))
    expect(posts.map((post) => post.text)).toEqual(['First body', 'Second body'])
    expect(posts.map((post) => post.id)).toEqual(['post-1', 'post-2'])
    expect(posts[0]?.proposedDate).toBe('2026-10-26')
  })

  it('turns seven Instagram bodies into seven posts and ignores idea-only rows', () => {
    const calendar = Array.from({ length: 7 }, (_, index) => ({
      copy_paste_post: `Day ${index + 1} caption`,
      date: `2026-11-0${index + 1}`,
    }))
    calendar.push({ copy_paste_post: '', date: '2026-11-08' })
    const stamped = stampReviewPosts(
      { id: 'ig', role: 'assistant', content: '', agentType: 'instagram', output: { content_calendar: calendar } },
      ids(),
    )
    expect(collectReviewPosts(withRequest([stamped.message]))).toHaveLength(7)
  })

  it('keeps ids and edits when extraction runs again', () => {
    const createId = ids()
    const first = stampReviewPosts(
      assistant({ post_ideas: [{ post_structure: 'Original' }, { post_structure: 'Other' }] }),
      createId,
    ).message
    const edited = patchReviewPost([first], 'm1', 'post-1', (post) => ({ ...post, text: 'Edited' }))[0]
    const second = stampReviewPosts(edited, createId)
    expect(second.changed).toBe(false)
    expect(collectReviewPosts(withRequest([edited]))[0]).toMatchObject({
      id: 'post-1',
      text: 'Edited',
      originalText: 'Original',
    })
    expect(collectReviewPosts(withRequest([edited]))[1]?.text).toBe('Other')
  })

  it('uses one native array and does not import content_calendar on a LinkedIn reply', () => {
    const stamped = stampReviewPosts(
      assistant({
        agent: 'linkedin',
        post_ideas: [{ post_structure: 'LinkedIn body' }],
        content_calendar: [{ copy_paste_post: 'Should not appear' }],
      }),
      ids(),
    )
    expect(collectReviewPosts(withRequest([stamped.message])).map((post) => post.text)).toEqual(['LinkedIn body'])
  })

  it('keeps an X thread as one card and drops a tweet that repeats the thread', () => {
    const stamped = stampReviewPosts(
      {
        id: 'x',
        role: 'assistant',
        content: '',
        agentType: 'twitter',
        output: {
          tweet_ideas: [{ type: 'thread', full_tweet: 'One\n\nTwo' }, { full_tweet: 'Standalone' }],
          thread_structures: [{ tweets: ['One', 'Two'] }],
        },
      },
      ids(),
    )
    const posts = collectReviewPosts(withRequest([stamped.message]))
    expect(posts).toHaveLength(2)
    expect(posts.find((post) => post.source === 'thread')?.entries).toEqual(['One', 'Two'])
    expect(posts.find((post) => post.source === 'tweet_ideas')?.text).toBe('Standalone')
  })

  it('does not extract a proposal message', () => {
    const stamped = stampReviewPosts(
      {
        ...assistant({ post_ideas: [{ post_structure: 'Proposal body' }] }),
        proposalForPostId: 'post-1',
      },
      ids(),
    )
    expect(stamped.changed).toBe(false)
    expect(collectReviewPosts(withRequest([stamped.message]))).toEqual([])
  })

  it('leaves the other message reference alone when one post is edited', () => {
    const createId = ids()
    const first = stampReviewPosts(
      assistant({ post_ideas: [{ post_structure: 'A' }] }, 'm1'),
      createId,
    ).message
    const second = stampReviewPosts(
      assistant({ post_ideas: [{ post_structure: 'B' }] }, 'm2'),
      createId,
    ).message
    const next = patchReviewPost([first, second], 'm1', 'post-1', (post) => ({ ...post, text: 'A2' }))
    expect(next[1]).toBe(second)
    expect(collectReviewPosts(withRequest(next)).map((post) => post.text)).toEqual(['A2', 'B'])
    const output = next[0]?.output as { post_ideas: Array<{ post_structure: string }> }
    expect(output.post_ideas[0]?.post_structure).toBe('A2')
  })

  it('copies review posts onto a stream replacement and leaves an incoming copy alone', () => {
    const kept: ReviewPost = {
      id: 'post-1',
      messageId: 'm1',
      platform: 'linkedin',
      source: 'post_ideas',
      sourceIndex: 0,
      text: 'Kept',
      originalText: 'Kept',
      entries: null,
      originalEntries: null,
      proposedDate: null,
      media: [],
      status: 'needs_review',
      postizPostId: null,
      statusDetail: null,
    }
    const previous = { reply: 'old', review_posts: [kept] }
    const replaced = preserveReviewPosts(previous, { reply: 'new' }) as { review_posts: ReviewPost[] }
    expect(replaced.review_posts).toEqual([kept])
    expect(preserveReviewPosts(previous, { review_posts: [{ ...kept, text: 'Incoming' }] })).toEqual({
      review_posts: [{ ...kept, text: 'Incoming' }],
    })
  })

  it('returns the same array when nothing needs an id', () => {
    const messages = [assistant({ ideas: ['no body'] })]
    const stamped = stampMissingReviewPosts(messages, ids())
    expect(stamped.changed).toBe(false)
    expect(stamped.messages).toBe(messages)
  })

  it('stamps a 2-day or week request and leaves a single day or a month in the chat only', () => {
    const output = {
      post_ideas: [{ post_structure: 'One' }, { post_structure: 'Two' }],
    }
    const week = stampMissingReviewPosts(
      [
        { id: 'u', role: 'user', content: 'Plan a week of posts' },
        assistant(output, 'week'),
      ],
      ids(),
    )
    const twoDays = stampMissingReviewPosts(
      [
        { id: 'u2', role: 'user', content: 'Write 2 days of content' },
        assistant(output, 'two'),
      ],
      ids(),
    )
    const oneDay = stampMissingReviewPosts(
      [
        { id: 'u3', role: 'user', content: 'Write 1 day of content' },
        assistant(output, 'one'),
      ],
      ids(),
    )
    const month = stampMissingReviewPosts(
      [
        { id: 'u4', role: 'user', content: 'Plan the whole month' },
        assistant(output, 'month'),
      ],
      ids(),
    )
    expect(collectReviewPosts(week.messages).map((post) => post.text)).toEqual(['One', 'Two'])
    expect(collectReviewPosts(twoDays.messages)).toHaveLength(2)
    expect(oneDay.changed).toBe(false)
    expect(collectReviewPosts(oneDay.messages)).toEqual([])
    expect(month.changed).toBe(false)
    expect(collectReviewPosts(month.messages)).toEqual([])
    expect(messageQualifiesForDrafts(week.messages, 1)).toBe(true)
    expect(requestedDraftDayCount('seven days of linkedin posts')).toBe(7)
  })

  it('stamps a request for more than one post and leaves a single post or post ideas in the chat', () => {
    const output = {
      post_ideas: [{ post_structure: 'One' }, { post_structure: 'Two' }],
    }
    const five = stampMissingReviewPosts(
      [
        { id: 'u', role: 'user', content: 'Give me 5 posts' },
        assistant(output, 'five'),
      ],
      ids(),
    )
    const fiveLinkedIn = stampMissingReviewPosts(
      [
        { id: 'u2', role: 'user', content: 'Write five linkedin posts' },
        assistant(output, 'linkedin'),
      ],
      ids(),
    )
    const onePost = stampMissingReviewPosts(
      [
        { id: 'u3', role: 'user', content: 'Write 1 post' },
        assistant(output, 'one'),
      ],
      ids(),
    )
    const ideas = stampMissingReviewPosts(
      [
        { id: 'u4', role: 'user', content: 'Give me 5 post ideas' },
        assistant(output, 'ideas'),
      ],
      ids(),
    )
    expect(collectReviewPosts(five.messages).map((post) => post.text)).toEqual(['One', 'Two'])
    expect(collectReviewPosts(fiveLinkedIn.messages)).toHaveLength(2)
    expect(onePost.changed).toBe(false)
    expect(collectReviewPosts(onePost.messages)).toEqual([])
    expect(ideas.changed).toBe(false)
    expect(collectReviewPosts(ideas.messages)).toEqual([])
    expect(requestedDraftPostCount('Give me 10 posts')).toBe(10)
    expect(requestedDraftPostCount('a couple of posts')).toBe(2)
    expect(requestedDraftPostCount('one post')).toBeNull()
  })

  it('keeps a hidden card hidden and leaves a welcome-only thread empty', () => {
    const createId = ids()
    const thread: DraftMessage[] = [
      { id: 'u', role: 'user', content: 'Give me 4 days of posts' },
      assistant({ post_ideas: [{ post_structure: 'Keep' }, { post_structure: 'Drop' }] }),
    ]
    const stamped = stampMissingReviewPosts(thread, createId)
    const hidden = hideReviewPost(stamped.messages, 'm1', 'post-2')
    const again = stampMissingReviewPosts(hidden, createId)
    expect(again.changed).toBe(false)
    expect(collectReviewPosts(again.messages).map((post) => post.text)).toEqual(['Keep'])
    expect(collectReviewPosts([{ id: 'welcome', role: 'assistant', content: 'Hello' }])).toEqual([])
  })
})

describe('revisions', () => {
  const post: ReviewPost = {
    id: 'post-1',
    messageId: 'm1',
    platform: 'linkedin',
    source: 'post_ideas',
    sourceIndex: 0,
    text: 'Current',
    originalText: 'Original',
    entries: null,
    originalEntries: null,
    proposedDate: null,
    media: [{ id: 'media-1', path: '/a.png', alt: null, thumbnail: null, name: null, original_name: null }],
    status: 'needs_review',
    postizPostId: null,
    statusDetail: null,
  }

  it('accepts one clean body and keeps media and the original', () => {
    const revision = extractRevision({ post_ideas: [{ post_structure: 'Replacement' }] }, 'linkedin')
    expect(revision).toEqual({ text: 'Replacement', entries: null })
    const accepted = acceptRevision(post, revision!)
    expect(accepted.text).toBe('Replacement')
    expect(accepted.originalText).toBe('Original')
    expect(accepted.media).toEqual(post.media)
  })

  it('leaves a rejected revision out of history and off the source post', () => {
    const history = buildChatHistoryForInvoke([
      { role: 'user', content: 'Write a post', agentType: 'linkedin' },
      { role: 'assistant', content: 'Draft', agentType: 'linkedin', output: { reply: 'Draft' } },
      { role: 'user', content: 'Make it shorter', agentType: 'linkedin' },
      {
        role: 'assistant',
        content: 'Shorter',
        agentType: 'linkedin',
        proposalForPostId: 'post-1',
        output: { post_ideas: [{ post_structure: 'Shorter' }] },
      },
    ])
    expect(history.map((turn) => turn.content)).toEqual(['Write a post', 'Draft'])
    expect(post.text).toBe('Current')
  })

  it('reads one post from a JSON string when only the hook was filled', () => {
    const raw = JSON.stringify({
      agent: 'linkedin',
      reply: 'Here is the revised post with a more formal tone.',
      post_ideas: [{ hook: 'Formal line.\n\nSecond line.', post_structure: '' }],
    })
    expect(extractRevision(raw, 'linkedin')).toEqual({
      text: 'Formal line.\n\nSecond line.',
      entries: null,
    })
  })

  it('reads the post inside a failed-parse wrapper', () => {
    const inner = JSON.stringify({ post_ideas: [{ post_structure: 'Replacement' }] })
    expect(
      extractRevision({ agent: 'linkedin', display_text: inner, post_ideas: [] }, 'linkedin'),
    ).toEqual({ text: 'Replacement', entries: null })
  })

  it('reads the post when another JSON fragment follows the object', () => {
    const raw = `${JSON.stringify({
      post_ideas: [{ post_structure: 'Formal post' }],
    })},{"extra":true}`
    expect(extractRevision(raw, 'linkedin')).toEqual({ text: 'Formal post', entries: null })
  })

  it('recovers a post from a truncated JSON payload', () => {
    const raw = JSON.stringify({
      post_ideas: [{ hook: 'Formal line.\n\nSecond line.', post_structure: '' }],
    })
    expect(extractRevision(raw.slice(0, raw.length - 6), 'linkedin')?.text).toBe(
      'Formal line.\n\nSecond line.',
    )
  })

  it('rejects commentary, empty text, and extra posts', () => {
    expect(extractRevision({ reply: 'Here is a better post: Hello' }, 'linkedin')).toBeNull()
    expect(extractRevision({ post_ideas: [{ post_structure: '   ' }] }, 'linkedin')).toBeNull()
    expect(
      extractRevision(
        { post_ideas: [{ post_structure: 'One' }, { post_structure: 'Two' }] },
        'linkedin',
      ),
    ).toBeNull()
    expect(extractRevision({ tweet_ideas: [{ full_tweet: 'x'.repeat(281) }] }, 'x')).toBeNull()
  })

  it('writes an accepted revision into the post the sidebar reads', () => {
    const stamped = stampReviewPosts(
      assistant({ post_ideas: [{ post_structure: 'Current' }] }),
      ids(),
    ).message
    const [post] = collectReviewPosts(withRequest([stamped]))
    expect(post?.text).toBe('Current')
    const next = patchReviewPost([stamped], post!.messageId, post!.id, (item) =>
      acceptRevision(item, { text: 'Replacement', entries: null }),
    )
    expect(collectReviewPosts(withRequest(next))[0]?.text).toBe('Replacement')
    const output = next[0]?.output as { post_ideas: Array<{ post_structure: string }> }
    expect(output.post_ideas[0]?.post_structure).toBe('Replacement')
  })

  it('applies an explicit replacement only when that phrase is in the post', () => {
    expect(literalReplacement(post, 'change Current to Replacement')).toEqual({
      text: 'Replacement',
      entries: null,
    })
    expect(literalReplacement(post, 'replace "Current" with "Replacement"')).toEqual({
      text: 'Replacement',
      entries: null,
    })
    expect(literalReplacement(post, 'make Current say Replacement')).toEqual({
      text: 'Replacement',
      entries: null,
    })
    expect(literalReplacement(post, 'change Missing to Replacement')).toBeNull()
    expect(literalReplacement(post, 'please make this warmer')).toBeNull()
  })

  it('replaces a phrase inside one tweet and leaves the other tweet', () => {
    const thread: ReviewPost = { ...post, platform: 'x', text: 'Keep this\n\nChange me', entries: ['Keep this', 'Change me'] }
    expect(literalReplacement(thread, 'change Change me to Done')).toEqual({
      text: 'Keep this\n\nDone',
      entries: ['Keep this', 'Done'],
    })
  })

  it('rejects an X thread revision that would drop a tweet over the limit', () => {
    expect(
      extractRevision({ thread_structures: [{ tweets: ['ok', 'x'.repeat(281)] }] }, 'x'),
    ).toBeNull()
    expect(extractRevision({ thread_structures: [{ tweets: ['One', 'Two'] }] }, 'x')).toEqual({
      text: 'One\n\nTwo',
      entries: ['One', 'Two'],
    })
  })
})

describe('schedule decisions', () => {
  const now = new Date('2026-10-25T12:00:00')
  const post: ReviewPost = {
    id: 'post-1',
    messageId: 'm1',
    platform: 'linkedin',
    source: 'post_ideas',
    sourceIndex: 0,
    text: 'Body',
    originalText: 'Body',
    entries: null,
    originalEntries: null,
    proposedDate: '2026-10-26',
    media: [],
    status: 'needs_review',
    postizPostId: null,
    statusDetail: null,
  }

  it('requires a time when the agent only supplied a date', () => {
    expect(scheduleSkipReason(post, '', now)).toBe('needs_time')
    expect(scheduleSkipReason(post, '2026-10-26', now)).toBe('needs_time')
  })

  it('skips past and invalid datetimes and Instagram', () => {
    expect(scheduleSkipReason(post, '2026-10-25T11:00', now)).toBe('past')
    expect(scheduleSkipReason(post, 'not-a-date', now)).toBe('needs_time')
    expect(scheduleSkipReason({ ...post, platform: 'instagram' }, '2026-10-26T09:00', now)).toBe('instagram')
  })

  it('does not create again after a timeout when the calendar has one match', async () => {
    let creates = 0
    const row = await commitReviewPost({
      post: { ...post, status: 'uncertain' },
      localDateTime: '2026-10-26T09:00',
      now,
      mode: 'schedule',
      create: async () => {
        creates += 1
        return { id: 'should-not-run' }
      },
      list: async () => [{ id: 'found', content: 'Body', state: 'QUEUE' }],
    })
    expect(creates).toBe(0)
    expect(row.outcome).toBe('succeeded')
    expect(row.post.postizPostId).toBe('found')
    expect(row.post.status).toBe('scheduled')
  })

  it('stays uncertain and does not create when the timeout match is ambiguous or the list fails', async () => {
    let creates = 0
    const create = async () => {
      creates += 1
      return { id: 'new' }
    }
    const many = await commitReviewPost({
      post: { ...post, status: 'uncertain' },
      localDateTime: '2026-10-26T09:00',
      now,
      mode: 'schedule',
      create,
      list: async () => [
        { id: 'a', content: 'Body', state: 'QUEUE' },
        { id: 'b', content: 'Body', state: 'DRAFT' },
      ],
    })
    const listed = await commitReviewPost({
      post: { ...post, status: 'uncertain' },
      localDateTime: '2026-10-26T09:00',
      now,
      mode: 'schedule',
      create,
      list: async () => {
        throw new PostizApiError('list failed', 500)
      },
    })
    expect(creates).toBe(0)
    expect(many.outcome).toBe('uncertain')
    expect(listed.outcome).toBe('uncertain')
  })

  it('marks a 4xx as failed and a confirmed create as scheduled', async () => {
    const failed = await commitReviewPost({
      post,
      localDateTime: '2026-10-26T09:00',
      now,
      mode: 'schedule',
      create: async () => {
        throw new PostizApiError('content must not be blank', 400)
      },
      list: async () => [],
    })
    const ok = await commitReviewPost({
      post,
      localDateTime: '2026-10-26T09:00',
      now,
      mode: 'schedule',
      create: async () => ({ post: { id: 'p1' } }),
      list: async () => [],
    })
    expect(failed.outcome).toBe('failed')
    expect(failed.post.status).not.toBe('scheduled')
    expect(ok.post).toMatchObject({ status: 'scheduled', postizPostId: 'p1' })
  })

  it('reports schedule-all outcomes separately and skips a second pass of the same id', async () => {
    const later = '2026-10-26T09:00'
    const report = await commitReviewPosts({
      now,
      mode: 'schedule',
      posts: [
        { post, localDateTime: later },
        { post, localDateTime: later },
        { post: { ...post, id: 'past', text: 'Past' }, localDateTime: '2026-10-20T09:00' },
        { post: { ...post, id: 'ig', platform: 'instagram', text: 'IG' }, localDateTime: later },
      ],
      create: async (item) => {
        if (item.id === 'post-1') throw new PostizApiError('gateway', 502)
        return { id: 'unused' }
      },
      list: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    expect(report.uncertain.map((row) => row.post.id)).toEqual(['post-1'])
    expect(report.skipped.map((row) => row.reason)).toEqual(['duplicate', 'past', 'instagram'])
    expect(report.succeeded).toEqual([])
    expect(report.failed).toEqual([])
  })

  it('sends a new X thread as ordered posts and an update as the first tweet only', () => {
    const thread: ReviewPost = {
      ...post,
      platform: 'x',
      source: 'thread',
      text: 'One\n\nTwo',
      entries: ['One', 'Two'],
      originalEntries: ['One', 'Two'],
    }
    expect(postizRequestFromReview(thread, '2026-10-26T09:00+05:30', 'schedule')).toMatchObject({
      type: 'schedule',
      content: 'One',
      posts: [{ content: 'One' }, { content: 'Two' }],
    })
    expect(
      postizRequestFromReview({ ...thread, postizPostId: 'existing' }, '2026-10-26T09:00+05:30', 'schedule'),
    ).toMatchObject({ type: 'update', postId: 'existing', posts: undefined, threadUpdateLimited: true })
    expect(postizRequestFromReview({ ...post, platform: 'instagram' }, '2026-10-26T09:00+05:30', 'draft')).toBeNull()
  })

  it('reads a post id from the shapes Postiz has returned', () => {
    expect(createdPostId({ id: 'a' })).toBe('a')
    expect(createdPostId({ post: { id: 'b' } })).toBe('b')
    expect(createdPostId({ posts: [{ id: 'c' }] })).toBe('c')
    expect(createdPostId({ ok: true })).toBeNull()
    expect(isAmbiguousPostizError(new PostizApiError('down', 503))).toBe(true)
    expect(isAmbiguousPostizError(new PostizApiError('no', 400))).toBe(false)
    expect(isAmbiguousPostizError(new TypeError('Failed to fetch'))).toBe(true)
    expect(matchListedPost([{ id: '1', content: 'Body', state: 'DRAFT' }], '  Body ')).toEqual({
      kind: 'one',
      id: '1',
      state: 'DRAFT',
    })
  })
})
