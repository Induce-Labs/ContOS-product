/**
 * Module-level agent SSE runtime with durable catch-up.
 *
 * Browser tab freeze/discard drops the live fetch and wipes in-memory state.
 * We persist {runId, assistantId, projectId, agentType} to sessionStorage as
 * soon as the server assigns a run_id, then poll GET /api/agents/runs/{id}
 * on visibility, focus, mount, and a short interval until the result lands.
 */

import {
  AgentsApiError,
  fetchAgentRun,
  invokeAgentStream,
  isConcurrentLimitError,
  type AgentsInvokeRequest,
  type AgentsSseHandlers,
} from './agentsApi'
import { logDevError, userFacingMessage } from './devLog'
import {
  formatStructuredAgentOutput,
  isStructuredAgentOutput,
} from './agentOutputDisplay'

export type ActiveAgentStreamSnapshot = {
  projectId: string
  assistantId: string
  agentType: string
  content: string
  streaming: boolean
  error: string | null
  runId: string | null
  output: unknown | null
}

type Listener = (snapshot: ActiveAgentStreamSnapshot | null) => void

type InternalStream = ActiveAgentStreamSnapshot & {
  controller: AbortController
}

type PendingCatchUp = {
  projectId: string
  assistantId: string
  agentType: string
  runId: string
}

const PENDING_STORAGE_KEY = 'contos_agent_run_pending'

let active: InternalStream | null = null
let pendingCatchUp: PendingCatchUp | null = null
const listeners = new Set<Listener>()
let pollTimer: ReturnType<typeof setInterval> | null = null
let catchUpInFlight = false

function snapshotOf(stream: InternalStream | null): ActiveAgentStreamSnapshot | null {
  if (!stream) return null
  return {
    projectId: stream.projectId,
    assistantId: stream.assistantId,
    agentType: stream.agentType,
    content: stream.content,
    streaming: stream.streaming,
    error: stream.error,
    runId: stream.runId,
    output: stream.output,
  }
}

function emit() {
  const snap = snapshotOf(active)
  for (const listener of listeners) {
    listener(snap)
  }
}

function emitFinal(snapshot: ActiveAgentStreamSnapshot) {
  for (const listener of listeners) {
    listener(snapshot)
  }
}

function readStoredPending(): PendingCatchUp | null {
  try {
    const raw = sessionStorage.getItem(PENDING_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingCatchUp
    if (
      typeof parsed?.runId === 'string' &&
      typeof parsed?.assistantId === 'string' &&
      typeof parsed?.projectId === 'string' &&
      typeof parsed?.agentType === 'string'
    ) {
      return parsed
    }
  } catch {
    // ignore corrupt storage
  }
  return null
}

function writeStoredPending(pending: PendingCatchUp | null) {
  try {
    if (!pending) {
      sessionStorage.removeItem(PENDING_STORAGE_KEY)
      return
    }
    sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending))
  } catch {
    // private mode / quota — in-memory pending still works for same session
  }
}

function setPending(pending: PendingCatchUp | null) {
  pendingCatchUp = pending
  writeStoredPending(pending)
  ensurePollTimer()
}

function safeAgentStreamError(message: string): string {
  logDevError('agents stream', { error: message, status: 500 })
  return userFacingMessage(
    new AgentsApiError(message, 500),
    'Agent stream failed unexpectedly.',
  )
}

function displayContentForOutput(output: unknown): string {
  if (typeof output === 'string') return output
  if (isStructuredAgentOutput(output)) {
    return formatStructuredAgentOutput(output)
  }
  return ''
}

export function getActiveAgentStream(): ActiveAgentStreamSnapshot | null {
  return snapshotOf(active)
}

export function getPendingAgentCatchUp(): PendingCatchUp | null {
  return pendingCatchUp ?? readStoredPending()
}

export function subscribeActiveAgentStream(listener: Listener): () => void {
  listeners.add(listener)
  listener(getActiveAgentStream())
  // Recover durable pending from a prior tab discard / reload.
  const stored = readStoredPending()
  if (stored && !pendingCatchUp) {
    pendingCatchUp = stored
  }
  ensurePollTimer()
  void resumeActiveAgentStreamIfNeeded()
  return () => {
    listeners.delete(listener)
  }
}

/** Abort only for intentional user actions (new chat / session switch). */
export function abortActiveAgentStream(): void {
  if (active) {
    active.controller.abort()
    active.streaming = false
    active = null
  }
  setPending(null)
  emit()
}

function applyOutputToActive(assistantId: string, output: unknown): void {
  if (!active || active.assistantId !== assistantId) return
  active.output = output
  const text = displayContentForOutput(output)
  if (text.trim()) {
    active.content = text
  }
}

function ensurePollTimer() {
  const hasWork = Boolean(active?.runId) || Boolean(pendingCatchUp ?? readStoredPending())
  if (!hasWork) {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    return
  }
  if (pollTimer) return
  pollTimer = setInterval(() => {
    void resumeActiveAgentStreamIfNeeded()
  }, 2000)
}

