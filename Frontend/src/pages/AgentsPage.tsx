import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { avatarTypeLabel, MAX_AVATARS } from '../lib/avatars'
import { fetchCompetitorsForProject, type Competitor } from '../lib/competitors'
import type { Project } from '../lib/projects'
import { DashboardLayout } from '../components/dashboard/DashboardLayout'
import { IncompleteProfilingBanner } from '../components/dashboard/IncompleteProfilingBanner'
import {
  AgentTypePills,
} from '../components/agents/AgentChatHistoryPanel'
import { useDashboardShell } from '../hooks/useDashboardShell'
import { logDevError, userFacingMessage } from '../lib/devLog'
import {
  AgentsApiError,
  getUserFirstName,
  isAgentsWelcomeMessage,
  isUiAgentType,
  type AgentType,
} from '../lib/agentsApi'
import {
  abortActiveAgentStream,
  getActiveAgentStream,
  getPendingAgentCatchUp,
  runAgentStream,
  startAgentStreamCatchUpListeners,
  subscribeActiveAgentStream,
} from '../lib/agentStreamRuntime'
import {
  formatStructuredAgentOutput,
  isStructuredAgentOutput,
} from '../lib/agentOutputDisplay'
import {
  detectExplicitSwitchRequest,
  detectPlatformFromRedirectAsk,
  detectPlatformRedirectRequest,
  detectSingleNamedPlatform,
  isAffirmativeReply,
  isNegativeReply,
  multiPlanPlatforms,
  platformLabel,
  redirectTarget,
  type PlatformAgent,
} from '../lib/agentPlatformRedirect'
import {
  confirmSuggestions,
  isConfirmMessage,
  outputHasSuggestions,
} from '../lib/draftSuggestions'
import { commitReviewPost, postizRequestFromReview, type ScheduleRow } from '../lib/draftSchedule'
import { createPostizPost, listPostizPosts, PostizApiError } from '../lib/postiz'
import {
  acceptRevision,
  collectReviewPosts,
  draftPreviewText,
  extractRevision,
  hideReviewPost,
  literalReplacement,
  parseAgentPayload,
  patchReviewPost,
  preserveReviewPosts,
  refineInstruction,
  reviewPlatformForAgent,
  stampMissingReviewPosts,
  type ReviewPost,
} from '../lib/reviewableDrafts'
import contosMark from '../assets/contos-mark.png'
import contosMarkDark from '../assets/image.png'
import { AgentRespondingIndicator } from '../components/agents/AgentRespondingIndicator'
import { ChatMessageBubble } from '../components/agents/ChatMessageBubble'
import { DraftsSidebar, type AcceptedDraftRevision } from '../components/agents/DraftsSidebar'
import { buildChatHistoryForInvoke, replyTargetForMessage, userTextWithReply } from '../lib/agentChatMemory'
import type { DraftPreview, ReplyTarget } from '../lib/agentChatStorage'
import {
  collectTranscripts,
  getSpeechRecognition,
  speechFailure,
  speechLanguageTag,
  applyDictationResult,
  type DictationCursor,
  type SpeechHost,
  type SpeechRecognitionLike,
} from '../lib/speechInput'
import { resolveInvokeTaggedAvatarIds } from '../lib/agentMentions'
import { resolveUiLanguage } from '../lib/profilingLocaleCore'
import {
  fetchRemoteChatStore,
  upsertRemoteChatStore,
} from '../lib/agentChatRemote'
import {
  createEmptyStore,
  deleteChatSession,
  canPersistChatForProject,
  getActiveSession,
  loadChatStore,
  resolveChatStoreSync,
  saveChatStore,
  sessionHasUserMessages,
  startNewChatSession,
  switchChatSession,
  updateActiveSessionMessages,
  CHAT_DELETE_EVENT,
  CHAT_DELETE_REVERT_EVENT,
  type ChatDeleteEventDetail,
  type ChatStore,
  type StoredChatMessage,
} from '../lib/agentChatStorage'

type ChatRole = 'assistant' | 'user'

type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  agentType?: AgentType
  output?: unknown
  taggedAvatarIds?: string[]
  taggedAvatarNames?: string[]
  proposalForPostId?: string
  replyTo?: ReplyTarget
  draftPreview?: DraftPreview
}

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function makeWelcomeMessage(
  firstName: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): ChatMessage {
  const hour = new Date().getHours()
  const greetingKey =
    hour >= 5 && hour < 12
      ? 'agents.welcome.goodMorning'
      : hour >= 12 && hour < 17
        ? 'agents.welcome.goodAfternoon'
        : 'agents.welcome.goodEvening'
  const name = firstName.trim() || t('agents.welcome.fallbackName')
  return {
    id: newId(),
    role: 'assistant',
    content: t('agents.welcome.greeting', {
      greeting: t(greetingKey),
      name,
    }),
    agentType: 'chatbot',
  }
}

function formatAgentOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output
  }
  if (output == null) {
    return ''
  }
  const structured = formatStructuredAgentOutput(output)
  if (structured.trim()) {
    return structured
  }
  return ''
}

function tryParseStructuredContent(content: string): unknown | null {
  const parsed = parseAgentPayload(content)
  return parsed && isStructuredAgentOutput(parsed) ? parsed : null
}

function draftPlatformName(
  platform: DraftPreview['platform'],
  t: (key: string) => string,
): string {
  if (platform === 'x') return t('agents.drafts.platformX')
  if (platform === 'instagram') return t('agents.drafts.platformInstagram')
  return t('agents.drafts.platformLinkedin')
}

function resolveAssistantOutput(message: ChatMessage): unknown | null {
  if (message.output != null && isStructuredAgentOutput(message.output)) {
    return message.output
  }
  return tryParseStructuredContent(message.content)
}

