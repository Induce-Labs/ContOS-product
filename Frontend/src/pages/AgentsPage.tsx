import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { fetchUserProjects, setLastUsedProjectId, type Project } from '../lib/projects'
import { fetchCompetitorsForProject, type Competitor } from '../lib/competitors'
import { DashboardSidebar } from '../components/dashboard/DashboardSidebar'
import {
  AGENTS_WELCOME_MESSAGE,
  invokeAgentStream,
  type AgentType,
} from '../lib/agentsApi'

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
  { value: 'playbook', label: 'Playbook' },
]

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`
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
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [selectedCompetitorId, setSelectedCompetitorId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [agentType, setAgentType] = useState<AgentType>('chatbot')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [taggedAvatarIds, setTaggedAvatarIds] = useState<string[]>([])
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const welcomeSeededForProject = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

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

      try {
        const userProjects = await fetchUserProjects()
        const selected = userProjects.find((entry) => entry.id === projectId) ?? null
        if (!selected) {
          throw new Error('Project not found or you do not have access to it.')
        }
        const projectCompetitors = await fetchCompetitorsForProject(projectId)
        if (!mounted) {
          return
        }
        setProjects(userProjects)
        setProject(selected)
        setLastUsedProjectId(selected.id)
        setCompetitors(projectCompetitors)
        setSelectedCompetitorId(projectCompetitors[0]?.id ?? null)

        if (welcomeSeededForProject.current !== projectId) {
          welcomeSeededForProject.current = projectId
          setMessages([
            {
              id: newId(),
              role: 'assistant',
              content: AGENTS_WELCOME_MESSAGE,
              agentType: 'chatbot',
            },
          ])
        }
      } catch (error) {
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load Agents.')
        }
      } finally {
        if (mounted) {
          setIsLoading(false)
        }
      }
    }

    void load()
    return () => {
      mounted = false
      abortRef.current?.abort()
    }
  }, [projectId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming, statusText])

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

  async function handleSignOut() {
    setIsSigningOut(true)
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch {
      setIsSigningOut(false)
    }
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

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-ink-muted">
        Loading Agents…
      </div>
    )
  }

  if (loadError || !project || !projectId) {
    return (
      <div className="min-h-screen bg-canvas px-6 py-10">
        <p className="text-sm text-red-700">{loadError ?? 'Project unavailable.'}</p>
        <Link to="/dashboard" className="mt-4 inline-block text-sm text-accent-primary">
          Back to dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      <header className="shrink-0 border-b border-border-hairline bg-canvas-raised">
        <div className="flex items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <p className="text-sm font-medium text-accent-primary">ContOS</p>
            <h1 className="text-lg font-semibold text-ink">Command center</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-ink-muted sm:inline">{user?.email}</span>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={isSigningOut}
              className="rounded-xl border border-border-hairline px-4 py-2 text-sm text-ink transition hover:bg-accent-primary-soft disabled:opacity-60"
            >
              {isSigningOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-row">
        <DashboardSidebar
          projects={projects}
          activeProject={project}
          competitors={competitors}
          selectedCompetitorId={selectedCompetitorId}
          onSelectCompetitor={(competitorId) => {
            setSelectedCompetitorId(competitorId)
            navigate(`/dashboard/${projectId}`)
          }}
          onAddCompetitor={() => navigate(`/dashboard/${projectId}`)}
          isAddCompetitorOpen={false}
          onAvatarsChanged={setProjects}
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-4 py-6 sm:px-8">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-accent-primary">
                Agents
              </p>
              <h2 className="text-2xl font-semibold text-ink">{project.name}</h2>
              <p className="mt-1 text-sm text-ink-muted">
                Ask for strategies and content ideas from your competitor research.
              </p>
            </div>
            <Link
              to={`/dashboard/${projectId}`}
              className="rounded-xl border border-border-hairline px-3 py-2 text-sm text-ink hover:bg-accent-primary-soft"
            >
              Research progress
            </Link>
          </div>

          {!researchReady ? (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Research is still in progress. Competitor-grounded answers work best after scraping
              finishes.{' '}
              <Link className="font-medium underline" to={`/dashboard/${projectId}`}>
                View progress
              </Link>
            </div>
          ) : null}

          <div className="mb-4 flex flex-wrap gap-2">
            {AGENT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={streaming}
                onClick={() => setAgentType(option.value)}
                className={`rounded-full px-3 py-1.5 text-sm transition ${
                  agentType === option.value
                    ? 'bg-accent-primary text-white'
                    : 'border border-border-hairline bg-canvas-raised text-ink-muted hover:bg-accent-primary-soft'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <section className="flex min-h-0 flex-1 flex-col rounded-[2rem] border border-border-hairline bg-canvas-raised">
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
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

            <form
              className="border-t border-border-hairline p-4"
              onSubmit={(event) => void handleSend(event)}
            >
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

              <div className="relative flex gap-2">
                {mentionOpen && mentionCandidates.length > 0 ? (
                  <div className="absolute bottom-full left-0 z-10 mb-2 max-h-48 w-64 overflow-y-auto rounded-xl border border-border-hairline bg-canvas-raised shadow-lg">
                    {mentionCandidates.map((avatar) => (
                      <button
                        key={avatar.id}
                        type="button"
                        onClick={() => selectMention(avatar)}
                        className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-accent-primary-soft"
                      >
                        <span className="font-medium">@{avatar.name}</span>
                        <span className="mt-0.5 block text-xs text-ink-muted capitalize">
                          {avatar.type === 'business' ? 'Business' : 'Personal Brand'}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(event) => handleInputChange(event.target.value)}
                  disabled={streaming}
                  placeholder="Ask for strategies… Type @ to tag avatars"
                  className="min-w-0 flex-1 rounded-xl border border-border-hairline bg-canvas px-4 py-3 text-sm text-ink outline-none focus:border-accent-primary"
                />
                <button
                  type="submit"
                  disabled={streaming || !input.trim()}
                  className="rounded-xl bg-accent-primary px-4 py-3 text-sm font-medium text-white transition hover:bg-accent-primary-deep disabled:opacity-60"
                >
                  {streaming ? 'Sending…' : 'Send'}
                </button>
              </div>
            </form>
          </section>
        </main>
      </div>
    </div>
  )
}