async function fetchAndApplyRun(target: PendingCatchUp): Promise<boolean> {
  const result = await fetchAgentRun(target.runId)
  if (result.status === 'running') {
    return false
  }

  if (result.error && (result.status === 'error' || result.status === 'preempted')) {
    emitFinal({
      projectId: target.projectId,
      assistantId: target.assistantId,
      agentType: target.agentType,
      content: '',
      streaming: false,
      error: safeAgentStreamError(result.error),
      runId: target.runId,
      output: result.output ?? null,
    })
    return true
  }

  if (result.output != null) {
    emitFinal({
      projectId: target.projectId,
      assistantId: target.assistantId,
      agentType: target.agentType,
      content: displayContentForOutput(result.output),
      streaming: false,
      error: null,
      runId: target.runId,
      output: result.output,
    })
    return true
  }
  return false
}

/**
 * Pull a finished run from Redis when the live SSE stalled or the page reloaded.
 */
export async function resumeActiveAgentStreamIfNeeded(): Promise<void> {
  if (catchUpInFlight) return
  catchUpInFlight = true
  try {
    const live = active
    if (live?.runId) {
      try {
        const done = await fetchAndApplyRun({
          projectId: live.projectId,
          assistantId: live.assistantId,
          agentType: live.agentType,
          runId: live.runId,
        })
        if (done) {
          if (active?.assistantId === live.assistantId) {
            active.streaming = false
            active = null
          }
          setPending(null)
          emit()
        }
      } catch (error) {
        if (!(error instanceof AgentsApiError && error.statusCode === 404)) {
          // Keep polling — run may not be stored yet.
        }
      }
      return
    }

    const pending = pendingCatchUp ?? readStoredPending()
    if (!pending) {
      ensurePollTimer()
      return
    }
    pendingCatchUp = pending
    try {
      const done = await fetchAndApplyRun(pending)
      if (done) {
        setPending(null)
        emit()
      }
    } catch (error) {
      if (error instanceof AgentsApiError && error.statusCode === 404) {
        // Still generating — keep pending + poll.
        return
      }
    }
  } finally {
    catchUpInFlight = false
    ensurePollTimer()
  }
}

export async function runAgentStream(params: {
  projectId: string
  assistantId: string
  agentType: string
  body: AgentsInvokeRequest
  handlers?: Pick<AgentsSseHandlers, 'onComplete' | 'onError' | 'onStatus'>
}): Promise<void> {
  const { projectId, assistantId, agentType, body, handlers } = params

  if (active) {
    active.controller.abort()
    active = null
  }
  setPending(null)

  const controller = new AbortController()
  active = {
    projectId,
    assistantId,
    agentType,
    content: '',
    streaming: true,
    error: null,
    runId: null,
    output: null,
    controller,
  }
  emit()

  const sseHandlers: AgentsSseHandlers = {
    onStatus: (data) => {
      const runId = typeof data.run_id === 'string' ? data.run_id : null
      if (runId && active?.assistantId === assistantId) {
        active.runId = runId
        // Durable immediately — survives tab discard / full reload.
        setPending({
          projectId,
          assistantId,
          agentType,
          runId,
        })
        emit()
      }
      handlers?.onStatus?.(data)
    },
    onToken: (token) => {
      if (!active || active.assistantId !== assistantId) return
      if (agentType !== 'chatbot') return
      active.content = `${active.content}${token}`
      emit()
    },
    onComplete: (data) => {
      if (active?.assistantId === assistantId) {
        applyOutputToActive(assistantId, data.output)
        setPending(null)
        emit()
      }
      handlers?.onComplete?.(data)
    },
    onError: (message) => {
      const safe = safeAgentStreamError(message)
      if (active && active.assistantId === assistantId) {
        active.error = safe
        emit()
      }
      handlers?.onError?.(safe)
    },
  }

  try {
    const maxAttempts = 4
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await invokeAgentStream(body, sseHandlers, controller.signal)
        break
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          throw error
        }
        if (isConcurrentLimitError(error) && attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
          if (controller.signal.aborted) throw error
          continue
        }
        throw error
      }
    }

    if (active?.assistantId === assistantId && active.runId && active.output == null) {
      setPending({
        projectId,
        assistantId,
        agentType,
        runId: active.runId,
      })
      await resumeActiveAgentStreamIfNeeded()
    }
  } finally {
    if (active?.assistantId === assistantId) {
      if (active.runId && active.output == null) {
        setPending({
          projectId,
          assistantId,
          agentType,
          runId: active.runId,
        })
      }
      active.streaming = false
      emit()
      active = null
      emit()
    }
    ensurePollTimer()
  }
}

/** Wire once from the app shell — focus + visibility catch-up. */
export function startAgentStreamCatchUpListeners(): () => void {
  const stored = readStoredPending()
  if (stored) {
    pendingCatchUp = stored
  }
  ensurePollTimer()

  function onVisible() {
    if (document.visibilityState === 'visible') {
      void resumeActiveAgentStreamIfNeeded()
    }
  }
  function onFocus() {
    void resumeActiveAgentStreamIfNeeded()
  }

  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onFocus)
  void resumeActiveAgentStreamIfNeeded()

  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onFocus)
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
}