export function AgentsPage() {
  const { t, i18n } = useTranslation()
  const { projectId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    user,
    projects,
    setProjects,
    activeProject,
    projectsLoading,
    isSigningOut,
    sidebarOpen,
    setSidebarOpen,
    handleSignOut,
    refreshProjects,
  } = useDashboardShell()
  const project = activeProject
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [agentType, setAgentType] = useState<AgentType>(() => {
    try {
      const pending = getPendingAgentCatchUp()
      if (isUiAgentType(pending?.agentType)) {
        return pending.agentType
      }
      const stored = sessionStorage.getItem('contos_agents_agent_type')
      if (isUiAgentType(stored)) {
        return stored
      }
    } catch {
      // ignore
    }
    return 'chatbot'
  })
  const [input, setInput] = useState('')
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null)
  const [draftTargetId, setDraftTargetId] = useState<string | null>(null)
  const [acceptedRevision, setAcceptedRevision] = useState<AcceptedDraftRevision | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatStore, setChatStore] = useState<ChatStore | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [multiPlanActive, setMultiPlanActive] = useState(false)
  const [awaitingCatchUp, setAwaitingCatchUp] = useState(() => {
    const pending = getPendingAgentCatchUp()
    return Boolean(pending)
  })
  const [sendError, setSendError] = useState<string | null>(null)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [proposal, setProposal] = useState<{
    messageId: string
    postId: string
    text: string
    entries: string[] | null
  } | null>(null)
  const [dismissedProposalIds, setDismissedProposalIds] = useState<Set<string>>(() => new Set())
  const [scheduleReport, setScheduleReport] = useState<{
    succeeded: ScheduleRow[]
    failed: ScheduleRow[]
    skipped: ScheduleRow[]
    uncertain: ScheduleRow[]
  } | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [taggedAvatarIds, setTaggedAvatarIds] = useState<string[]>([])
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [pendingPlatformRedirect, setPendingPlatformRedirect] =
    useState<PlatformAgent | null>(null)
  const messageListRef = useRef<HTMLDivElement | null>(null)
  /** True until the user scrolls away from the latest messages. */
  const stickToBottomRef = useRef(true)
  const positionedSessionRef = useRef<string | null>(null)
  const chatStoreRef = useRef<ChatStore | null>(null)
  /** Project id the in-memory store was loaded for. Persist must match the route. */
  const boundProjectIdRef = useRef<string | null>(null)
  const loadedProjectRef = useRef<string | null>(null)
  const openFreshOnLoadRef = useRef(false)
  const suppressAgentChipSyncRef = useRef(false)
  const skipPersistRef = useRef(false)
  const schedulingRef = useRef(false)
  const remoteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const dictationFieldRef = useRef('')
  const dictationCursorRef = useRef<DictationCursor>({ appliedFinals: '', lastInterim: '' })
  const dictationStopRequestedRef = useRef(false)
  const speechErrorRef = useRef<'permission' | 'empty' | 'unavailable' | 'failed' | null>(null)
  const stopDictationRef = useRef<(mode?: 'stop' | 'abort') => void>(() => {})
  const [listening, setListening] = useState(false)
  const handleNewChatRef = useRef<() => void>(() => {})
  const tRef = useRef(t)
  tRef.current = t

  const showResponding = streaming || awaitingCatchUp || multiPlanActive

  useEffect(() => {
    if (showResponding) stopDictationRef.current('abort')
  }, [showResponding])

  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current
      recognitionRef.current = null
      if (!recognition) return
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      try {
        recognition.abort()
      } catch {
        // The session was already stopped.
      }
    }
  }, [])
  const latestAssistant = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'assistant') {
        return messages[i]
      }
    }
    return null
  })()
  const hasMeaningfulAssistantContent = Boolean(
    latestAssistant &&
      (resolveAssistantOutput(latestAssistant) || latestAssistant.content.trim().length > 0),
  )
  const showWaitingIndicator = showResponding && !hasMeaningfulAssistantContent

  // Project switch: drop the previous thread before paint so it cannot be saved
  // under the new project id. A fresh session is opened once that project's store loads.
  if (projectId && loadedProjectRef.current !== projectId) {
    const previousProjectId = loadedProjectRef.current
    loadedProjectRef.current = projectId
    boundProjectIdRef.current = projectId
    if (previousProjectId != null) {
      openFreshOnLoadRef.current = true
      skipPersistRef.current = true
      chatStoreRef.current = null
      if (remoteSaveTimerRef.current) {
        clearTimeout(remoteSaveTimerRef.current)
        remoteSaveTimerRef.current = null
      }
      setMessages([])
      setChatStore(null)
      setInput('')
      setSendError(null)
      setPendingPlatformRedirect(null)
      setIsLoading(true)
      setStreaming(false)
      setAwaitingCatchUp(false)
      setMultiPlanActive(false)
      const pending = getPendingAgentCatchUp()
      if (!(pending && pending.projectId === projectId && isUiAgentType(pending.agentType))) {
        setAgentType('chatbot')
      }
    }
  }

  useEffect(() => {
    try {
      sessionStorage.setItem('contos_agents_agent_type', agentType)
    } catch {
      // ignore
    }
  }, [agentType])

  useEffect(() => {
    function onAgentTypeEvent(event: Event) {
      const detail = (event as CustomEvent<{ agentType?: AgentType }>).detail
      const next = detail?.agentType
      if (isUiAgentType(next)) {
        setPendingPlatformRedirect(null)
        setAgentType(next)
      }
    }

    window.addEventListener('contos-agent-type', onAgentTypeEvent)
    return () => window.removeEventListener('contos-agent-type', onAgentTypeEvent)
  }, [])

  useEffect(() => {
    function onNewChat() {
      handleNewChatRef.current()
    }
    window.addEventListener('contos-new-chat', onNewChat)
    return () => window.removeEventListener('contos-new-chat', onNewChat)
  }, [])

  const agentOptions: Array<{ value: AgentType; label: string }> = [
    { value: 'chatbot', label: t('agents.agentTypes.chat') },
    { value: 'linkedin', label: t('agents.agentTypes.linkedin') },
    { value: 'instagram', label: t('agents.agentTypes.instagram') },
    { value: 'twitter', label: t('agents.agentTypes.twitter') },
  ]

  function queueRemoteSave(userId: string, avatarId: string, store: ChatStore) {
    if (remoteSaveTimerRef.current) {
      clearTimeout(remoteSaveTimerRef.current)
    }
    remoteSaveTimerRef.current = setTimeout(() => {
      void upsertRemoteChatStore(userId, avatarId, store)
        .then(() => {
          setSyncError(null)
        })
        .catch((error) => {
          logDevError('agents chat sync save', {
            error: error instanceof Error ? error.message : String(error),
          })
          setSyncError(userFacingMessage(error, t('agents.syncToFailed')))
        })
    }, 600)
  }

  function applyChatStore(next: ChatStore) {
    if (remoteSaveTimerRef.current) {
      clearTimeout(remoteSaveTimerRef.current)
      remoteSaveTimerRef.current = null
    }
    skipPersistRef.current = true
    chatStoreRef.current = next
    setChatStore(next)
    setMessages(getActiveSession(next).messages as ChatMessage[])
    setSendError(null)
    if (user?.id && projectId) {
      saveChatStore(user.id, projectId, next)
    }
  }

  useEffect(() => {
    function onDelete(event: Event) {
      const detail = (event as CustomEvent<ChatDeleteEventDetail>).detail
      if (!detail || detail.projectId !== projectId || !detail.sessionId) return
      const current = chatStoreRef.current
      if (!current || !user?.id) return
      const welcome = makeWelcomeMessage(
        getUserFirstName(user),
        tRef.current,
      ) as StoredChatMessage
      const next = deleteChatSession(current, detail.sessionId, welcome)
      const live = getActiveAgentStream()
      if (
        live?.projectId === projectId &&
        current.activeSessionId === detail.sessionId
      ) {
        abortActiveAgentStream()
        setStreaming(false)
      }
      detail.previous = current
      detail.next = next
      detail.handled = true
      applyChatStore(next)
    }

    function onRevert(event: Event) {
      const detail = (event as CustomEvent<{ projectId?: string; store?: ChatStore }>).detail
      if (!detail || detail.projectId !== projectId || !detail.store) return
      applyChatStore(detail.store)
    }

    window.addEventListener(CHAT_DELETE_EVENT, onDelete)
    window.addEventListener(CHAT_DELETE_REVERT_EVENT, onRevert)
    return () => {
      window.removeEventListener(CHAT_DELETE_EVENT, onDelete)
      window.removeEventListener(CHAT_DELETE_REVERT_EVENT, onRevert)
    }
  }, [projectId, user])

  useEffect(() => {
    void refreshProjects()
  }, [refreshProjects])

  useEffect(() => {
    let mounted = true

    async function load() {
      const translate = tRef.current
      const openFresh = openFreshOnLoadRef.current
      if (!projectId) {
        setLoadError(translate('agents.missingProjectId'))
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      setLoadError(null)
      setSyncError(null)
      if (openFresh) {
        const liveForeign = getActiveAgentStream()
        if (liveForeign && liveForeign.projectId !== projectId) {
          abortActiveAgentStream()
          setStreaming(false)
          setAwaitingCatchUp(false)
        }
      }

      try {
        const projectCompetitors = await fetchCompetitorsForProject(projectId)
        if (!mounted) {
          return
        }
        setCompetitors(projectCompetitors)

        const firstName = getUserFirstName(user)
        const welcome = makeWelcomeMessage(firstName, translate) as StoredChatMessage

        let store = user?.id
          ? loadChatStore(user.id, projectId, welcome)
          : createEmptyStore(welcome)

        // Do NOT refresh the welcome / bump timestamps before remote merge —
        // that made a fresh empty local store look "newer" than cloud history
        // after logout wiped localStorage.

        const live = getActiveAgentStream()
        const keepLiveThread = Boolean(
          live && live.projectId === projectId && (live.streaming || live.runId),
        )
        // Project switch stays on the loading shell until the fresh welcome
        // session is the only thread committed to the screen.
        const deferPaint = openFresh && !keepLiveThread

        function commitStore(next: ChatStore) {
          skipPersistRef.current = true
          boundProjectIdRef.current = projectId ?? null
          chatStoreRef.current = next
          setChatStore(next)
          setMessages(getActiveSession(next).messages as ChatMessage[])
        }

        if (!deferPaint) {
          skipPersistRef.current = true
          boundProjectIdRef.current = projectId
          chatStoreRef.current = store
          setChatStore(store)
          const storedMessages = getActiveSession(store).messages as ChatMessage[]
          if (live && live.projectId === projectId) {
            // Remount mid-stream: keep the live assistant bubble instead of
            // clobbering it with a stale localStorage snapshot.
            const hasAssistant = storedMessages.some((m) => m.id === live.assistantId)
            setMessages(
              hasAssistant
                ? storedMessages.map((m) =>
                    m.id === live.assistantId
                      ? {
                          ...m,
                          content: live.content || m.content,
                          agentType: live.agentType as AgentType,
                        }
                      : m,
                  )
                : [
                    ...storedMessages,
                    {
                      id: live.assistantId,
                      role: 'assistant' as const,
                      content: live.content,
                      agentType: live.agentType as AgentType,
                    },
                  ],
            )
            setStreaming(live.streaming)
          } else {
            setMessages(storedMessages)
          }
          setIsLoading(false)
        } else {
          skipPersistRef.current = true
          boundProjectIdRef.current = projectId
          chatStoreRef.current = null
        }

        if (!user?.id) {
          if (deferPaint) {
            commitStore(startNewChatSession(store, welcome))
            setIsLoading(false)
            openFreshOnLoadRef.current = false
          }
          return
        }

        try {
          const remote = await fetchRemoteChatStore(user.id, projectId, welcome)
          if (!mounted) return

          const choice = resolveChatStoreSync(store, remote)
          const liveAfterRemote = getActiveAgentStream()
          const streamingHere = Boolean(
            liveAfterRemote?.projectId === projectId && liveAfterRemote.streaming,
          )
          if (!streamingHere) {
            store = choice.store
            if (!deferPaint) {
              skipPersistRef.current = true
              boundProjectIdRef.current = projectId
              chatStoreRef.current = store
              setChatStore(store)
              setMessages(getActiveSession(store).messages as ChatMessage[])
              saveChatStore(user.id, projectId, store)
            }
            if (choice.uploadLocal && !deferPaint) {
              await upsertRemoteChatStore(user.id, projectId, store)
            }
          }

          const liveNow = getActiveAgentStream()
          const keepLiveThread = Boolean(
            liveNow && liveNow.projectId === projectId && (liveNow.streaming || liveNow.runId),
          )
          const shouldOpenFresh = openFresh && !keepLiveThread
          // Project switch always opens a new thread. Empty threads still refresh the greeting.
          if (shouldOpenFresh || !sessionHasUserMessages(getActiveSession(store).messages)) {
            store = startNewChatSession(store, welcome)
            commitStore(store)
            if (deferPaint && mounted) setIsLoading(false)
            saveChatStore(user.id, projectId, store)
            if (shouldOpenFresh) {
              await upsertRemoteChatStore(user.id, projectId, store)
            }
          } else if (deferPaint) {
            commitStore(store)
            saveChatStore(user.id, projectId, store)
            if (mounted) setIsLoading(false)
          }

          if (mounted) {
            openFreshOnLoadRef.current = false
            setSyncError(null)
          }
        } catch (error) {
          if (mounted) {
            logDevError('agents chat sync load', {
              error: error instanceof Error ? error.message : String(error),
            })
            setSyncError(userFacingMessage(error, translate('agents.syncFromFailed')))
          }
          const liveNow = getActiveAgentStream()
          const keepLiveThread = Boolean(
            liveNow && liveNow.projectId === projectId && (liveNow.streaming || liveNow.runId),
          )
          if (
            (openFresh && !keepLiveThread) ||
            !sessionHasUserMessages(getActiveSession(store).messages)
          ) {
            store = startNewChatSession(store, welcome)
            commitStore(store)
            if (user?.id) {
              saveChatStore(user.id, projectId, store)
            }
          } else if (deferPaint) {
            commitStore(store)
          }
          if (deferPaint && mounted) {
            setIsLoading(false)
          }
          if (mounted) openFreshOnLoadRef.current = false
        }
      } catch (error) {
        if (mounted) {
          logDevError('agents workspace load', {
            error: error instanceof Error ? error.message : String(error),
          })
          setLoadError(userFacingMessage(error, tRef.current('agents.loadFailed')))
          setIsLoading(false)
        }
      }
    }

    void load()
    return () => {
      mounted = false
      if (remoteSaveTimerRef.current) {
        clearTimeout(remoteSaveTimerRef.current)
      }
    }
    // Omit `t`: i18n identity churn must not reload chats mid-stream.
  }, [projectId, user?.id])

  // Re-attach to an in-flight module-level SSE after remount (tab focus / auth).
  // Never abort here — aborting on unmount is what orphaned Redis inflight locks.
  useEffect(() => {
    return subscribeActiveAgentStream((snapshot) => {
      if (!snapshot || snapshot.projectId !== projectId) {
        if (!snapshot) {
          const pending = getPendingAgentCatchUp()
          if (pending && pending.projectId === projectId) {
            setAwaitingCatchUp(true)
            setStreaming(false)
            if (isUiAgentType(pending.agentType) && !suppressAgentChipSyncRef.current) {
              setAgentType(pending.agentType)
            }
          } else {
            setAwaitingCatchUp(false)
            setStreaming(false)
          }
        }
        return
      }
      setStreaming(snapshot.streaming)
      setAwaitingCatchUp(Boolean(snapshot.streaming || snapshot.runId))
      if (isUiAgentType(snapshot.agentType) && !suppressAgentChipSyncRef.current) {
        setAgentType(snapshot.agentType)
      }
      setMessages((current) => {
        const hasAssistant = current.some((m) => m.id === snapshot.assistantId)
        const parsedOutput =
          snapshot.output != null && isStructuredAgentOutput(snapshot.output)
            ? snapshot.output
            : parseAgentPayload(snapshot.output ?? snapshot.content)
        const structured =
          parsedOutput && isStructuredAgentOutput(parsedOutput) ? parsedOutput : null
        const formatted = structured ? formatStructuredAgentOutput(structured) : ''
        const readable =
          formatted.trim() ||
          (typeof snapshot.output === 'string' && !snapshot.output.trim().startsWith('{')
            ? snapshot.output.trim()
            : '')
        const apply = (message: ChatMessage): ChatMessage => {
          if (message.id !== snapshot.assistantId) return message
          if (message.proposalForPostId) {
            const revision = extractRevision(
              snapshot.output ?? snapshot.content,
              reviewPlatformForAgent(message.agentType),
            )
            if (!revision || revision.text.trim().startsWith('{')) {
              return { ...message, output: undefined }
            }
            return { ...message, content: revision.text, output: undefined }
          }
          const nextContent = readable || snapshot.content || message.content
          const next: ChatMessage = {
            ...message,
            content: nextContent,
            agentType: snapshot.agentType as AgentType,
          }
          if (structured) {
            next.output = preserveReviewPosts(message.output, structured)
          }
          return next
        }
        if (hasAssistant) {
          return current.map(apply)
        }
        if (!current.some((message) => message.role === 'user')) {
          return current
        }
        return [
          ...current,
          {
            id: snapshot.assistantId,
            role: 'assistant',
            content: readable || snapshot.content,
            agentType: snapshot.agentType as AgentType,
            ...(structured ? { output: structured } : {}),
          },
        ]
      })
      if (snapshot.error) {
        const streamError = userFacingMessage(
          new AgentsApiError(snapshot.error, 500),
          tRef.current('errors.agentsApi.streamFailed'),
        )
        setSendError(streamError)
        setAwaitingCatchUp(false)
        setMessages((current) =>
          current.map((entry) =>
            entry.id === snapshot.assistantId && !entry.content.trim()
              ? {
                  ...entry,
                  content: tRef.current('agents.sorryPrefix', {
                    message: streamError,
                  }),
                }
              : entry,
          ),
        )
      }
      if (!snapshot.streaming && (snapshot.output != null || snapshot.content.trim())) {
        setAwaitingCatchUp(false)
      }
    })
  }, [projectId])

  // Durable catch-up: visibility, window focus, and 2s polling (sessionStorage).
  useEffect(() => startAgentStreamCatchUpListeners(), [])

  // If we reloaded mid-run, keep logo + agent pill until catch-up fills the bubble.
  useEffect(() => {
    const pending = getPendingAgentCatchUp()
    if (pending && pending.projectId === projectId) {
      setAwaitingCatchUp(true)
      if (isUiAgentType(pending.agentType) && !suppressAgentChipSyncRef.current) {
        setAgentType(pending.agentType)
      }
    }
  }, [projectId])

  useLayoutEffect(() => {
    const list = messageListRef.current
    if (!list) return
    const sessionKey = `${projectId ?? ''}:${chatStore?.activeSessionId ?? ''}`
    if (positionedSessionRef.current !== sessionKey) {
      stickToBottomRef.current = true
      positionedSessionRef.current = sessionKey
    }
    if (!stickToBottomRef.current) return
    list.scrollTop = list.scrollHeight
  }, [messages, showResponding, projectId, chatStore?.activeSessionId])

  useEffect(() => {
    if (!user?.id || !projectId || !chatStoreRef.current) {
      return
    }
    if (!canPersistChatForProject(boundProjectIdRef.current, projectId)) {
      return
    }
    if (skipPersistRef.current) {
      skipPersistRef.current = false
      return
    }
    const next = updateActiveSessionMessages(chatStoreRef.current, messages as StoredChatMessage[])
    chatStoreRef.current = next
    setChatStore(next)
    saveChatStore(user.id, projectId, next)
    window.dispatchEvent(
      new CustomEvent('contos-chat-store-updated', { detail: { projectId } }),
    )
    // Avoid writing every SSE token to Supabase — sync when stream settles.
    if (!showResponding) {
      queueRemoteSave(user.id, projectId, next)
    }
  }, [messages, user?.id, projectId, showResponding])

  useEffect(() => {
    if (showResponding) return
    const stamped = stampMissingReviewPosts(messages, newId)
    if (!stamped.changed) return
    const before = new Set(collectReviewPosts(messages).map((post) => post.messageId))
    const added = collectReviewPosts(stamped.messages).filter((post) => !before.has(post.messageId))
    const counts = new Map<string, number>()
    for (const post of added) counts.set(post.messageId, (counts.get(post.messageId) ?? 0) + 1)
    if ([...counts.values()].some((count) => count >= 2)) setDraftsOpen(true)
    setMessages(stamped.messages)
  }, [messages, showResponding])

  useEffect(() => {
    const sessionId = searchParams.get('session')
    if (!sessionId || !chatStore) {
      return
    }

    const clearSessionParam = () => {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('session')
      nextParams.delete('panel')
      setSearchParams(nextParams, { replace: true })
    }

    if (chatStore.activeSessionId === sessionId) {
      clearSessionParam()
      return
    }

    if (streaming) {
      abortActiveAgentStream()
      setStreaming(false)
    }

    try {
      const next = switchChatSession(chatStore, sessionId)
      skipPersistRef.current = true
      chatStoreRef.current = next
      setChatStore(next)
      setMessages(getActiveSession(next).messages as ChatMessage[])
      setSendError(null)
      setPendingPlatformRedirect(null)
      if (user?.id && projectId) {
        saveChatStore(user.id, projectId, next)
        window.dispatchEvent(
          new CustomEvent('contos-chat-store-updated', { detail: { projectId } }),
        )
        queueRemoteSave(user.id, projectId, next)
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : t('agents.openChatFailed'))
    } finally {
      clearSessionParam()
    }
  }, [searchParams, chatStore, projectId, user?.id, streaming, t, setSearchParams])

  function handleNewChat() {
    if (streaming) {
      abortActiveAgentStream()
      setStreaming(false)
    }
    const welcome = makeWelcomeMessage(getUserFirstName(user), t) as StoredChatMessage
    const base = chatStoreRef.current ?? createEmptyStore(welcome)
    const next = startNewChatSession(base, welcome)
    skipPersistRef.current = true
    chatStoreRef.current = next
    setChatStore(next)
    setMessages(getActiveSession(next).messages as ChatMessage[])
    setDraftsOpen(false)
    setProposal(null)
    setDismissedProposalIds(new Set())
    setAcceptedRevision(null)
    setScheduleReport(null)
    setSendError(null)
    setPendingPlatformRedirect(null)
    setReplyTarget(null)
    setDraftTargetId(null)
    stopDictationRef.current('abort')
    if (user?.id && projectId) {
      saveChatStore(user.id, projectId, next)
      window.dispatchEvent(
        new CustomEvent('contos-chat-store-updated', { detail: { projectId } }),
      )
      queueRemoteSave(user.id, projectId, next)
    }
  }
  handleNewChatRef.current = handleNewChat

  useEffect(() => {
    if (!replyTarget) return
    if (messages.some((message) => message.id === replyTarget.messageId)) return
    setReplyTarget(null)
  }, [messages, replyTarget])

  useEffect(() => {
    if (!draftTargetId) return
    if (collectReviewPosts(messages).some((post) => post.id === draftTargetId)) return
    setDraftTargetId(null)
  }, [draftTargetId, messages])

  useEffect(() => {
    const failure = t('agents.drafts.proposalFailed')
    setMessages((current) => {
      let changed = false
      const posts = collectReviewPosts(current)
      const next = current.map((message, index) => {
        if (message.role === 'user' && !message.draftPreview) {
          const following = current[index + 1]
          const post = following?.proposalForPostId
            ? posts.find((item) => item.id === following.proposalForPostId)
            : undefined
          if (post) {
            changed = true
            return {
              ...message,
              draftPreview: {
                postId: post.id,
                platform: post.platform,
                excerpt: draftPreviewText(post.text),
              },
            }
          }
        }
        if (message.role !== 'assistant' || !message.proposalForPostId) return message
        const raw = message.content.trim().startsWith('{')
        const failed = message.content === failure
        if (!raw && !failed) return message
        const revision = extractRevision(
          message.output ?? message.content,
          reviewPlatformForAgent(message.agentType),
        )
        if (!revision || revision.text.trim().startsWith('{')) return message
        changed = true
        return { ...message, content: revision.text, output: undefined }
      })
      return changed ? next : current
    })
  }, [messages, t])

  useEffect(() => {
    const failure = t('agents.drafts.proposalFailed')
    const latest = [...messages].reverse().find((message) => message.proposalForPostId)
    if (!latest?.proposalForPostId || dismissedProposalIds.has(latest.id)) return
    if (proposal?.messageId === latest.id) return
    const revision = extractRevision(
      latest.output ?? latest.content,
      reviewPlatformForAgent(latest.agentType),
    )
    const text =
      revision?.text ??
      (latest.content.trim() && !latest.content.trim().startsWith('{') && latest.content !== failure
        ? latest.content
        : '')
    if (!text || text.trim().startsWith('{')) return
    setProposal({
      messageId: latest.id,
      postId: latest.proposalForPostId,
      text,
      entries: revision?.entries ?? null,
    })
  }, [dismissedProposalIds, messages, proposal, t])

  function jumpToMessage(messageId: string) {
    const node = document.getElementById(`chat-msg-${messageId}`)
    if (!node) return
    stickToBottomRef.current = false
    node.scrollIntoView({ block: 'center', behavior: 'auto' })
  }

  // Refresh empty-state welcome when the UI language changes.
  useEffect(() => {
    if (streaming) return
    setMessages((current) => {
      const hasUser = current.some((message) => message.role === 'user')
      if (hasUser) return current
      const welcome = makeWelcomeMessage(getUserFirstName(user), t)
      const withoutWelcome = current.filter(
        (message) =>
          !(message.role === 'assistant' && isAgentsWelcomeMessage(message.content)),
      )
      return [welcome, ...withoutWelcome]
    })
  }, [i18n.language, t, user, streaming])

  const researchReady =
    project?.status === 'ready' ||
    competitors.some((competitor) => competitor.pipeline_step === 'done')

  const showResearchInProgressBanner =
    competitors.length > 0 && !researchReady

  const mentionCandidates = projects.filter((avatar) => {
    if (taggedAvatarIds.includes(avatar.id)) {
      return false
    }
    if (!mentionQuery) {
      return true
    }
    return avatar.name.toLowerCase().includes(mentionQuery.toLowerCase())
  })

  function toggleTaggedAvatar(avatarId: string) {
    setTaggedAvatarIds((current) =>
      current.includes(avatarId)
        ? current.filter((id) => id !== avatarId)
        : [...current, avatarId],
    )
  }

  function handleInputChange(value: string) {
    setInput(value)
    dictationFieldRef.current = value
    const atIndex = value.lastIndexOf('@')
    if (atIndex >= 0) {
      const after = value.slice(atIndex + 1)
      if (!after.includes(' ') && !after.includes('\n')) {
        setMentionOpen(true)
        setMentionQuery(after)
        return
      }
    }
    setMentionOpen(false)
    setMentionQuery('')
  }

  function selectMention(avatar: Project) {
    toggleTaggedAvatar(avatar.id)
    const atIndex = input.lastIndexOf('@')
    if (atIndex >= 0) {
      const nextValue = `${input.slice(0, atIndex)}@${avatar.name} `
      dictationFieldRef.current = nextValue
      setInput(nextValue)
    }
    setMentionOpen(false)
    setMentionQuery('')
    inputRef.current?.focus()
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault()
    if (!projectId || showResponding) {
      return
    }

    const text = input.trim()
    if (!text) {
      return
    }

    const activeReply = replyTarget
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (recognition) {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      try {
        recognition.abort()
      } catch {
        // The session was already stopped.
      }
    }
    setListening(false)
    setSendError(null)
    setInput('')
    setReplyTarget(null)
    const attachedDraft = draftTargetId
      ? reviewPosts.find((post) => post.id === draftTargetId) ?? null
      : null
    setDraftTargetId(null)
    if (attachedDraft) {
      void refinePost(attachedDraft, text)
      return
    }
    const invokeAvatarIds = resolveInvokeTaggedAvatarIds({
      activeAvatarId: projectId,
      selectedIds: taggedAvatarIds,
      messageText: text,
      avatars: projects,
    })
    const extraTaggedIds = invokeAvatarIds.filter((id) => id !== projectId)
    const taggedNames = extraTaggedIds
      .map((id) => projects.find((avatar) => avatar.id === id)?.name)
      .filter((name): name is string => !!name)
    const userMessage: ChatMessage = {
      id: newId(),
      role: 'user',
      content: text,
      taggedAvatarIds: extraTaggedIds,
      taggedAvatarNames: taggedNames,
      ...(activeReply ? { replyTo: activeReply } : {}),
    }
    const invokeText = userTextWithReply(text, activeReply)

    // Explicit "switch to X agent" works from any agent and switches immediately.
    const explicitSwitch = detectExplicitSwitchRequest(text)
    if (explicitSwitch) {
      const label = platformLabel(explicitSwitch)
      const alreadyThere = explicitSwitch === agentType
      const assistantMessage: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: alreadyThere
          ? t('agents.platformRedirect.alreadyOn', { platform: label })
          : t('agents.platformRedirect.switched', { platform: label }),
        agentType: alreadyThere ? agentType : explicitSwitch,
      }
      userMessage.agentType = alreadyThere ? agentType : explicitSwitch
      setMessages((current) => [...current, userMessage, assistantMessage])
      setPendingPlatformRedirect(null)
      if (!alreadyThere) setAgentType(explicitSwitch)
      return
    }

    // "confirm" turns the last draft's bold suggestions into normal text, with no model call.
    if (!pendingPlatformRedirect && isConfirmMessage(text)) {
      const lastDraft = [...messages]
        .reverse()
        .find(
          (message) =>
            message.role === 'assistant' && message.output && outputHasSuggestions(message.output),
        )
      if (lastDraft?.output) {
        const confirmed = confirmSuggestions(lastDraft.output, t('agents.output.confirmedNote'))
        const assistantMessage: ChatMessage = {
          id: newId(),
          role: 'assistant',
          content: formatAgentOutput(confirmed),
          output: confirmed,
          agentType: lastDraft.agentType ?? agentType,
        }
        userMessage.agentType = lastDraft.agentType ?? agentType
        setMessages((current) => [...current, userMessage, assistantMessage])
        return
      }
    }

    // Two or more platforms: switch to Chat and draft each specialist in order.
    const namedPlatforms = multiPlanPlatforms(agentType, text)
    if (namedPlatforms) {
      setAgentType('chatbot')
      setPendingPlatformRedirect(null)
      const platformsLabel = namedPlatforms.map((platform) => platformLabel(platform)).join(', ')
      const introMessage: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: t('agents.platformRedirect.multiPlan', { platforms: platformsLabel }),
        agentType: 'chatbot',
      }
      userMessage.agentType = 'chatbot'
      setMessages((current) => [...current, userMessage, introMessage])
      const planProjectId = projectId
      suppressAgentChipSyncRef.current = true
      setMultiPlanActive(true)
      setStreaming(true)
      setAwaitingCatchUp(true)
      try {
        for (const platform of namedPlatforms) {
          if (boundProjectIdRef.current !== planProjectId) break
          const assistantId = newId()
          const chatHistory = buildChatHistoryForInvoke(messages, platform)
          setMessages((current) => [
            ...current,
            { id: assistantId, role: 'assistant', content: '', agentType: platform },
          ])
          try {
            await runAgentStream({
              projectId: planProjectId,
              assistantId,
              agentType: platform,
              body: {
                avatar_id: planProjectId,
                agent_type: platform,
                user_input: invokeText,
                chatbot_context_on: true,
                tagged_avatar_ids: extraTaggedIds.length > 0 ? extraTaggedIds : undefined,
                chat_history: chatHistory.length > 0 ? chatHistory : undefined,
                response_language: resolveUiLanguage(i18n.language),
              },
              handlers: {
                onComplete: (data) => {
                  const output = data.output
                  const formatted = formatAgentOutput(output)
                  setMessages((current) =>
                    current.map((message) => {
                      if (message.id !== assistantId) return message
                      if (isStructuredAgentOutput(output)) {
                        return {
                          ...message,
                          content: formatted || message.content,
                          output: preserveReviewPosts(message.output, output),
                          agentType: platform,
                        }
                      }
                      if (typeof output === 'string' && output.trim()) {
                        return { ...message, content: output, agentType: platform }
                      }
                      if (formatted) {
                        return { ...message, content: formatted, agentType: platform }
                      }
                      return { ...message, agentType: platform }
                    }),
                  )
                },
                onError: (message) => {
                  const streamError = userFacingMessage(
                    new AgentsApiError(message, 500),
                    t('errors.agentsApi.streamFailed'),
                  )
                  setSendError(streamError)
                  setMessages((current) =>
                    current.map((entry) =>
                      entry.id === assistantId && !entry.content.trim()
                        ? { ...entry, content: t('agents.sorryPrefix', { message: streamError }) }
                        : entry,
                    ),
                  )
                },
              },
            })
          } catch (error) {
            if ((error as Error).name === 'AbortError') break
            const message = userFacingMessage(error, t('agents.reachFailed'))
            setSendError(message)
            setMessages((current) =>
              current.map((entry) =>
                entry.id === assistantId && !entry.content.trim()
                  ? { ...entry, content: t('agents.sorryPrefix', { message }) }
                  : entry,
              ),
            )
          }
          if (boundProjectIdRef.current !== planProjectId) break
        }
      } finally {
        suppressAgentChipSyncRef.current = false
        setMultiPlanActive(false)
        setAgentType('chatbot')
        const pending = getPendingAgentCatchUp()
        if (pending && pending.projectId === planProjectId) {
          setStreaming(false)
          setAwaitingCatchUp(true)
        } else {
          setStreaming(false)
          setAwaitingCatchUp(false)
        }
      }
      return
    }

    // Chat → platform agent: auto-switch when exactly one platform is named.
    let invokeAgentType: AgentType = agentType
    if (agentType === 'chatbot') {
      const inferredPending =
        pendingPlatformRedirect ??
        (() => {
          const lastAssistant = [...messages]
            .reverse()
            .find((message) => message.role === 'assistant' && message.content.trim())
          return lastAssistant
            ? detectPlatformFromRedirectAsk(lastAssistant.content)
            : null
        })()

      // Legacy yes/no replies to an old "want me to switch?" bubble.
      if (inferredPending && isAffirmativeReply(text)) {
        const label = platformLabel(inferredPending)
        const assistantMessage: ChatMessage = {
          id: newId(),
          role: 'assistant',
          content: t('agents.platformRedirect.switched', { platform: label }),
          agentType: inferredPending,
        }
        userMessage.agentType = inferredPending
        setMessages((current) => [...current, userMessage, assistantMessage])
        setPendingPlatformRedirect(null)
        setAgentType(inferredPending)
        return
      }

      if (inferredPending && isNegativeReply(text)) {
        const assistantMessage: ChatMessage = {
          id: newId(),
          role: 'assistant',
          content: t('agents.platformRedirect.stayed'),
          agentType: 'chatbot',
        }
        userMessage.agentType = 'chatbot'
        setMessages((current) => [...current, userMessage, assistantMessage])
        setPendingPlatformRedirect(null)
        return
      }

      // Bare platform name (e.g. "linkedin"): switch chip only, no model call.
      const barePlatform = detectPlatformRedirectRequest(text)
      if (barePlatform) {
        const label = platformLabel(barePlatform)
        const assistantMessage: ChatMessage = {
          id: newId(),
          role: 'assistant',
          content: t('agents.platformRedirect.switched', { platform: label }),
          agentType: barePlatform,
        }
        userMessage.agentType = barePlatform
        setMessages((current) => [...current, userMessage, assistantMessage])
        setPendingPlatformRedirect(null)
        setAgentType(barePlatform)
        return
      }

      // Content that names exactly one platform: switch and invoke that agent.
      const namedPlatform = detectSingleNamedPlatform(text)
      if (namedPlatform) {
        setPendingPlatformRedirect(null)
        setAgentType(namedPlatform)
        invokeAgentType = namedPlatform
      } else if (pendingPlatformRedirect) {
        setPendingPlatformRedirect(null)
      }
    }

    const nextPlatform = redirectTarget(agentType, text)
    if (nextPlatform) {
      setAgentType(nextPlatform)
      invokeAgentType = nextPlatform
    }

    userMessage.agentType = invokeAgentType
    const chatHistory = buildChatHistoryForInvoke(messages, invokeAgentType)
    const assistantId = newId()
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: 'assistant', content: '', agentType: invokeAgentType },
    ])
    setStreaming(true)
    setAwaitingCatchUp(true)

    try {
      await runAgentStream({
        projectId,
        assistantId,
        agentType: invokeAgentType,
        body: {
          avatar_id: projectId,
          agent_type: invokeAgentType,
          user_input: invokeText,
          chatbot_context_on: true,
          tagged_avatar_ids: extraTaggedIds.length > 0 ? extraTaggedIds : undefined,
          chat_history: chatHistory.length > 0 ? chatHistory : undefined,
          response_language: resolveUiLanguage(i18n.language),
        },
        handlers: {
          onComplete: (data) => {
            const output = data.output
            const formatted = formatAgentOutput(output)
            setMessages((current) =>
              current.map((message) => {
                if (message.id !== assistantId) {
                  return message
                }
                if (isStructuredAgentOutput(output)) {
                  return {
                    ...message,
                    content: formatted || message.content,
                    output: preserveReviewPosts(message.output, output),
                    agentType: invokeAgentType,
                  }
                }
                // Prefer the full complete payload over partial streamed tokens
                // (tokens may be dropped when the tab was backgrounded).
                if (typeof output === 'string' && output.trim()) {
                  return {
                    ...message,
                    content: output,
                    agentType: invokeAgentType,
                  }
                }
                if (formatted) {
                  return {
                    ...message,
                    content: formatted,
                    agentType: invokeAgentType,
                  }
                }
                return { ...message, agentType: invokeAgentType }
              }),
            )
          },
          onError: (message) => {
            const streamError = userFacingMessage(
              new AgentsApiError(message, 500),
              t('errors.agentsApi.streamFailed'),
            )
            setSendError(streamError)
            setMessages((current) =>
              current.map((entry) =>
                entry.id === assistantId && !entry.content.trim()
                  ? { ...entry, content: t('agents.sorryPrefix', { message: streamError }) }
                  : entry,
              ),
            )
          },
        },
      })
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return
      }
      const message = userFacingMessage(error, t('agents.reachFailed'))
      setSendError(message)
      setMessages((current) =>
        current.map((entry) =>
          entry.id === assistantId && !entry.content.trim()
            ? { ...entry, content: t('agents.sorryPrefix', { message }) }
            : entry,
        ),
      )
    } finally {
      const pending = getPendingAgentCatchUp()
      if (pending && pending.projectId === projectId) {
        setStreaming(false)
        setAwaitingCatchUp(true)
      } else {
        setStreaming(false)
        setAwaitingCatchUp(false)
      }
    }
  }

  if (isLoading || projectsLoading) {
    return (
      <DashboardLayout
        projects={projects}
        activeProject={project}
        onAvatarsChanged={setProjects}
        userEmail={user?.email}
        isSigningOut={isSigningOut}
        onSignOut={() => void handleSignOut()}
        sidebarOpen={sidebarOpen}
        onSidebarOpenChange={setSidebarOpen}
        isLoading
      >
        {null}
      </DashboardLayout>
    )
  }

  if (loadError || !project || !projectId) {
    return (
      <DashboardLayout
        projects={projects}
        activeProject={project}
        onAvatarsChanged={setProjects}
        userEmail={user?.email}
        isSigningOut={isSigningOut}
        onSignOut={() => void handleSignOut()}
        sidebarOpen={sidebarOpen}
        onSidebarOpenChange={setSidebarOpen}
        mainClassName="overflow-y-auto px-6 py-10"
      >
        <p className="text-sm text-red-700">{loadError ?? t('agents.projectUnavailable')}</p>
        <Link to="/dashboard" className="mt-4 inline-block text-sm text-accent-primary-deep">
          {t('agents.backToDashboard')}
        </Link>
      </DashboardLayout>
    )
  }

  const conversationMessages = messages.filter(
    (message) => !(message.role === 'assistant' && isAgentsWelcomeMessage(message.content)),
  )
  const welcomeGreeting =
    messages.find(
      (message) => message.role === 'assistant' && isAgentsWelcomeMessage(message.content),
    )?.content ?? makeWelcomeMessage(getUserFirstName(user), t).content
  const showClaudeStyleGreeting = conversationMessages.length === 0
  const atAvatarCap = projects.length >= MAX_AVATARS
  const headerActionClassName = 'contos-btn contos-btn--pill contos-btn--secondary'
  const reviewPosts = collectReviewPosts(messages)
  const needsReviewCount = reviewPosts.filter((post) => post.status === 'needs_review').length

  async function writeReviewPost(item: ReviewPost, publishDate: string, mode: 'draft' | 'schedule') {
    const request = postizRequestFromReview(item, publishDate, mode)
    if (!request || !projectId) {
      throw new PostizApiError(
        `Post ${item.id} on ${item.platform} cannot be sent to Postiz.`,
        400,
      )
    }
    return createPostizPost({
      avatarId: projectId,
      type: request.type,
      content: request.content,
      publishDate: request.publishDate,
      postId: request.postId,
      platform: request.platform,
      posts: request.posts,
      images: request.images,
    })
  }

  function applyScheduleRows(rows: Array<{ post: ReviewPost; outcome: string }>) {
    setMessages((current) =>
      rows.reduce((next, row) => {
        const patched = patchReviewPost(next, row.post.messageId, row.post.id, () => row.post)
        if (row.outcome !== 'succeeded') return patched
        return hideReviewPost(patched, row.post.messageId, row.post.id)
      }, current),
    )
  }

  async function commitOne(post: ReviewPost, localDateTime: string, mode: 'draft' | 'schedule') {
    if (!projectId || schedulingRef.current) return
    schedulingRef.current = true
    setScheduling(true)
    try {
      const row = await commitReviewPost({
        post,
        localDateTime,
        now: new Date(),
        mode,
        create: writeReviewPost,
        list: (startDate, endDate) => listPostizPosts(projectId, startDate, endDate),
      })
      applyScheduleRows([row])
      setScheduleReport({
        succeeded: row.outcome === 'succeeded' ? [row] : [],
        failed: row.outcome === 'failed' ? [row] : [],
        skipped: row.outcome === 'skipped' ? [row] : [],
        uncertain: row.outcome === 'uncertain' ? [row] : [],
      })
    } finally {
      schedulingRef.current = false
      setScheduling(false)
    }
  }

  async function refinePost(post: ReviewPost, instruction: string) {
    if (!projectId || showResponding) return
    const agent = post.platform === 'x' ? 'twitter' : post.platform
    const assistantId = newId()
    const literal = literalReplacement(post, instruction)
    setProposal(null)
    setMessages((current) => [
      ...current,
      {
        id: newId(),
        role: 'user',
        content: instruction,
        agentType: agent,
        draftPreview: {
          postId: post.id,
          platform: post.platform,
          excerpt: draftPreviewText(post.text),
        },
      },
      { id: assistantId, role: 'assistant', content: '', agentType: agent, proposalForPostId: post.id },
    ])
    const showRevision = (content: string, revision: { text: string; entries: string[] | null } | null) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, content, output: undefined } : message,
        ),
      )
      setProposal(revision ? { messageId: assistantId, postId: post.id, text: revision.text, entries: revision.entries } : null)
    }
    if (literal) {
      showRevision(literal.text, literal)
      return
    }
    suppressAgentChipSyncRef.current = true
    setStreaming(true)
    setAwaitingCatchUp(true)
    try {
      await runAgentStream({
        projectId,
        assistantId,
        agentType: agent,
        body: {
          avatar_id: projectId,
          agent_type: agent,
          user_input: refineInstruction(post, instruction),
          chatbot_context_on: false,
          task: 'revise',
          response_language: resolveUiLanguage(i18n.language),
        },
        handlers: {
          onComplete: (data) => {
            const revision = extractRevision(data.output, post.platform)
            showRevision(revision ? revision.text : t('agents.drafts.proposalFailed'), revision)
          },
          onError: (message) => {
            showRevision(
              userFacingMessage(new AgentsApiError(message, 500), t('agents.drafts.proposalFailed')),
              null,
            )
          },
        },
      })
    } catch (error) {
      showRevision(userFacingMessage(error, t('agents.drafts.proposalFailed')), null)
    } finally {
      suppressAgentChipSyncRef.current = false
      setStreaming(false)
      setAwaitingCatchUp(false)
    }
  }

  function acceptChatProposal(post: ReviewPost) {
    if (!proposal || proposal.postId !== post.id) return
    const revision = proposal
    setAcceptedRevision({
      token: newId(),
      postId: post.id,
      text: revision.text,
      entries: revision.entries,
    })
    setMessages((current) =>
      patchReviewPost(current, post.messageId, post.id, (item) => acceptRevision(item, revision)),
    )
    setDismissedProposalIds((current) => {
      const next = new Set(current)
      for (const message of messages) {
        if (message.proposalForPostId === post.id) next.add(message.id)
      }
      return next
    })
    setProposal(null)
  }

  const headerActions = (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        className={headerActionClassName}
        aria-expanded={draftsOpen}
        onClick={() => setDraftsOpen((open) => !open)}
      >
        <span>{t('agents.drafts.open')}</span>
        {needsReviewCount > 0 ? <span>{needsReviewCount}</span> : null}
      </button>
      <button
        type="button"
        onClick={() => {
          window.dispatchEvent(new CustomEvent('contos-new-chat'))
        }}
        className={headerActionClassName}
      >
        <span aria-hidden="true">+</span>
        <span>{t('agents.newChat').replace(/^\+\s*/u, '')}</span>
      </button>
      {!atAvatarCap ? (
        <Link to="/projects/new" className={headerActionClassName}>
          <span aria-hidden="true">+</span>
          <span>{t('layout.newProject').replace(/^\+\s*/u, '')}</span>
        </Link>
      ) : null}
    </div>
  )

  function MicIcon() {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4" aria-hidden>
        <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
      </svg>
    )
  }

  function detachRecognition(recognition: SpeechRecognitionLike) {
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
  }

  function stopDictation(mode: 'stop' | 'abort' = 'stop') {
    const recognition = recognitionRef.current
    recognitionRef.current = null
    dictationStopRequestedRef.current = true
    setListening(false)
    if (!recognition) return
    if (mode === 'abort') {
      const settled = applyDictationResult(
        dictationFieldRef.current,
        dictationCursorRef.current,
        dictationCursorRef.current.appliedFinals,
        '',
      )
      dictationFieldRef.current = settled.field
      dictationCursorRef.current = settled.cursor
      setInput(settled.field)
      detachRecognition(recognition)
      try {
        recognition.abort()
      } catch {
        // The session was already stopped.
      }
      return
    }
    try {
      recognition.stop()
    } catch {
      detachRecognition(recognition)
      try {
        recognition.abort()
      } catch {
        // The session was already stopped.
      }
    }
  }
  stopDictationRef.current = stopDictation

  function reportSpeechError(error: string) {
    const failure = speechFailure(error)
    if (!failure) return
    if (failure === 'empty') {
      if (dictationStopRequestedRef.current) return
      speechErrorRef.current = failure
      setSendError(t('agents.speech.empty'))
      return
    }
    speechErrorRef.current = failure
    if (failure === 'permission') {
      setSendError(t('agents.speech.permission'))
      return
    }
    if (failure === 'unavailable') {
      setSendError(t('agents.speech.unavailable'))
      return
    }
    setSendError(t('agents.speech.failed', { error }))
  }

  function startDictation() {
    if (showResponding) return
    const Ctor = getSpeechRecognition(window as unknown as SpeechHost)
    if (!Ctor) {
      setSendError(t('agents.speech.unavailable'))
      return
    }
    setSendError(null)
    speechErrorRef.current = null
    dictationStopRequestedRef.current = false
    dictationFieldRef.current = input
    dictationCursorRef.current = { appliedFinals: '', lastInterim: '' }
    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = speechLanguageTag(i18n.language)
    recognition.onresult = (event) => {
      const { finals, interim } = collectTranscripts(event.results)
      const applied = applyDictationResult(
        dictationFieldRef.current,
        dictationCursorRef.current,
        finals,
        interim,
      )
      dictationFieldRef.current = applied.field
      dictationCursorRef.current = applied.cursor
      setInput(applied.field)
    }
    recognition.onerror = (event) => {
      reportSpeechError(event.error)
    }
    recognition.onend = () => {
      const userStopped = dictationStopRequestedRef.current
      if (!userStopped) {
        const settled = applyDictationResult(
          dictationFieldRef.current,
          dictationCursorRef.current,
          dictationCursorRef.current.appliedFinals,
          '',
        )
        dictationFieldRef.current = settled.field
        dictationCursorRef.current = settled.cursor
        setInput(settled.field)
        if (!speechErrorRef.current && !settled.cursor.appliedFinals) {
          setSendError(t('agents.speech.empty'))
        }
      }
      detachRecognition(recognition)
      if (recognitionRef.current === recognition) recognitionRef.current = null
      setListening(false)
    }
    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
    } catch (error) {
      detachRecognition(recognition)
      if (recognitionRef.current === recognition) recognitionRef.current = null
      setListening(false)
      const message = error instanceof Error ? error.message : 'start-failed'
      setSendError(t('agents.speech.failed', { error: message }))
    }
  }

  function toggleDictation() {
    if (recognitionRef.current) stopDictation('stop')
    else startDictation()
  }

  function renderComposer(centeredTags = false) {
    const attachedDraft = draftTargetId
      ? reviewPosts.find((post) => post.id === draftTargetId) ?? null
      : null
    const attachedPreview = attachedDraft ? draftPreviewText(attachedDraft.text) : ''
    const attachedPlatform = !attachedDraft
      ? ''
      : attachedDraft.platform === 'linkedin'
        ? t('agents.drafts.platformLinkedin')
        : attachedDraft.platform === 'x'
          ? t('agents.drafts.platformX')
          : t('agents.drafts.platformInstagram')
    return (
      <form className="w-full" onSubmit={(event) => void handleSend(event)}>
        {attachedDraft ? (
          <div className="mb-2 flex items-start gap-2 rounded-xl border border-border-hairline bg-canvas px-3 py-2 text-left">
            <div className="min-w-0 flex-1 border-l-2 border-accent-primary-deep/70 pl-2">
              <p className="text-[11px] font-medium text-ink-muted">
                {t('agents.drafts.editingDraft', { platform: attachedPlatform })}
              </p>
              <p className="line-clamp-4 whitespace-pre-wrap text-xs text-ink">{attachedPreview}</p>
            </div>
            <button
              type="button"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-canvas-raised hover:text-ink"
              aria-label={t('agents.drafts.clearAddedDraft')}
              onClick={() => setDraftTargetId(null)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-3.5 w-3.5" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ) : replyTarget ? (
          <div className="mb-2 flex items-start gap-2 rounded-xl border border-border-hairline bg-canvas px-3 py-2 text-left">
            <div className="min-w-0 flex-1 border-l-2 border-accent-primary-deep/70 pl-2">
              <p className="text-[11px] font-medium text-ink-muted">
                {replyTarget.role === 'assistant' ? t('agents.reply.assistant') : t('agents.reply.you')}
              </p>
              <p className="truncate text-xs text-ink">{replyTarget.excerpt}</p>
            </div>
            <button
              type="button"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-canvas-raised hover:text-ink"
              aria-label={t('agents.reply.cancel')}
              onClick={() => setReplyTarget(null)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-3.5 w-3.5" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ) : null}
        {taggedAvatarIds.length > 0 ? (
          <div
            className={`mb-2 flex flex-wrap gap-2 ${centeredTags ? 'justify-center' : ''}`}
          >
            {taggedAvatarIds.map((id) => {
              const avatar = projects.find((entry) => entry.id === id)
              if (!avatar) {
                return null
              }
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleTaggedAvatar(id)}
                  className="rounded-full bg-accent-primary-soft px-3 py-1 text-xs font-medium text-accent-primary-deep"
                >
                  {avatar.name} ×
                </button>
              )
            })}
          </div>
        ) : null}

        <div className="relative">
          {mentionOpen && mentionCandidates.length > 0 ? (
            <div
              className={`absolute bottom-full z-10 mb-2 max-h-48 w-64 overflow-y-auto rounded-xl border border-border-hairline bg-canvas-raised text-left shadow-lg ${
                centeredTags ? 'left-1/2 -translate-x-1/2' : 'left-0'
              }`}
            >
              {mentionCandidates.map((avatar) => (
                <button
                  key={avatar.id}
                  type="button"
                  onClick={() => selectMention(avatar)}
                  className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-accent-primary-soft"
                >
                  <span className="font-medium">@{avatar.name}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted capitalize">
                    {avatarTypeLabel(avatar.type)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex items-center gap-2 rounded-full border border-border-hairline bg-canvas-raised px-3 py-2 sm:px-4">
            <div className="relative shrink-0">
              {listening ? (
                <span className="contos-speech-bubble" aria-hidden="true">
                  {t('agents.speech.stopRecording')}
                </span>
              ) : null}
              <button
                type="button"
                className="contos-btn contos-btn--icon contos-btn--icon-sm contos-btn--ghost"
                aria-pressed={listening}
                aria-label={listening ? t('agents.speech.stopRecording') : t('agents.speech.start')}
                disabled={showResponding}
                onClick={toggleDictation}
              >
                <MicIcon />
              </button>
            </div>
            <input
              ref={inputRef}
              value={input}
              onChange={(event) => handleInputChange(event.target.value)}
              disabled={showResponding}
              placeholder={t('agents.placeholder')}
              className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-ink outline-none placeholder:text-ink-muted"
            />
            <button
              type="submit"
              disabled={showResponding || !input.trim()}
              className="contos-btn contos-btn--icon contos-btn--primary"
              aria-label={showResponding ? t('agents.sendingAria') : t('agents.sendAria')}
            >
              ↑
            </button>
          </div>
        </div>
      </form>
    )
  }

  function fillQuickPrompt(promptKey: string) {
    handleInputChange(t(promptKey))
    inputRef.current?.focus()
  }

  const suggestionPills = (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => fillQuickPrompt('agents.quickActions.researchPrompt')}
        className="contos-btn contos-btn--pill contos-btn--ghost contos-btn--accent-label"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4 shrink-0" aria-hidden>
          <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10c.8.8 1.2 1.6 1.2 2.5V17h5.6v-1.5c0-.9.4-1.7 1.2-2.5A6 6 0 0 0 12 3Z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t('agents.quickActions.researchTitle')}
      </button>
      <button
        type="button"
        onClick={() => fillQuickPrompt('agents.quickActions.contentPrompt')}
        className="contos-btn contos-btn--pill contos-btn--ghost contos-btn--accent-label"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4 shrink-0" aria-hidden>
          <path d="M7 4h8l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
          <path d="M14 4v5h5M9 13h6M9 17h4" strokeLinecap="round" />
        </svg>
        {t('agents.quickActions.contentTitle')}
      </button>
      <button
        type="button"
        onClick={() => fillQuickPrompt('agents.quickActions.calendarPrompt')}
        className="contos-btn contos-btn--pill contos-btn--ghost contos-btn--accent-label"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4 shrink-0" aria-hidden>
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M8 3.5v3M16 3.5v3M3.5 10h17" strokeLinecap="round" />
        </svg>
        {t('agents.quickActions.calendarTitle')}
      </button>
    </div>
  )

  return (
    <DashboardLayout
      projects={projects}
      activeProject={project}
      onAvatarsChanged={setProjects}
      userEmail={user?.email}
      isSigningOut={isSigningOut}
      onSignOut={() => void handleSignOut()}
      sidebarOpen={sidebarOpen}
      onSidebarOpenChange={setSidebarOpen}
      mainClassName="flex min-h-0 flex-col overflow-hidden"
    >
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pb-3 pt-4 sm:pt-6">
          <div className="px-4 sm:px-8">
            <IncompleteProfilingBanner
              projectId={project.id}
              profilingCompleteness={project.profiling_completeness}
            />
          </div>

          <div className="mb-3 shrink-0 px-4 sm:px-8">
            <div className="flex items-center justify-between gap-4">
              <AgentTypePills
                agentType={agentType}
                streaming={showResponding}
                options={agentOptions}
                onChange={(next) => {
                  setPendingPlatformRedirect(null)
                  setAgentType(next)
                }}
              />
              {headerActions}
            </div>
          </div>

          {showResearchInProgressBanner ? (
            <div className="mb-2 shrink-0 px-4 sm:px-8">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
                {t('agents.researchInProgress')}{' '}
                <Link className="font-medium underline" to={`/dashboard/${projectId}`}>
                  {t('agents.viewProgress')}
                </Link>
              </div>
            </div>
          ) : null}

          {showClaudeStyleGreeting ? (
        <section className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-4 pt-2 sm:px-8">
          <div className="flex w-full max-w-3xl flex-col items-center px-1 text-center sm:px-2">
            <img
              src={contosMark}
              alt=""
              aria-hidden="true"
              className="mb-5 h-12 w-12 object-contain dark:hidden sm:mb-6 sm:h-14 sm:w-14"
            />
            <img
              src={contosMarkDark}
              alt=""
              aria-hidden="true"
              className="mb-5 hidden h-12 w-12 object-contain dark:block sm:mb-6 sm:h-14 sm:w-14"
            />
            <h2 className="font-serif text-3xl tracking-tight text-ink sm:text-4xl md:text-5xl">
              {welcomeGreeting}
            </h2>
            <p className="mt-3 max-w-xl text-sm text-ink-muted sm:text-base">
              {t('agents.welcome.subtitle')}
            </p>

            {sendError ? (
              <div className="mt-4 flex w-full items-center gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-left text-sm text-red-700">
                <p className="min-w-0 flex-1">{sendError}</p>
                <button
                  type="button"
                  onClick={() => setSendError(null)}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-red-700 transition hover:bg-red-100"
                  aria-label={t('common.close')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ) : null}

            <div className="mt-6 w-full sm:mt-8">{renderComposer(true)}</div>
            <div className="mt-6 w-full sm:mt-8">{suggestionPills}</div>
          </div>
        </section>
      ) : (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            ref={messageListRef}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto py-2 sm:space-y-4 sm:py-3"
            onScroll={(event) => {
              if (!event.nativeEvent.isTrusted) return
              const list = event.currentTarget
              const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight
              stickToBottomRef.current = distanceFromBottom < 96
            }}
          >
            {conversationMessages
              .filter((message) => {
                if (message.role === 'user') return true
                if (message.proposalForPostId) return message.content.trim().length > 0
                if (resolveAssistantOutput(message)) return true
                return message.content.trim().length > 0
              })
              .map((message) => {
                const structuredOutput =
                  message.role === 'assistant' && !message.proposalForPostId
                    ? resolveAssistantOutput(message)
                    : null
                const proposalPost =
                  message.proposalForPostId && proposal?.messageId === message.id
                    ? reviewPosts.find((post) => post.id === message.proposalForPostId) ?? null
                    : null
                const revision = message.proposalForPostId
                  ? extractRevision(
                      message.output ?? message.content,
                      reviewPlatformForAgent(message.agentType),
                    )
                  : null
                const proposalText =
                  proposalPost && proposal ? proposal.text : revision?.text ?? ''
                const content = message.proposalForPostId
                  ? proposalText && !proposalText.trim().startsWith('{')
                    ? proposalText
                    : message.content.trim().startsWith('{')
                      ? t('agents.drafts.proposalFailed')
                      : message.content
                  : message.content
                const messageIndex = messages.findIndex((item) => item.id === message.id)
                const following = messageIndex >= 0 ? messages[messageIndex + 1] : undefined
                const linkedPost =
                  message.role === 'user' && !message.draftPreview && following?.proposalForPostId
                    ? reviewPosts.find((post) => post.id === following.proposalForPostId) ?? null
                    : null
                const preview = message.draftPreview
                  ? message.draftPreview
                  : linkedPost
                    ? {
                        platform: linkedPost.platform,
                        excerpt: draftPreviewText(linkedPost.text),
                      }
                    : null

                return (
                  <div key={message.id} id={`chat-msg-${message.id}`} className="px-4 sm:px-8">
                    <ChatMessageBubble
                      role={message.role}
                      content={content}
                      taggedAvatarNames={message.taggedAvatarNames}
                      agentType={message.agentType}
                      structuredOutput={structuredOutput}
                      avatarId={projectId}
                      replyTo={message.replyTo}
                      draftPreview={
                        preview
                          ? {
                              label: t('agents.drafts.attachedPreview', {
                                platform: draftPlatformName(preview.platform, t),
                              }),
                              excerpt: preview.excerpt,
                            }
                          : undefined
                      }
                      onReply={() => {
                        const target = replyTargetForMessage(message)
                        if (!target) return
                        setDraftTargetId(null)
                        setReplyTarget(target)
                        inputRef.current?.focus()
                      }}
                      onJumpToReply={jumpToMessage}
                      footer={
                        proposalPost ? (
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              className="contos-btn contos-btn--rect"
                              onClick={() => acceptChatProposal(proposalPost)}
                            >
                              {t('agents.drafts.accept')}
                            </button>
                            <button
                              type="button"
                              className="contos-btn contos-btn--rect contos-btn--secondary"
                              onClick={() => {
                                setDismissedProposalIds((current) => new Set(current).add(message.id))
                                setProposal(null)
                              }}
                            >
                              {t('agents.drafts.reject')}
                            </button>
                          </div>
                        ) : null
                      }
                    />
                  </div>
                )
              })}
            {showWaitingIndicator ? (
              <AgentRespondingIndicator
                active={showWaitingIndicator}
                markSrc={contosMark}
                markDarkSrc={contosMarkDark}
                ariaLabel={t('agents.respondingAria')}
              />
            ) : null}
          </div>

          {sendError ? (
            <div className="flex items-center gap-3 border-t border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700 sm:px-8">
              <p className="min-w-0 flex-1">{sendError}</p>
              <button
                type="button"
                onClick={() => setSendError(null)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-red-700 transition hover:bg-red-100"
                aria-label={t('common.close')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ) : null}
          {syncError ? (
            <p className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-800 sm:px-8">
              {t('agents.chatSyncPrefix', { message: syncError })}
            </p>
          ) : null}

          <div className="shrink-0 border-t border-border-hairline px-4 pt-3 sm:px-8 sm:pt-4">
            {renderComposer(false)}
          </div>
        </section>
      )}
        </div>
        {draftsOpen ? (
          <button
            type="button"
            className="fixed inset-0 z-30 bg-ink/20 lg:hidden"
            aria-label={t('agents.drafts.close')}
            onClick={() => setDraftsOpen(false)}
          />
        ) : null}
        {draftsOpen ? (
          <div className="fixed inset-y-0 right-0 z-40 flex h-dvh min-h-0 w-full max-w-md flex-col lg:static lg:z-auto lg:h-full lg:max-h-full lg:w-[24rem] lg:max-w-none lg:shrink-0 lg:self-stretch">
            <DraftsSidebar
              posts={reviewPosts}
              avatarId={project.id}
              busy={showResponding}
              scheduling={scheduling}
              acceptedRevision={acceptedRevision}
              report={scheduleReport}
              onClose={() => setDraftsOpen(false)}
              onPatch={(post) =>
                setMessages((current) =>
                  patchReviewPost(current, post.messageId, post.id, () => post),
                )
              }
              onDelete={(post) => {
                setMessages((current) => hideReviewPost(current, post.messageId, post.id))
                setProposal((current) => (current?.postId === post.id ? null : current))
                setDraftTargetId((current) => (current === post.id ? null : current))
              }}
              onAddToChat={(post) => {
                setDraftTargetId(post.id)
                setReplyTarget(null)
                inputRef.current?.focus()
              }}
              onCommit={(post, localDateTime, mode) => void commitOne(post, localDateTime, mode)}
            />
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  )
}
