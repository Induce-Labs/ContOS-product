import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { avatarTypeLabel, MAX_AVATARS } from '../lib/avatars'
import { fetchCompetitorsForProject, type Competitor } from '../lib/competitors'
import type { Project } from '../lib/projects'
import { DashboardLayout } from '../components/dashboard/DashboardLayout'
import { IncompleteProfilingBanner } from '../components/dashboard/IncompleteProfilingBanner'
import {
  AgentTypePills,
} from '../components/agents/AgentChatHistoryPanel'
import { useDashboardShell } from '../hooks/useDashboardShell'
import {
  AgentsApiError,
  getUserFirstName,
  isAgentsWelcomeMessage,
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
  detectPlatformFromRedirectAsk,
  detectPlatformRedirectRequest,
  isAffirmativeReply,
  isNegativeReply,
  platformLabel,
  type PlatformAgent,
} from '../lib/agentPlatformRedirect'
import contosMark from '../assets/contos-mark.png'
import { ChatMessageBubble } from '../components/agents/ChatMessageBubble'
import { buildChatHistoryForInvoke } from '../lib/agentChatMemory'
import { resolveInvokeTaggedAvatarIds } from '../lib/agentMentions'
import { resolveUiLanguage } from '../lib/profilingLocaleCore'
import {
  fetchRemoteChatStore,
  upsertRemoteChatStore,
} from '../lib/agentChatRemote'
import {
  createEmptyStore,
  getActiveSession,
  loadChatStore,
  saveChatStore,
  sessionHasUserMessages,
  startNewChatSession,
  storeHasUserMessages,
  storeUpdatedAtMs,
  switchChatSession,
  updateActiveSessionMessages,
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
  const trimmed = content.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return isStructuredAgentOutput(parsed) ? parsed : null
  } catch {
    return null
  }
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
  const navigate = useNavigate()
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
      if (pending?.agentType === 'linkedin' || pending?.agentType === 'instagram' || pending?.agentType === 'chatbot') {
        return pending.agentType
      }
      const stored = sessionStorage.getItem('contos_agents_agent_type')
      if (stored === 'linkedin' || stored === 'instagram' || stored === 'chatbot') {
        return stored
      }
    } catch {
      // ignore
    }
    return 'chatbot'
  })
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatStore, setChatStore] = useState<ChatStore | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [awaitingCatchUp, setAwaitingCatchUp] = useState(() => {
    const pending = getPendingAgentCatchUp()
    return Boolean(pending)
  })
  const [sendError, setSendError] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [taggedAvatarIds, setTaggedAvatarIds] = useState<string[]>([])
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [pendingPlatformRedirect, setPendingPlatformRedirect] =
    useState<PlatformAgent | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const chatStoreRef = useRef<ChatStore | null>(null)
  const skipPersistRef = useRef(false)
  const remoteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const handleNewChatRef = useRef<() => void>(() => {})
  const tRef = useRef(t)
  tRef.current = t

  const showResponding = streaming || awaitingCatchUp
  const pendingCatchUp = getPendingAgentCatchUp()
  const pendingAssistantId =
    pendingCatchUp && pendingCatchUp.projectId === projectId
      ? pendingCatchUp.assistantId
      : null

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
      if (next === 'linkedin' || next === 'instagram' || next === 'chatbot') {
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
          setSyncError(
            error instanceof Error
              ? error.message
              : t('agents.syncToFailed'),
          )
        })
    }, 600)
  }

  useEffect(() => {
    void refreshProjects()
  }, [refreshProjects])

  useEffect(() => {
    let mounted = true

    async function load() {
      const translate = tRef.current
      if (!projectId) {
        setLoadError(translate('agents.missingProjectId'))
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      setLoadError(null)
      setSyncError(null)

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

        skipPersistRef.current = true
        chatStoreRef.current = store
        setChatStore(store)
        const storedMessages = getActiveSession(store).messages as ChatMessage[]
        const live = getActiveAgentStream()
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

        if (!user?.id) {
          return
        }

        try {
          const remote = await fetchRemoteChatStore(user.id, projectId, welcome)
          if (!mounted) return

          if (remote) {
            const localEmpty = !storeHasUserMessages(store)
            const remoteHasHistory = storeHasUserMessages(remote.store)
            const localTs = storeUpdatedAtMs(store)
            const remoteTs = new Date(remote.updatedAt).getTime()
            // Prefer cloud when local is welcome-only (e.g. post-logout), even if
            // a local welcome refresh made updatedAt look newer.
            if ((localEmpty && remoteHasHistory) || remoteTs >= localTs) {
              const liveAfterRemote = getActiveAgentStream()
              if (liveAfterRemote?.projectId === projectId && liveAfterRemote.streaming) {
                // Keep local in-memory thread while SSE is still running.
              } else {
                store = remote.store
                skipPersistRef.current = true
                chatStoreRef.current = store
                setChatStore(store)
                setMessages(getActiveSession(store).messages as ChatMessage[])
                saveChatStore(user.id, projectId, store)
              }
            } else if (storeHasUserMessages(store)) {
              await upsertRemoteChatStore(user.id, projectId, store)
            }
          } else if (storeHasUserMessages(store)) {
            await upsertRemoteChatStore(user.id, projectId, store)
          }

          // Refresh greeting only after remote merge, and only on empty threads.
          if (!sessionHasUserMessages(getActiveSession(store).messages)) {
            store = startNewChatSession(store, welcome)
            skipPersistRef.current = true
            chatStoreRef.current = store
            setChatStore(store)
            setMessages(getActiveSession(store).messages as ChatMessage[])
            saveChatStore(user.id, projectId, store)
          }

          if (mounted) setSyncError(null)
        } catch (error) {
          if (mounted) {
            setSyncError(
              error instanceof Error
                ? error.message
                : translate('agents.syncFromFailed'),
            )
          }
          // Still refresh empty greeting when remote sync fails.
          if (!sessionHasUserMessages(getActiveSession(store).messages)) {
            store = startNewChatSession(store, welcome)
            skipPersistRef.current = true
            chatStoreRef.current = store
            setChatStore(store)
            setMessages(getActiveSession(store).messages as ChatMessage[])
          }
        }
      } catch (error) {
        if (mounted) {
          setLoadError(
            error instanceof Error
              ? error.message
              : tRef.current('agents.loadFailed'),
          )
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
            if (
              pending.agentType === 'linkedin' ||
              pending.agentType === 'instagram' ||
              pending.agentType === 'chatbot'
            ) {
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
      if (
        snapshot.agentType === 'linkedin' ||
        snapshot.agentType === 'instagram' ||
        snapshot.agentType === 'chatbot'
      ) {
        setAgentType(snapshot.agentType)
      }
      setMessages((current) => {
        const hasAssistant = current.some((m) => m.id === snapshot.assistantId)
        const formatted =
          snapshot.output != null && isStructuredAgentOutput(snapshot.output)
            ? formatStructuredAgentOutput(snapshot.output)
            : ''
        const apply = (message: ChatMessage): ChatMessage => {
          if (message.id !== snapshot.assistantId) return message
          const nextContent =
            typeof snapshot.output === 'string' && snapshot.output.trim()
              ? snapshot.output
              : formatted.trim()
                ? formatted
                : snapshot.content || message.content
          const next: ChatMessage = {
            ...message,
            content: nextContent,
            agentType: snapshot.agentType as AgentType,
          }
          if (snapshot.output != null && isStructuredAgentOutput(snapshot.output)) {
            next.output = snapshot.output
          }
          return next
        }
        if (hasAssistant) {
          return current.map(apply)
        }
        return [
          ...current,
          {
            id: snapshot.assistantId,
            role: 'assistant',
            content:
              typeof snapshot.output === 'string' && snapshot.output.trim()
                ? snapshot.output
                : formatted.trim()
                  ? formatted
                  : snapshot.content,
            agentType: snapshot.agentType as AgentType,
            ...(snapshot.output != null && isStructuredAgentOutput(snapshot.output)
              ? { output: snapshot.output }
              : {}),
          },
        ]
      })
      if (snapshot.error) {
        setSendError(snapshot.error)
        setAwaitingCatchUp(false)
        setMessages((current) =>
          current.map((entry) =>
            entry.id === snapshot.assistantId && !entry.content.trim()
              ? {
                  ...entry,
                  content: tRef.current('agents.sorryPrefix', {
                    message: snapshot.error,
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
      if (
        pending.agentType === 'linkedin' ||
        pending.agentType === 'instagram' ||
        pending.agentType === 'chatbot'
      ) {
        setAgentType(pending.agentType)
      }
    }
  }, [projectId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, showResponding])

  useEffect(() => {
    if (!user?.id || !projectId || !chatStoreRef.current) {
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
    setSendError(null)
    setPendingPlatformRedirect(null)
    if (user?.id && projectId) {
      saveChatStore(user.id, projectId, next)
      window.dispatchEvent(
        new CustomEvent('contos-chat-store-updated', { detail: { projectId } }),
      )
      queueRemoteSave(user.id, projectId, next)
    }
  }
  handleNewChatRef.current = handleNewChat

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
      setInput(`${input.slice(0, atIndex)}@${avatar.name} `)
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

    setSendError(null)
    setInput('')
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
    }

    // Chat → Instagram / LinkedIn handoff (confirm then auto-switch chip).
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

      if (inferredPending && isAffirmativeReply(text)) {
        const label = platformLabel(inferredPending)
        const assistantMessage: ChatMessage = {
          id: newId(),
          role: 'assistant',
          content: t('agents.platformRedirect.switched', { platform: label }),
          agentType: inferredPending,
        }
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
        setMessages((current) => [...current, userMessage, assistantMessage])
        setPendingPlatformRedirect(null)
        return
      }

      const requestedPlatform = detectPlatformRedirectRequest(text)
      // Already inside agentType === 'chatbot'; any detected platform differs.
      if (requestedPlatform) {
        const label = platformLabel(requestedPlatform)
        const assistantMessage: ChatMessage = {
          id: newId(),
          role: 'assistant',
          content: t('agents.platformRedirect.ask', { platform: label }),
          agentType: 'chatbot',
        }
        setMessages((current) => [...current, userMessage, assistantMessage])
        setPendingPlatformRedirect(requestedPlatform)
        return
      }

      // Any other message clears a stale pending redirect offer.
      if (pendingPlatformRedirect) {
        setPendingPlatformRedirect(null)
      }
    }

    const chatHistory = buildChatHistoryForInvoke(messages)
    const assistantId = newId()
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: 'assistant', content: '', agentType },
    ])
    setStreaming(true)
    setAwaitingCatchUp(true)

    try {
      await runAgentStream({
        projectId,
        assistantId,
        agentType,
        body: {
          avatar_id: projectId,
          agent_type: agentType,
          user_input: text,
          chatbot_context_on: true,
          tagged_avatar_ids: extraTaggedIds.length > 0 ? extraTaggedIds : undefined,
          chat_history: chatHistory.length > 0 ? chatHistory : undefined,
          response_language: resolveUiLanguage(i18n.language),
        },
        handlers: {
          onComplete: (data) => {
            const output = data.output
            const formatted = formatAgentOutput(output)
            if (agentType === 'chatbot' && typeof output === 'string') {
              const offered = detectPlatformFromRedirectAsk(output)
              if (offered) {
                setPendingPlatformRedirect(offered)
              }
            }
            setMessages((current) =>
              current.map((message) => {
                if (message.id !== assistantId) {
                  return message
                }
                if (isStructuredAgentOutput(output)) {
                  return {
                    ...message,
                    content: formatted || message.content,
                    output,
                    agentType,
                  }
                }
                // Prefer the full complete payload over partial streamed tokens
                // (tokens may be dropped when the tab was backgrounded).
                if (typeof output === 'string' && output.trim()) {
                  return {
                    ...message,
                    content: output,
                    agentType,
                  }
                }
                if (formatted) {
                  return {
                    ...message,
                    content: formatted,
                    agentType,
                  }
                }
                return { ...message, agentType }
              }),
            )
          },
          onError: (message) => {
            setSendError(message)
            setMessages((current) =>
              current.map((entry) =>
                entry.id === assistantId && !entry.content.trim()
                  ? { ...entry, content: t('agents.sorryPrefix', { message }) }
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
      const message =
        error instanceof AgentsApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : t('agents.reachFailed')
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
        <Link to="/dashboard" className="mt-4 inline-block text-sm text-accent-primary">
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
  const headerActionClassName =
    'inline-flex items-center gap-1.5 rounded-full bg-accent-primary-soft px-3.5 py-2 text-sm font-semibold text-accent-primary-deep transition hover:bg-accent-primary/20'

  const headerActions = (
    <div className="flex shrink-0 items-center gap-2">
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

  function renderComposer(centeredTags = false) {
    return (
      <form className="w-full" onSubmit={(event) => void handleSend(event)}>
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
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted"
            >
              <MicIcon />
            </button>
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
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-primary text-white transition hover:bg-accent-primary-deep disabled:opacity-60"
              aria-label={showResponding ? t('agents.sendingAria') : t('agents.sendAria')}
            >
              ↑
            </button>
          </div>
        </div>
      </form>
    )
  }

  const suggestionPills = (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => navigate(`/dashboard/${project.id}`)}
        className="inline-flex items-center gap-2 rounded-full border border-border-hairline bg-canvas-raised px-3.5 py-2 text-sm font-medium text-accent-primary transition hover:border-accent-primary/30 hover:bg-accent-primary-soft/40"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4 shrink-0" aria-hidden>
          <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10c.8.8 1.2 1.6 1.2 2.5V17h5.6v-1.5c0-.9.4-1.7 1.2-2.5A6 6 0 0 0 12 3Z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t('agents.quickActions.researchTitle')}
      </button>
      <button
        type="button"
        onClick={() => {
          handleInputChange(t('agents.quickActions.contentPrompt'))
          inputRef.current?.focus()
        }}
        className="inline-flex items-center gap-2 rounded-full border border-border-hairline bg-canvas-raised px-3.5 py-2 text-sm font-medium text-accent-primary transition hover:border-accent-primary/30 hover:bg-accent-primary-soft/40"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4 shrink-0" aria-hidden>
          <path d="M7 4h8l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
          <path d="M14 4v5h5M9 13h6M9 17h4" strokeLinecap="round" />
        </svg>
        {t('agents.quickActions.contentTitle')}
      </button>
      <button
        type="button"
        onClick={() => navigate(`/dashboard/${project.id}/calendar`)}
        className="inline-flex items-center gap-2 rounded-full border border-border-hairline bg-canvas-raised px-3.5 py-2 text-sm font-medium text-accent-primary transition hover:border-accent-primary/30 hover:bg-accent-primary-soft/40"
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
      mainClassName="flex min-h-0 flex-col overflow-hidden px-4 pb-3 pt-4 sm:px-8 sm:pt-6"
    >
      <IncompleteProfilingBanner
        projectId={project.id}
        profilingCompleteness={project.profiling_completeness}
      />

      {!showClaudeStyleGreeting ? (
        <div className="mb-3 shrink-0">
          <div className="flex items-center justify-between gap-4">
            <h1 className="min-w-0 truncate font-serif text-2xl leading-none text-ink sm:text-3xl">
              {project.name}
            </h1>
            {headerActions}
          </div>
          <p className="mt-1.5 truncate text-xs text-ink-muted sm:text-sm">
            {t('agents.pageSubtitle')}
          </p>
          <div className="mt-3">
            <AgentTypePills
              agentType={agentType}
              streaming={showResponding}
              options={agentOptions}
              onChange={(next) => {
                setPendingPlatformRedirect(null)
                setAgentType(next)
              }}
            />
          </div>
        </div>
      ) : (
        <div className="mb-2 flex shrink-0 justify-end">{headerActions}</div>
      )}

      {showResearchInProgressBanner ? (
        <div className="mb-2 shrink-0 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {t('agents.researchInProgress')}{' '}
          <Link className="font-medium underline" to={`/dashboard/${projectId}`}>
            {t('agents.viewProgress')}
          </Link>
        </div>
      ) : null}

      {showClaudeStyleGreeting ? (
        <section className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-1 pb-4 pt-2">
          <div className="flex w-full max-w-3xl flex-col items-center rounded-[2rem] border border-border-hairline bg-canvas-raised px-5 py-8 text-center shadow-[0_18px_50px_rgba(28,27,41,0.08)] sm:px-10 sm:py-10">
            <img
              src={contosMark}
              alt=""
              aria-hidden="true"
              className="mb-5 h-12 w-12 object-contain sm:mb-6 sm:h-14 sm:w-14"
            />
            <h2 className="font-serif text-3xl tracking-tight text-ink sm:text-4xl md:text-5xl">
              {welcomeGreeting}
            </h2>
            <p className="mt-3 max-w-xl text-sm text-ink-muted sm:text-base">
              {t('agents.welcome.subtitle')}
            </p>

            <div className="mt-6 sm:mt-8">
              <AgentTypePills
                agentType={agentType}
                streaming={showResponding}
                options={agentOptions}
                onChange={(next) => {
                  setPendingPlatformRedirect(null)
                  setAgentType(next)
                }}
              />
            </div>

            {sendError ? (
              <p className="mt-4 w-full rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-left text-sm text-red-700">
                {sendError}
              </p>
            ) : null}

            <div className="mt-6 w-full sm:mt-8">{renderComposer(true)}</div>
            <div className="mt-6 w-full sm:mt-8">{suggestionPills}</div>
          </div>
        </section>
      ) : (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem] border border-border-hairline bg-canvas-raised shadow-[0_18px_50px_rgba(28,27,41,0.08)]">
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4 sm:px-6">
            {conversationMessages
              .filter((message) => {
                if (message.role === 'user') return true
                if (resolveAssistantOutput(message)) return true
                return message.content.trim().length > 0
              })
              .map((message) => {
                const structuredOutput =
                  message.role === 'assistant' ? resolveAssistantOutput(message) : null

                return (
                  <ChatMessageBubble
                    key={message.id}
                    role={message.role}
                    content={message.content}
                    taggedAvatarNames={message.taggedAvatarNames}
                    agentType={message.agentType}
                    structuredOutput={structuredOutput}
                  />
                )
              })}
            {showResponding ? (
              <div
                className="flex items-center gap-2.5 py-0.5"
                aria-live="polite"
                aria-label={t('agents.respondingAria')}
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas-raised shadow-[0_2px_8px_rgba(28,27,41,0.06)] ring-1 ring-border-hairline">
                  <img
                    src={contosMark}
                    alt=""
                    aria-hidden="true"
                    className="contos-mark-loading h-5 w-5 object-contain"
                  />
                </span>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          {sendError ? (
            <p className="border-t border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
              {sendError}
            </p>
          ) : null}
          {syncError ? (
            <p className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              {t('agents.chatSyncPrefix', { message: syncError })}
            </p>
          ) : null}

          <div className="shrink-0 border-t border-border-hairline px-3 py-3 sm:px-5 sm:py-4">
            {renderComposer(false)}
          </div>
        </section>
      )}
    </DashboardLayout>
  )
}
