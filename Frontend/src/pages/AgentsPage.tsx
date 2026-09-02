import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { avatarTypeLabel } from '../lib/avatars'
import { fetchCompetitorsForProject, type Competitor } from '../lib/competitors'
import type { Project } from '../lib/projects'
import { DashboardLayout } from '../components/dashboard/DashboardLayout'
import { IncompleteProfilingBanner } from '../components/dashboard/IncompleteProfilingBanner'
import {
  AgentChatHistoryPanel,
  AgentTypePills,
} from '../components/agents/AgentChatHistoryPanel'
import { useDashboardShell } from '../hooks/useDashboardShell'
import {
  AGENTS_WELCOME_MESSAGE,
  invokeAgentStream,
  type AgentType,
} from '../lib/agentsApi'
import { buildChatHistoryForInvoke } from '../lib/agentChatMemory'
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
  taggedAvatarIds?: string[]
  taggedAvatarNames?: string[]
}

const AGENT_OPTIONS: Array<{ value: AgentType; label: string }> = [
  { value: 'chatbot', label: 'Chat' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'instagram', label: 'Instagram' },
]

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function makeWelcomeMessage(): ChatMessage {
  return {
    id: newId(),
    role: 'assistant',
    content: AGENTS_WELCOME_MESSAGE,
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
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

export function AgentsPage() {
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
  const [agentType, setAgentType] = useState<AgentType>('chatbot')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatStore, setChatStore] = useState<ChatStore | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [taggedAvatarIds, setTaggedAvatarIds] = useState<string[]>([])
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const chatStoreRef = useRef<ChatStore | null>(null)
  const skipPersistRef = useRef(false)
  const remoteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

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
              : 'Failed to sync chat history to Supabase.',
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
      if (!projectId) {
        setLoadError('Missing project id.')
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

        const welcome = makeWelcomeMessage() as StoredChatMessage
        let store = user?.id
          ? loadChatStore(user.id, projectId, welcome)
          : createEmptyStore(welcome)

        skipPersistRef.current = true
        chatStoreRef.current = store
        setChatStore(store)
        setMessages(getActiveSession(store).messages as ChatMessage[])
        setHistoryPanel(searchParams.get('panel') === 'history')
        setIsLoading(false)

        if (!user?.id) {
          return
        }

        try {
          const remote = await fetchRemoteChatStore(user.id, projectId, welcome)
          if (!mounted) return

          if (remote) {
            const localTs = storeUpdatedAtMs(store)
            const remoteTs = new Date(remote.updatedAt).getTime()
            if (remoteTs >= localTs) {
              store = remote.store
              skipPersistRef.current = true
              chatStoreRef.current = store
              setChatStore(store)
              setMessages(getActiveSession(store).messages as ChatMessage[])
              saveChatStore(user.id, projectId, store)
            } else if (sessionHasUserMessages(getActiveSession(store).messages)) {
              await upsertRemoteChatStore(user.id, projectId, store)
            }
          } else if (sessionHasUserMessages(getActiveSession(store).messages)) {
            await upsertRemoteChatStore(user.id, projectId, store)
          }
          if (mounted) setSyncError(null)
        } catch (error) {
          if (mounted) {
            setSyncError(
              error instanceof Error
                ? error.message
                : 'Failed to sync chat history from Supabase.',
            )
          }
        }
      } catch (error) {
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load Agents.')
          setIsLoading(false)
        }
      }
    }

    void load()
    return () => {
      mounted = false
      abortRef.current?.abort()
      if (remoteSaveTimerRef.current) {
        clearTimeout(remoteSaveTimerRef.current)
      }
    }
  }, [projectId, user?.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming, statusText])

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
    // Avoid writing every SSE token to Supabase — sync when stream settles.
    if (!streaming) {
      queueRemoteSave(user.id, projectId, next)
    }
  }, [messages, user?.id, projectId, streaming])

  useEffect(() => {
    setHistoryOpen(searchParams.get('panel') === 'history')
  }, [searchParams])

  function setHistoryPanel(open: boolean) {
    setHistoryOpen(open)
    if (open) {
      setSearchParams({ panel: 'history' }, { replace: true })
      return
    }
    setSearchParams({}, { replace: true })
  }

  function handleNewChat() {
    if (streaming) {
      abortRef.current?.abort()
      setStreaming(false)
      setStatusText('')
    }
    const welcome = makeWelcomeMessage() as StoredChatMessage
    const base = chatStoreRef.current ?? createEmptyStore(welcome)
    const next = startNewChatSession(base, welcome)
    skipPersistRef.current = true
    chatStoreRef.current = next
    setChatStore(next)
    setMessages(getActiveSession(next).messages as ChatMessage[])
    setSendError(null)
    setHistoryPanel(false)
    if (user?.id && projectId) {
      saveChatStore(user.id, projectId, next)
      queueRemoteSave(user.id, projectId, next)
    }
  }

  function handleSelectSession(sessionId: string) {
    if (!chatStoreRef.current) {
      return
    }
    if (streaming) {
      abortRef.current?.abort()
      setStreaming(false)
      setStatusText('')
    }
    try {
      const next = switchChatSession(chatStoreRef.current, sessionId)
      skipPersistRef.current = true
      chatStoreRef.current = next
      setChatStore(next)
      setMessages(getActiveSession(next).messages as ChatMessage[])
      setSendError(null)
      setHistoryPanel(false)
      if (user?.id && projectId) {
        saveChatStore(user.id, projectId, next)
        queueRemoteSave(user.id, projectId, next)
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Could not open that chat.')
    }
  }

  const researchReady =
    project?.status === 'ready' ||
    competitors.some((competitor) => competitor.pipeline_step === 'done')

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
      setInput(input.slice(0, atIndex).trimEnd())
    }
    setMentionOpen(false)
    setMentionQuery('')
    inputRef.current?.focus()
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault()
    if (!projectId || streaming) {
      return
    }

    const text = input.trim()
    if (!text) {
      return
    }

    setSendError(null)
    setInput('')
    const taggedNames = taggedAvatarIds
      .map((id) => projects.find((avatar) => avatar.id === id)?.name)
      .filter((name): name is string => !!name)
    const chatHistory = buildChatHistoryForInvoke(messages)
    const userMessage: ChatMessage = {
      id: newId(),
      role: 'user',
      content: text,
      taggedAvatarIds: [...taggedAvatarIds],
      taggedAvatarNames: taggedNames,
    }
    const assistantId = newId()
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: 'assistant', content: '', agentType },
    ])
    setStreaming(true)
    setStatusText('Thinking…')

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      await invokeAgentStream(
        {
          avatar_id: projectId,
          agent_type: agentType,
          user_input: text,
          chatbot_context_on: true,
          tagged_avatar_ids: taggedAvatarIds.length > 0 ? taggedAvatarIds : undefined,
          chat_history: chatHistory.length > 0 ? chatHistory : undefined,
        },
        {
          onStatus: (data) => {
            const stage = typeof data.stage === 'string' ? data.stage : 'working'
            setStatusText(stage)
          },
          onToken: (token) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: `${message.content}${token}` }
                  : message,
              ),
            )
          },
          onComplete: (data) => {
            const formatted = formatAgentOutput(data.output)
            if (formatted) {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        content: message.content.trim() ? message.content : formatted,
                      }
                    : message,
                ),
              )
            }
            setStatusText('')
          },
          onError: (message) => {
            setSendError(message)
            setMessages((current) =>
              current.map((entry) =>
                entry.id === assistantId && !entry.content.trim()
                  ? { ...entry, content: `Sorry — ${message}` }
                  : entry,
              ),
            )
          },
        },
        controller.signal,
      )
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return
      }
      const message =
        error instanceof Error ? error.message : 'Failed to reach ContOS Agents.'
      setSendError(message)
      setMessages((current) =>
        current.map((entry) =>
          entry.id === assistantId && !entry.content.trim()
            ? { ...entry, content: `Sorry — ${message}` }
            : entry,
        ),
      )
    } finally {
      setStreaming(false)
      setStatusText('')
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
        <p className="text-sm text-red-700">{loadError ?? 'Project unavailable.'}</p>
        <Link to="/dashboard" className="mt-4 inline-block text-sm text-accent-primary">
          Back to dashboard
        </Link>
      </DashboardLayout>
    )
  }

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
      mainClassName="flex min-h-0 flex-col overflow-hidden px-4 pb-2 pt-0 sm:px-8"
    >
      <IncompleteProfilingBanner
        projectId={project.id}
        profilingCompleteness={project.profiling_completeness}
      />

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl leading-tight text-ink sm:text-3xl">{project.name}</h1>
          <p className="mt-0.5 truncate text-xs text-ink-muted sm:text-sm">
            Ask for strategies and content ideas from your competitor research.
          </p>
        </div>
        <button
          type="button"
          onClick={handleNewChat}
          className="shrink-0 rounded-full bg-accent-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-primary-deep"
        >
          New chat
        </button>
      </div>

      {historyOpen ? (
        <AgentChatHistoryPanel
          chatStore={chatStore}
          onSelectSession={handleSelectSession}
          onClose={() => setHistoryPanel(false)}
        />
      ) : null}

      {!researchReady ? (
        <div className="mb-2 shrink-0 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          Research is still in progress. Competitor-grounded answers work best after scraping
          finishes.{' '}
          <Link className="font-medium underline" to={`/dashboard/${projectId}`}>
            View progress
          </Link>
        </div>
      ) : null}

      <div className="mb-2 shrink-0">
        <AgentTypePills
          agentType={agentType}
          streaming={streaming}
          options={AGENT_OPTIONS}
          onChange={setAgentType}
        />
      </div>

      <section className="flex min-h-0 flex-1 flex-col rounded-[1.75rem] border border-white/80 bg-white/90 shadow-[0_18px_50px_rgba(28,27,41,0.06)]">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
                message.role === 'user'
                  ? 'ml-auto bg-accent-primary text-white'
                  : 'bg-canvas text-ink'
              }`}
            >
              {message.taggedAvatarNames && message.taggedAvatarNames.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-1">
                  {message.taggedAvatarNames.map((name) => (
                    <span
                      key={name}
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        message.role === 'user'
                          ? 'bg-white/20 text-white'
                          : 'bg-accent-primary-soft text-accent-primary-deep'
                      }`}
                    >
                      {name}
                    </span>
                  ))}
                </div>
              ) : null}
              {message.content || (streaming ? '…' : '')}
            </div>
          ))}
          {statusText ? (
            <p className="text-xs uppercase tracking-wide text-ink-muted">{statusText}</p>
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
            Chat sync: {syncError}
          </p>
        ) : null}

        <form className="p-3 sm:p-4" onSubmit={(event) => void handleSend(event)}>
          {taggedAvatarIds.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
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
              <div className="absolute bottom-full left-0 z-10 mb-2 max-h-48 w-64 overflow-y-auto rounded-xl border border-border-hairline bg-white shadow-lg">
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
            <div className="flex items-center gap-2 rounded-full border border-border-hairline bg-white px-4 py-2 shadow-[0_10px_30px_rgba(116,79,185,0.12)]">
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => handleInputChange(event.target.value)}
                disabled={streaming}
                placeholder="Ask ContOS anything about your brand… Type @ to tag avatars"
                className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-ink outline-none"
              />
              <button
                type="submit"
                disabled={streaming || !input.trim()}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-primary text-white transition hover:bg-accent-primary-deep disabled:opacity-60"
                aria-label={streaming ? 'Sending' : 'Send'}
              >
                ↑
              </button>
            </div>
          </div>
        </form>
      </section>
    </DashboardLayout>
  )
}

