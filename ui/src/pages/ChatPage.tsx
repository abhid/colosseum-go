import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { Card, LoadingState, QueryErrorState, SectionTitle } from '../components/Common'
import { queryKeys } from '../lib/queryKeys'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system' | 'thinking'
  text: string
  createdAt: string
  agentName?: string
}

export function ChatPage() {
  const qc = useQueryClient()
  const agentsQ = useQuery({ queryKey: queryKeys.agents, queryFn: api.listAgents })
  const runsQ = useQuery({ queryKey: queryKeys.runs, queryFn: api.listRuns, refetchInterval: 2500 })

  const [selectedRunID, setSelectedRunID] = useState('')
  const [newRunAgentID, setNewRunAgentID] = useState('')
  const [newRunMessage, setNewRunMessage] = useState('')
  const [messageInput, setMessageInput] = useState('')
  const [chatError, setChatError] = useState('')
  const [expandedThinkingByID, setExpandedThinkingByID] = useState<Record<string, boolean>>({})
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const shouldAutoScrollRef = useRef(true)
  const hasActiveRun = Boolean(selectedRunID)

  useEffect(() => {
    if (!newRunAgentID && (agentsQ.data ?? []).length > 0) {
      setNewRunAgentID((agentsQ.data ?? [])[0].id)
    }
  }, [agentsQ.data, newRunAgentID])

  useEffect(() => {
    if (!hasActiveRun) composerRef.current?.focus()
  }, [hasActiveRun])

  useEffect(() => {
    if (!hasActiveRun) return
    composerRef.current?.focus()
  }, [selectedRunID, hasActiveRun])

  useEffect(() => {
    if (!hasActiveRun) {
      shouldAutoScrollRef.current = true
      return
    }
    const el = transcriptRef.current
    if (!el) return
    shouldAutoScrollRef.current = true
    el.scrollTop = el.scrollHeight
  }, [selectedRunID, hasActiveRun])

  useEffect(() => {
    if (!hasActiveRun) return
    if (!shouldAutoScrollRef.current) return
    const el = transcriptRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [hasActiveRun])

  const runQ = useQuery({
    queryKey: queryKeys.run(selectedRunID),
    queryFn: () => api.getRun(selectedRunID),
    enabled: Boolean(selectedRunID),
    refetchInterval: 1800,
  })
  const runChain = useMemo(() => {
    if (!selectedRunID) return []
    const byID = new Map((runsQ.data ?? []).map((run) => [run.id, run]))
    const chain = []
    const seen = new Set<string>()
    let currentID: string | undefined = selectedRunID
    while (currentID && !seen.has(currentID)) {
      seen.add(currentID)
      const run = byID.get(currentID)
      if (!run) break
      chain.push(run)
      currentID = run.replay_source_run_id
    }
    return chain.reverse()
  }, [runsQ.data, selectedRunID])
  const rootRunID = runChain[0]?.id ?? ''
  const chatSessionTitle = useMemo(() => {
    if (!hasActiveRun) return 'New Chat Session'
    const title = runChain[0]?.task?.trim()
    if (title) return title
    return `Chat Session ${rootRunID || selectedRunID}`
  }, [hasActiveRun, runChain, rootRunID, selectedRunID])
  const latestRunID = runChain[runChain.length - 1]?.id ?? ''
  const isViewingLatestRun = !hasActiveRun || selectedRunID === latestRunID
  const agentNameByID = useMemo(
    () => new Map((agentsQ.data ?? []).map((agent) => [agent.id, agent.name])),
    [agentsQ.data],
  )
  const latestRun = useMemo(
    () => (runsQ.data ?? []).find((run) => run.id === latestRunID) ?? null,
    [runsQ.data, latestRunID],
  )
  const latestAgentName = latestRun?.agent_id ? agentNameByID.get(latestRun.agent_id) || 'Agent' : 'Agent'
  const runTelemetryQueries = useQueries({
    queries: runChain.map((run) => ({
      queryKey: queryKeys.telemetry(run.id),
      queryFn: () => api.getRunTelemetry(run.id),
      refetchInterval: run.id === selectedRunID ? 1400 : 2200,
    })),
  })
  const isLoadingHistory = hasActiveRun && runTelemetryQueries.some((query) => query.isLoading)
  const hasHistoryError = runTelemetryQueries.some((query) => query.isError)

  useEffect(() => {
    if (runChain.length === 0) return
    const streams = runChain.map((run) => {
      const es = new EventSource(`/api/stream/runs/${run.id}`)
      es.addEventListener('run_event', () => {
        qc.invalidateQueries({ queryKey: queryKeys.runs })
        qc.invalidateQueries({ queryKey: queryKeys.telemetry(run.id) })
        qc.invalidateQueries({ queryKey: queryKeys.run(run.id) })
      })
      return es
    })
    return () => {
      for (const es of streams) es.close()
    }
  }, [runChain, qc])

  const createRun = useMutation({
    mutationFn: async () => {
      const agentID = newRunAgentID.trim()
      const firstMessage = newRunMessage.trim()
      if (!agentID) throw new Error('Select an agent')
      if (!firstMessage) throw new Error('Enter a first message')
      return api.createRun({ agent_id: agentID, task: firstMessage })
    },
    onSuccess: async (res) => {
      setChatError('')
      setSelectedRunID(res.id)
      setMessageInput('')
      setNewRunMessage('')
      await qc.invalidateQueries({ queryKey: queryKeys.run(res.id) })
      await qc.invalidateQueries({ queryKey: queryKeys.telemetry(res.id) })
    },
  })

  const sendMessage = useMutation({
    mutationFn: async (payload: { message: string; currentRunID: string }) => {
      const currentRun = runQ.data
      if (!currentRun) throw new Error('Current run not loaded yet')
      return api.createRun({
        agent_id: currentRun.agent_id,
        task: payload.message,
        source_workspace_path: currentRun.workspace_path,
        replay_source_run_id: payload.currentRunID,
        replay_from_step: 1,
        provider: currentRun.provider,
        model: currentRun.model,
        max_steps: currentRun.max_steps,
        environment_id: currentRun.environment_id,
        credential_vault_id: currentRun.credential_vault_id,
      })
    },
    onSuccess: async (res) => {
      setMessageInput('')
      setChatError('')
      setSelectedRunID(res.id)
      await qc.invalidateQueries({ queryKey: queryKeys.runs })
      await qc.invalidateQueries({ queryKey: queryKeys.telemetry(res.id) })
      await qc.invalidateQueries({ queryKey: queryKeys.run(res.id) })
    },
  })

  const messages = useMemo<ChatMessage[]>(() => {
    const out: ChatMessage[] = []
    runChain.forEach((run, idx) => {
      const runAgentName = agentNameByID.get(run.agent_id) || 'Agent'
      const task = typeof run.task === 'string' ? run.task.trim() : ''
      if (task) {
        out.push({
          id: `${run.id}:task`,
          role: 'user',
          text: task,
          createdAt: run.created_at,
        })
      }
      const events = runTelemetryQueries[idx]?.data?.events ?? []
      for (const ev of events) {
        const payload = parsePayload(ev.payload_json)
        if (ev.event_type === 'user.event') {
          const text = extractMessageText(payload)
          if (!text) continue
          if (task && text === task) continue
          out.push({ id: `${run.id}:${ev.id}`, role: 'user', text, createdAt: ev.created_at })
          continue
        }
        if (ev.event_type === 'model.response') {
          const text = typeof payload.text === 'string' ? payload.text.trim() : ''
          if (!text) continue
          out.push({ id: `${run.id}:${ev.id}`, role: 'assistant', text, createdAt: ev.created_at, agentName: runAgentName })
          continue
        }
        if (ev.event_type === 'run.failed') {
          const text = typeof payload.error === 'string' ? payload.error : 'Run failed'
          out.push({ id: `${run.id}:${ev.id}`, role: 'system', text: `Error: ${text}`, createdAt: ev.created_at })
          continue
        }
        if (ev.event_type === 'run.completed') {
          const text = typeof payload.result === 'string' ? payload.result.trim() : ''
          if (!text) continue
          out.push({ id: `${run.id}:${ev.id}`, role: 'assistant', text, createdAt: ev.created_at, agentName: runAgentName })
        }
      }
    })
    const ordered = out.sort((a, b) => {
      const aTs = Date.parse(a.createdAt)
      const bTs = Date.parse(b.createdAt)
      if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) return aTs - bTs
      return a.id.localeCompare(b.id)
    })
    return collapseAssistantThinking(ordered)
  }, [runChain, runTelemetryQueries, agentNameByID])
  const showThinkingIndicator =
    hasActiveRun &&
    isViewingLatestRun &&
    (sendMessage.isPending || isThinkingStatus(latestRun?.status || runQ.data?.status || ''))

  useEffect(() => {
    if (!hasActiveRun) return
    if (!shouldAutoScrollRef.current) return
    const el = transcriptRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, hasActiveRun, showThinkingIndicator])

  const handleSend = async () => {
    const msg = messageInput.trim()
    if (!msg) return
    if (!selectedRunID) {
      setChatError('Start a run first')
      return
    }
    setChatError('')
    try {
      await sendMessage.mutateAsync({ message: msg, currentRunID: selectedRunID })
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed to send message')
    }
  }

  const handleStartRun = async () => {
    setChatError('')
    try {
      await createRun.mutateAsync()
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed to create run')
    }
  }

  return (
    <div className="space-y-4">
      <SectionTitle title="Chat" subtitle="Each chat session contains multiple runs. Each interaction creates a new run for traceability." />
      <Card>
        <div className="flex h-[74vh] flex-col">
          <div className="mb-3 border-b border-gray-200 pb-3">
            <p className="text-sm font-semibold text-gray-900">{chatSessionTitle}</p>
            {hasActiveRun ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-gray-500">
                  Chat Session {rootRunID || selectedRunID}{' '}
                  <Link className="underline underline-offset-2 hover:text-gray-700" to={`/runs/${selectedRunID}`}>
                    Open detail
                  </Link>
                </p>
                {!isViewingLatestRun ? (
                  <button
                    type="button"
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                    onClick={() => setSelectedRunID(latestRunID)}
                  >
                    Jump to latest run
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-gray-500">Pick an agent and send your first message to start.</p>
            )}
          </div>

          {isLoadingHistory ? <LoadingState label="Loading chat history..." /> : null}
          {hasHistoryError ? (
            <p className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">Failed to load some run history. You can still chat from the selected run.</p>
          ) : null}

          <div
            ref={transcriptRef}
            className="min-h-0 flex-1 space-y-3 overflow-auto pr-1"
            onScroll={() => {
              const el = transcriptRef.current
              if (!el) return
              const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
              shouldAutoScrollRef.current = distanceFromBottom < 80
            }}
          >
            {!hasActiveRun ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-6">
                <div className="max-w-lg text-center">
                  <p className="text-sm font-medium text-gray-700">No messages yet</p>
                  <p className="mt-1 text-xs text-gray-500">This is a fresh chat session. Your first message will create run 1.</p>
                </div>
              </div>
            ) : null}
            {hasActiveRun &&
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'thinking' ? (
                    <div className="max-w-[82%] rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{`${msg.agentName || 'Agent'} thinking`}</p>
                        <button
                          type="button"
                          className="rounded border border-violet-200 bg-white px-2 py-0.5 text-[11px] font-medium text-violet-800 hover:bg-violet-100"
                          onClick={() =>
                            setExpandedThinkingByID((prev) => ({
                              ...prev,
                              [msg.id]: !prev[msg.id],
                            }))
                          }
                        >
                          {expandedThinkingByID[msg.id] ? 'Hide details' : 'Show details'}
                        </button>
                      </div>
                      {expandedThinkingByID[msg.id] ? (
                        <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                      ) : (
                        <p className="text-violet-800">Thinking summary available.</p>
                      )}
                      <p className="mt-1 text-[11px] text-gray-500">{new Date(msg.createdAt).toLocaleString()}</p>
                    </div>
                  ) : (
                    <div
                      className={`max-w-[82%] rounded-lg border px-3 py-2 text-sm ${
                        msg.role === 'user'
                          ? 'border-blue-200 bg-blue-50 text-blue-900'
                          : msg.role === 'assistant'
                            ? 'border-gray-200 bg-white text-gray-800'
                            : 'border-amber-200 bg-amber-50 text-amber-900'
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                          {msg.role === 'user' ? 'You' : msg.role === 'assistant' ? msg.agentName || 'Agent' : 'System'}
                        </p>
                      </div>
                      <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                      <p className="mt-1 text-[11px] text-gray-500">{new Date(msg.createdAt).toLocaleString()}</p>
                    </div>
                  )}
                </div>
              ))}
            {showThinkingIndicator ? (
              <div className="flex w-full justify-start">
                <div className="max-w-[82%] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">{latestAgentName}</p>
                  <div className="flex items-center gap-2">
                    <span>Thinking</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400 [animation-delay:-0.2s]" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400 [animation-delay:-0.1s]" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400" />
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-3 border-t border-gray-200 pt-3">
            {agentsQ.isLoading ? <LoadingState label="Loading agents..." /> : null}
            <QueryErrorState title="Failed to load agents" query={agentsQ} />
            <div className="flex items-end gap-2">
              {!hasActiveRun ? (
                <select
                  className="h-9 w-72 max-w-[35%] shrink-0 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                  value={newRunAgentID}
                  onChange={(e) => setNewRunAgentID(e.target.value)}
                  disabled={agentsQ.isLoading || createRun.isPending}
                >
                  <option value="">Select agent</option>
                  {(agentsQ.data ?? []).map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.provider}/{agent.model})
                    </option>
                  ))}
                </select>
              ) : null}
              <textarea
                ref={composerRef}
                className="min-h-[72px] flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                placeholder={hasActiveRun ? 'Message the agent...' : 'Start this chat session'}
                value={hasActiveRun ? messageInput : newRunMessage}
                onChange={(e) => (hasActiveRun ? setMessageInput(e.target.value) : setNewRunMessage(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (hasActiveRun) {
                      void handleSend()
                    } else {
                      void handleStartRun()
                    }
                  }
                }}
              />
              <button
                type="button"
                className="h-9 rounded-md bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
                disabled={hasActiveRun ? sendMessage.isPending || !messageInput.trim() : createRun.isPending || !newRunMessage.trim()}
                onClick={() => (hasActiveRun ? void handleSend() : void handleStartRun())}
              >
                {hasActiveRun ? (sendMessage.isPending ? 'Creating run...' : 'Send') : createRun.isPending ? 'Starting...' : 'Start Chat Session'}
              </button>
            </div>
            {!hasActiveRun ? (
              <p className="mt-2 text-xs text-gray-500">Tip: press Enter to start, Shift+Enter for newline.</p>
            ) : (
              <p className="mt-2 text-xs text-gray-500">Tip: press Enter to send, Shift+Enter for newline.</p>
            )}
            {chatError ? <p className="mt-2 text-xs text-red-600">{chatError}</p> : null}
          </div>
        </div>
      </Card>
    </div>
  )
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

function extractMessageText(payload: Record<string, unknown>) {
  for (const key of ['message', 'text', 'content', 'instruction']) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function collapseAssistantThinking(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  let i = 0
  while (i < messages.length) {
    const current = messages[i]
    if (current.role !== 'assistant') {
      out.push(current)
      i += 1
      continue
    }
    const block: ChatMessage[] = []
    let j = i
    while (j < messages.length && messages[j].role === 'assistant') {
      block.push(messages[j])
      j += 1
    }
    if (block.length === 1) {
      out.push(block[0])
      i = j
      continue
    }
    const finalMessage = block[block.length - 1]
    const prior = block
      .slice(0, -1)
      .map((msg) => msg.text.trim())
      .filter(Boolean)
      .filter((text, idx, arr) => arr.indexOf(text) === idx && text !== finalMessage.text.trim())
    if (prior.length > 0) {
      out.push({
        id: `${finalMessage.id}:thinking-summary`,
        role: 'thinking',
        text: summarizeThinkingSteps(prior),
        createdAt: finalMessage.createdAt,
        agentName: finalMessage.agentName,
      })
    }
    out.push(finalMessage)
    i = j
  }
  return out
}

function summarizeThinkingSteps(steps: string[]): string {
  const compact = steps
    .map((step) => step.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((step) => `- ${truncate(step, 120)}`)
  if (compact.length === 0) return 'Reviewed prior context before producing the final answer.'
  return ['Thinking summary:', ...compact].join('\n')
}

function truncate(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value
  return `${value.slice(0, maxLen - 1)}...`
}

function isThinkingStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase()
  return normalized === 'queued' || normalized === 'running'
}
