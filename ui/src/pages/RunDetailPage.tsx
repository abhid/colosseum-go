import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import React from 'react'
import { useParams } from 'react-router-dom'
import {
  IconChevronDown,
  IconGitBranch,
  IconCloud,
  IconFile,
  IconLock,
  IconClock,
  IconPlayerPlay,
  IconDatabase,
  IconSearch,
  IconCopy,
  IconX,
  IconArrowUpRight,
  IconArrowDownLeft,
} from '@tabler/icons-react'
import { api } from '../lib/api'
import type { Artifact, TraceSpan } from '../lib/types'
import { queryKeys } from '../lib/queryKeys'

import { formatDistanceToNow } from 'date-fns'

type TabId = 'transcript' | 'debug' | 'events' | 'artifacts'

type EventRow = {
  id: string
  seq: number
  event_type: string
  step_id: string
  created_at: string
  parsed: Record<string, unknown> | string
  actor: ActorLaneId
  duration_ms?: number
  usage?: { inTokens: number; outTokens: number } | null
}

type DisplayArtifact = Artifact & {
  _inline_log?: string
  _order?: number
}

type ActorLaneId = 'orchestrator' | 'tools' | 'system' | 'user'
const activeActors: ActorLaneId[] = ['orchestrator', 'tools', 'system', 'user']

const roleColors: Record<string, string> = {
  Running: 'bg-[#e5e7eb] text-gray-700',
  User: 'bg-[#9333ea] text-white',
  Agent: 'bg-[#3b82f6] text-white',
  Bash: 'bg-[#db2777] text-white',
  Write: 'bg-[#e11d48] text-white',
  System: 'bg-gray-200 text-gray-700',
}

function getRoleColor(role: string) {
  if (roleColors[role]) return roleColors[role]
  // Provide consistent colors for other generic tools based on their name length
  const hash = role.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const colors = [
    'bg-[#14b8a6] text-white', // teal
    'bg-[#8b5cf6] text-white', // violet
    'bg-[#f59e0b] text-white', // amber
    'bg-[#06b6d4] text-white', // cyan
    'bg-[#ef4444] text-white', // red
    'bg-[#10b981] text-white', // emerald
  ]
  return colors[hash % colors.length]
}

export function RunDetailPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabId>('transcript')
  const [filterText] = useState('')
  const [steerText, setSteerText] = useState('')
  const [steerError, setSteerError] = useState('')
  const [expandedRowID, setExpandedRowID] = useState('')
  const [expandedEventRowID, setExpandedEventRowID] = useState('')
  const [isArtifactsModalOpen, setIsArtifactsModalOpen] = useState(false)
  const [hoveredTimelineSpanID, setHoveredTimelineSpanID] = useState('')

  const steer = useMutation({
    mutationFn: (message: string) => api.steerRun(id, { message }),
    onSuccess: () => {
      setSteerText('')
      setSteerError('')
      qc.invalidateQueries({ queryKey: queryKeys.run(id) })
      qc.invalidateQueries({ queryKey: queryKeys.telemetry(id) })
    },
  })

  const sendSteeringMessage = async () => {
    const message = steerText.trim()
    if (!message) return
    setSteerError('')
    try {
      await steer.mutateAsync(message)
    } catch (err) {
      setSteerError(err instanceof Error ? err.message : 'Failed to send message')
    }
  }

  const runQ = useQuery({ queryKey: queryKeys.run(id), queryFn: () => api.getRun(id), enabled: Boolean(id), refetchInterval: 1800 })
  const agentQ = useQuery({ queryKey: queryKeys.agent(runQ.data?.agent_id || ''), queryFn: () => api.listAgents().then(agents => agents.find(a => a.id === runQ.data?.agent_id)), enabled: Boolean(runQ.data?.agent_id) })
  const environmentsQ = useQuery({ queryKey: queryKeys.environments, queryFn: api.listEnvironments })
  const vaultsQ = useQuery({ queryKey: queryKeys.credentialVaults, queryFn: api.listCredentialVaults })
  const telemetryQ = useQuery({ queryKey: queryKeys.telemetry(id), queryFn: () => api.getRunTelemetry(id), enabled: Boolean(id), refetchInterval: 1800 })
  const artifactsQ = useQuery({ queryKey: queryKeys.artifacts(id), queryFn: () => api.getRunArtifacts(id), enabled: Boolean(id), refetchInterval: 2500 })

  useEffect(() => {
    if (!id) return
    const es = new EventSource(`/api/stream/runs/${id}`)
    es.addEventListener('run_event', () => {
      qc.invalidateQueries({ queryKey: queryKeys.telemetry(id) })
      qc.invalidateQueries({ queryKey: queryKeys.run(id) })
      qc.invalidateQueries({ queryKey: queryKeys.artifacts(id) })
    })
    return () => es.close()
  }, [id, qc])

  const telemetry = telemetryQ.data

  const stepDurationByID = useMemo(() => {
    const out: Record<string, number> = {}
    for (const step of telemetry?.steps ?? []) {
      const s = parseTimeMs(step.started_at || step.created_at)
      const e = parseTimeMs(step.ended_at)
      if (Number.isFinite(s) && Number.isFinite(e) && e >= s) {
        out[step.id] = e - s
      }
    }
    return out
  }, [telemetry?.steps])

  const toolDurationByStepID = useMemo(() => {
    const out: Record<string, number> = {}
    for (const call of telemetry?.tool_calls ?? []) {
      const s = parseTimeMs(call.started_at)
      const e = parseTimeMs(call.ended_at)
      if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) continue
      const prev = out[call.step_id] ?? 0
      out[call.step_id] = Math.max(prev, e - s)
    }
    return out
  }, [telemetry?.tool_calls])

  const eventRows = useMemo<EventRow[]>(() => {
    return (telemetry?.events ?? []).map((ev) => ({
      id: ev.id,
      seq: Number(ev.seq),
      event_type: String(ev.event_type),
      step_id: String(ev.step_id || ''),
      created_at: String(ev.created_at),
      parsed: tryParseJSON(String(ev.payload_json || '')),
      actor: actorFromEventType(String(ev.event_type)),
      duration_ms: stepDurationByID[String(ev.step_id || '')] || toolDurationByStepID[String(ev.step_id || '')],
      usage: usageLabelFromPayload(tryParseJSON(String(ev.payload_json || ''))),
    }))
  }, [telemetry, stepDurationByID, toolDurationByStepID])

  const filteredEvents = useMemo(() => {
    const out = eventRows.filter((ev) => activeActors.includes(ev.actor))
    if (!filterText.trim()) return out
    const q = filterText.toLowerCase()
    return out.filter((ev) => `${ev.event_type} ${JSON.stringify(ev.parsed)}`.toLowerCase().includes(q))
  }, [eventRows, filterText])

  const displayArtifacts = useMemo<DisplayArtifact[]>(() => {
    const persisted = artifactsQ.data ?? []
    if (persisted.length > 0) return persisted

    // Backfill artifact-like entries from tool.result logs for older runs.
    const synthetic = eventRows
      .filter((ev) => ev.event_type === 'tool.result' && typeof ev.parsed === 'object' && ev.parsed !== null)
      .map((ev, idx) => {
        const payload = ev.parsed as Record<string, unknown>
        const log = typeof payload.log === 'string' ? payload.log : ''
        const tool = typeof payload.tool === 'string' ? payload.tool : 'tool'
        if (!log.trim()) return null
        return {
          id: `synthetic-${ev.id}`,
          step_id: ev.step_id,
          kind: `${tool}_log`,
          path: `inline://event/${ev.id}`,
          mime_type: 'text/plain',
          size_bytes: log.length,
          created_at: ev.created_at,
          _inline_log: log,
          _order: idx,
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || a._order - b._order)

    return synthetic
  }, [artifactsQ.data, eventRows])

  const stepArtifactsByStepID = useMemo(() => {
    const out: Record<string, DisplayArtifact[]> = {}
    for (const artifact of displayArtifacts) {
      const stepID = String(artifact.step_id || '')
      if (!stepID) continue
      if (!out[stepID]) out[stepID] = []
      out[stepID].push(artifact)
    }
    return out
  }, [displayArtifacts])

  const spans = useMemo(() => {
    return (telemetry?.spans ?? [])
      .map((s) => ({ ...s, __start: parseTimeMs(s.started_at), __end: parseTimeMs(s.ended_at), __actor: actorFromSpan(s) }))
      .filter((s) => Number.isFinite(s.__start))
      .filter((s) => activeActors.includes(s.__actor))
  }, [telemetry])

  const timeline = useMemo(() => {
    if (spans.length === 0) return null
    const min = Math.min(...spans.map((s) => s.__start))
    const max = Math.max(...spans.map((s) => s.__end || s.__start))
    const total = Math.max(1, max - min)

    return { min, max, total, spans }
  }, [spans])
  const timelineMeta = useMemo(() => {
    if (!timeline) return null
    let orchestrator = 0
    let tools = 0
    let system = 0
    let user = 0
    for (const span of timeline.spans) {
      if (span.__actor === 'orchestrator') orchestrator++
      else if (span.__actor === 'tools') tools++
      else if (span.__actor === 'system') system++
      else if (span.__actor === 'user') user++
    }
    return {
      orchestrator,
      tools,
      system,
      user,
      totalSpans: timeline.spans.length,
      windowLabel: `${formatDuration(timeline.total)} window`,
    }
  }, [timeline])
  const hoveredTimelineSpan = useMemo(() => {
    if (!timeline || !hoveredTimelineSpanID) return null
    const span = timeline.spans.find((s) => s.id === hoveredTimelineSpanID)
    if (!span) return null
    const spanMs = Math.max(0, (span.__end || span.__start) - span.__start)
    return {
      name: span.name,
      actor: span.__actor,
      durationLabel: formatDuration(spanMs),
    }
  }, [timeline, hoveredTimelineSpanID])

  const metrics = useMemo(() => {
    const run = runQ.data
    const started = parseTimeMs(run?.started_at) || parseTimeMs(run?.created_at)
    const completed = parseTimeMs(run?.completed_at)
    const latestEvent = eventRows.length > 0 ? parseTimeMs(eventRows[eventRows.length - 1].created_at) : NaN
    const terminal = run?.status === 'completed' || run?.status === 'failed' || run?.status === 'cancelled'
    const ended = Number.isFinite(completed) ? completed : (terminal ? latestEvent : Date.now())
    const elapsedMs = Number.isFinite(started) && Number.isFinite(ended) && ended >= started ? ended - started : 0

    let inTokens = 0
    let outTokens = 0
    for (const ev of eventRows) {
      if (ev.event_type !== 'model.response') continue
      if (typeof ev.parsed !== 'object' || ev.parsed === null) continue
      const usage = (ev.parsed as Record<string, unknown>).usage
      if (!usage || typeof usage !== 'object') continue
      const rec = usage as Record<string, unknown>
      inTokens += Number(rec.input_tokens || 0)
      outTokens += Number(rec.output_tokens || 0)
    }

    return {
      elapsedLabel: formatDuration(elapsedMs),
      inTokens,
      outTokens,
      stepCount: telemetry?.steps?.length ?? 0,
      toolCount: telemetry?.tool_calls?.length ?? 0,
    }
  }, [runQ.data, eventRows, telemetry?.steps?.length, telemetry?.tool_calls?.length])

  const runStartMs = useMemo(() => {
    const runStart = parseTimeMs(runQ.data?.started_at) || parseTimeMs(runQ.data?.created_at)
    if (Number.isFinite(runStart)) return runStart
    if (eventRows.length === 0) return NaN
    const first = parseTimeMs(eventRows[0].created_at)
    return Number.isFinite(first) ? first : NaN
  }, [runQ.data?.started_at, runQ.data?.created_at, eventRows])
  const environmentLabel = useMemo(() => {
    const environmentID = runQ.data?.environment_id || ''
    if (!environmentID) return 'default'
    const match = (environmentsQ.data ?? []).find((env) => String(env.id) === environmentID)
    return String(match?.name || environmentID)
  }, [runQ.data?.environment_id, environmentsQ.data])
  const vaultLabel = useMemo(() => {
    const vaultID = runQ.data?.credential_vault_id || ''
    if (!vaultID) return 'none'
    const match = (vaultsQ.data ?? []).find((vault) => String(vault.id) === vaultID)
    return String(match?.name || vaultID)
  }, [runQ.data?.credential_vault_id, vaultsQ.data])

  if (!id) return null

  const taskTitle = runQ.data?.task || 'Run Detail'
  const statusLabel = runQ.data?.status || 'Unknown'

  return (
    <div className="flex flex-col h-[100vh] bg-[#fafafa] text-sm -mt-5 -mx-6 -mb-5 rounded-tl-xl overflow-hidden shadow-sm border-l border-t border-gray-200">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2 text-sm text-gray-500">
            <span className="hover:text-gray-700 transition-colors">Runs</span>
            <span className="text-gray-300">/</span>
            <span className="truncate font-medium text-gray-600 hover:text-gray-700 transition-colors">
              {id}
            </span>
          </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="min-w-0 flex-1 text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                {taskTitle}
              </h1>
              <span className="shrink-0 rounded border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-medium capitalize text-gray-600 shadow-sm">
              {statusLabel}
              </span>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
            <input 
              type="text" 
              value={steerText}
              onChange={(e) => setSteerText(e.target.value)}
              placeholder="Message agent..." 
              className="h-9 min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 lg:w-80 lg:flex-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void sendSteeringMessage()
                }
              }}
            />
            <button
              type="button"
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
              onClick={() => void sendSteeringMessage()}
              disabled={!steerText.trim() || steer.isPending}
            >
            {steer.isPending ? 'Sending...' : 'Send'}
            <IconArrowUpRight size={14} className="text-gray-400" />
            </button>
            {steerError ? <p className="w-full text-xs text-red-600">{steerError}</p> : null}
          </div>
        </div>
      </div>

      {/* Tags row */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-gray-200 bg-[#fafafa]/50 text-xs text-gray-600">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-gray-200 bg-white shadow-sm font-medium">
          <IconGitBranch size={14} className="text-gray-400" /> {agentQ.data?.name || runQ.data?.agent_id || 'default-agent'}
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-gray-200 bg-white shadow-sm font-medium">
          <IconCloud size={14} className="text-gray-400" /> {environmentLabel}
        </div>
        <button 
          onClick={() => setIsArtifactsModalOpen(true)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-gray-200 bg-white shadow-sm font-medium hover:bg-gray-50 transition-colors"
        >
          <IconFile size={14} className="text-gray-400" /> {displayArtifacts.length} {displayArtifacts.length === 1 ? 'file' : 'files'}
        </button>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-gray-200 bg-white shadow-sm font-medium text-gray-500">
          <IconLock size={14} className="text-gray-400" /> {vaultLabel}
        </div>
        
        <div className="flex items-center gap-1.5 text-gray-500 ml-4 font-medium">
          <IconClock size={14} /> {runQ.data?.created_at ? formatDistanceToNow(new Date(runQ.data.created_at), { addSuffix: true }) : 'Just now'}
        </div>
        <div className="flex items-center gap-1.5 text-gray-500 ml-2 font-medium">
          <IconPlayerPlay size={14} /> {metrics.elapsedLabel}
        </div>
        <div className="flex items-center gap-1.5 text-gray-500 ml-2 font-medium">
          <IconDatabase size={14} /> {(metrics.inTokens / 1000).toFixed(1)}k / {(metrics.outTokens / 1000).toFixed(1)}k ({metrics.inTokens + metrics.outTokens > 0 ? Math.round((metrics.outTokens / (metrics.inTokens + metrics.outTokens)) * 100) : 0}%)
        </div>
      </div>

      {/* Main content body */}
      <div className="flex-1 overflow-auto bg-[#fafafa]">
        {/* Tabs */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 bg-[#fafafa] pt-3 sticky top-0 z-10">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setActiveTab('transcript')}
              className={`pb-2 text-sm font-medium transition-colors ${activeTab === 'transcript' ? 'text-gray-900 border-b-[3px] border-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Transcript
            </button>
            <button
              onClick={() => setActiveTab('debug')}
              className={`pb-2 text-sm font-medium transition-colors ${activeTab === 'debug' ? 'text-gray-900 border-b-[3px] border-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Debug
            </button>
            <button
              onClick={() => setActiveTab('events')}
              className={`pb-2 text-sm font-medium transition-colors flex items-center gap-1 ${activeTab === 'events' ? 'text-gray-900 border-b-[3px] border-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              All events <IconChevronDown size={14} />
            </button>
            <button
              onClick={() => setActiveTab('artifacts')}
              className={`pb-2 text-sm font-medium transition-colors flex items-center gap-1 ${activeTab === 'artifacts' ? 'text-gray-900 border-b-[3px] border-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Artifacts
            </button>
            <div className="relative pb-2 group">
               <IconSearch size={16} className="text-gray-400 group-hover:text-gray-600 transition-colors cursor-pointer" />
            </div>
          </div>
          <div className="flex items-center gap-4 pb-2">
            <button className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors">
              <IconCopy size={14} /> Copy all
            </button>
          </div>
        </div>

        <div className={`p-6 mx-auto ${activeTab === 'transcript' ? 'max-w-6xl' : activeTab === 'events' ? 'max-w-none' : 'max-w-5xl'}`}>
          {activeTab === 'transcript' ? (
            <>
              {/* Timeline Component */}
              <div className="mb-8 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                      {timelineMeta?.totalSpans ?? 0} spans
                    </span>
                    <span className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                      {timelineMeta?.windowLabel ?? '0s window'}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px]">
                      <span className="h-2 w-2 rounded bg-[#60A5FA]" />
                      Orchestrator {timelineMeta?.orchestrator ?? 0}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px]">
                      <span className="h-2 w-2 rounded bg-[#F472B6]" />
                      Tools {timelineMeta?.tools ?? 0}
                    </span>
                    {(timelineMeta?.system ?? 0) > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px]">
                        <span className="h-2 w-2 rounded bg-gray-300" />
                        System {timelineMeta?.system ?? 0}
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[11px] text-gray-400">
                    {hoveredTimelineSpan
                      ? `${hoveredTimelineSpan.name} • ${hoveredTimelineSpan.durationLabel} • ${hoveredTimelineSpan.actor}`
                      : 'hover spans for details'}
                  </span>
                </div>
                <div className="w-full h-10 rounded relative overflow-hidden flex items-center bg-white">
                  {timeline && timeline.spans.map((span) => {
                    const start = ((span.__start - timeline.min) / timeline.total) * 100
                    const spanMs = Math.max(0, (span.__end || span.__start) - span.__start)
                    const width = Math.max(0.5, (spanMs / timeline.total) * 100)
                    const bg = span.__actor === 'tools' ? 'bg-[#F472B6]' : span.__actor === 'orchestrator' ? 'bg-[#60A5FA]' : 'bg-gray-300'
                    return (
                      <div
                        key={span.id}
                        className={`absolute h-6 rounded-[3px] opacity-80 hover:opacity-100 transition-opacity cursor-pointer shadow-sm ${bg}`}
                        style={{ left: `${start}%`, width: `${width}%` }}
                        title={`${span.name} • ${formatDuration(spanMs)} • ${span.__actor}`}
                        tabIndex={0}
                        onMouseEnter={() => setHoveredTimelineSpanID(span.id)}
                        onMouseLeave={() => setHoveredTimelineSpanID((prev) => (prev === span.id ? '' : prev))}
                        onFocus={() => setHoveredTimelineSpanID(span.id)}
                        onBlur={() => setHoveredTimelineSpanID((prev) => (prev === span.id ? '' : prev))}
                      />
                    )
                  })}
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-gray-400">
                  <span>0s</span>
                  <span>{timelineMeta?.windowLabel ?? '0s window'}</span>
                </div>
              </div>

              {/* Agent Tabs */}
              <div className="flex items-center gap-6 border-b border-gray-200 mb-6 max-w-5xl mx-auto">
                <button className="text-sm font-medium text-gray-900 border-b-[3px] border-gray-900 pb-2 -mb-[1.5px]">Orchestrator</button>
              </div>

              {/* Transcript List */}
              <div className="space-y-4 max-w-5xl mx-auto">
                {filteredEvents.map((ev) => {
                  const role = mapEventToRole(ev)
                  const line = transcriptLine(ev)
                  const offset = Number.isFinite(runStartMs) ? Math.max(0, parseTimeMs(ev.created_at) - runStartMs) : 0
                  const expanded = expandedRowID === ev.id
                  const rowArtifacts = stepArtifactsByStepID[ev.step_id] ?? []
                  
                  return (
                    <div key={ev.id} className={`group border transition-colors rounded-md px-3 py-2 ${expanded ? 'bg-white border-gray-200 shadow-sm' : 'border-transparent hover:border-gray-200 hover:bg-white hover:shadow-sm'}`}>
                      <div className="flex items-start gap-3 cursor-pointer" onClick={() => setExpandedRowID(expanded ? '' : ev.id)}>
                        <div className="w-[140px] shrink-0 pt-0.5 text-right flex justify-end">
                          <span className={`inline-flex items-center justify-center px-2 py-0.5 text-[10px] uppercase tracking-wide font-bold rounded shadow-sm ${getRoleColor(role)}`}>
                            {role}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="text-sm text-gray-800 break-words font-medium leading-relaxed">
                            {line.title}
                          </div>
                          {line.subtitle && <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{line.subtitle}</div>}
                        </div>
                        <div className={`shrink-0 flex items-center gap-1.5 text-[11px] text-gray-400 font-mono pt-1 transition-opacity ${expanded ? 'opacity-100' : 'opacity-100'}`}>
                          {ev.usage ? (
                            <span className="flex items-center gap-1">
                              <span className="flex items-center"><IconArrowUpRight size={12} className="text-gray-400" />{ev.usage.inTokens}</span>
                              <span className="text-gray-300">/</span>
                              <span className="flex items-center"><IconArrowDownLeft size={12} className="text-gray-400" />{ev.usage.outTokens}</span>
                              <span className="mx-1">•</span>
                            </span>
                          ) : null}
                          {ev.duration_ms ? <span>{formatDuration(ev.duration_ms)}</span> : null}
                          {offset > 0 ? <span> • +{formatDuration(offset)}</span> : null}
                          <IconChevronDown size={14} className={`transition-transform ml-1 ${expanded ? 'rotate-180' : ''}`} />
                        </div>
                      </div>
                      
                      {/* Expanded View */}
                      {expanded && (
                        <div className="ml-[152px] mt-3 space-y-3 p-3 bg-[#fafafa] rounded-md border border-gray-200">
                          <div className="space-y-1">
                            <p className="text-[11px] text-gray-500">{humanizeEventType(ev.event_type)} • {new Date(ev.created_at).toLocaleString()}</p>
                            <pre className="max-h-64 overflow-auto rounded bg-gray-900 p-2 font-mono text-[11px] text-gray-100">{JSON.stringify(ev.parsed, null, 2)}</pre>
                          </div>
                          <StepArtifacts runID={id} artifacts={rowArtifacts} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          ) : null}

          {activeTab === 'debug' ? (
             <div className="space-y-6">
                <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
                  <h3 className="text-sm font-semibold tracking-tight text-gray-900 mb-4">Run Details</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5">Agent ID</p>
                      <p className="font-mono text-xs text-gray-900 bg-gray-50 p-2 rounded border border-gray-200">{runQ.data?.agent_id || '-'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5">Provider/Model</p>
                      <p className="font-mono text-xs text-gray-900 bg-gray-50 p-2 rounded border border-gray-200">{runQ.data?.provider || '-'}/{runQ.data?.model || '-'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5">Workspace</p>
                      <p className="font-mono text-xs text-gray-900 bg-gray-50 p-2 rounded border border-gray-200 truncate" title={toDisplayPath(runQ.data?.workspace_path || '')}>{toDisplayPath(runQ.data?.workspace_path || '') || 'None'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5">Status</p>
                      <p className="font-mono text-xs text-gray-900 bg-gray-50 p-2 rounded border border-gray-200">{runQ.data?.status || '-'}</p>
                    </div>
                  </div>
                  <details className="text-xs group">
                    <summary className="cursor-pointer text-gray-600 hover:text-gray-900 font-medium inline-flex items-center gap-1 transition-colors">
                      <IconChevronDown size={14} className="group-open:-rotate-180 transition-transform" />
                      View Raw Run Object
                    </summary>
                    <pre className="max-h-64 overflow-auto rounded-lg bg-gray-900 p-4 font-mono text-[11px] text-gray-100 mt-3 shadow-inner">{JSON.stringify(runQ.data, null, 2)}</pre>
                  </details>
                </div>
                
                <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                    <h3 className="text-sm font-semibold tracking-tight text-gray-900">Telemetry Steps</h3>
                    <span className="text-xs font-semibold bg-white border border-gray-200 text-gray-700 px-2.5 py-0.5 rounded-full shadow-sm">{telemetry?.steps?.length || 0}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-white border-b border-gray-100 text-gray-500 text-xs">
                        <tr>
                          <th className="px-5 py-3 font-medium">Idx</th>
                          <th className="px-5 py-3 font-medium">Step ID</th>
                          <th className="px-5 py-3 font-medium">Type</th>
                          <th className="px-5 py-3 font-medium">Status</th>
                          <th className="px-5 py-3 font-medium">Duration</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {telemetry?.steps?.length === 0 ? (
                          <tr><td colSpan={5} className="px-5 py-6 text-center text-gray-500 text-sm">No steps recorded</td></tr>
                        ) : telemetry?.steps?.map(s => (
                          <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-5 py-3 text-gray-500">{s.idx}</td>
                            <td className="px-5 py-3 font-mono text-xs text-gray-600">{s.id}</td>
                            <td className="px-5 py-3 font-medium text-gray-700">{s.step_type}</td>
                            <td className="px-5 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium capitalize ${s.status === 'completed' ? 'bg-green-50 text-green-700 border border-green-200' : s.status === 'failed' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-gray-100 text-gray-700 border border-gray-200'}`}>
                                {s.status}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-gray-500 font-mono text-xs">{formatDuration(stepDurationByID[s.id] || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                    <h3 className="text-sm font-semibold tracking-tight text-gray-900">Tool Calls</h3>
                    <span className="text-xs font-semibold bg-white border border-gray-200 text-gray-700 px-2.5 py-0.5 rounded-full shadow-sm">{telemetry?.tool_calls?.length || 0}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-white border-b border-gray-100 text-gray-500 text-xs">
                        <tr>
                          <th className="px-5 py-3 font-medium">Tool Name</th>
                          <th className="px-5 py-3 font-medium">Step ID</th>
                          <th className="px-5 py-3 font-medium">Status</th>
                          <th className="px-5 py-3 font-medium">Duration</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {telemetry?.tool_calls?.length === 0 ? (
                          <tr><td colSpan={4} className="px-5 py-6 text-center text-gray-500 text-sm">No tool calls recorded</td></tr>
                        ) : telemetry?.tool_calls?.map(tc => {
                           const dur = parseTimeMs(tc.ended_at) - parseTimeMs(tc.started_at)
                           return (
                             <tr key={tc.id} className="hover:bg-gray-50 transition-colors">
                               <td className="px-5 py-3 font-medium text-gray-900">{tc.tool_name}</td>
                               <td className="px-5 py-3 font-mono text-xs text-gray-500">{tc.step_id}</td>
                               <td className="px-5 py-3">
                                 <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium capitalize ${tc.status === 'completed' ? 'bg-green-50 text-green-700 border border-green-200' : tc.status === 'failed' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-gray-100 text-gray-700 border border-gray-200'}`}>
                                   {tc.status}
                                 </span>
                               </td>
                               <td className="px-5 py-3 text-gray-500 font-mono text-xs">{formatDuration(Number.isFinite(dur) && dur > 0 ? dur : 0)}</td>
                             </tr>
                           )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
             </div>
          ) : null}

          {activeTab === 'events' ? (
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Seq</th>
                      <th className="px-4 py-3 font-medium">Time</th>
                      <th className="px-4 py-3 font-medium">Actor</th>
                      <th className="px-4 py-3 font-medium">Event Type</th>
                      <th className="px-4 py-3 font-medium">Step ID</th>
                      <th className="px-4 py-3 font-medium">Payload Preview</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {eventRows.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No events recorded yet.</td></tr>
                    ) : eventRows.map((ev) => {
                       const offset = Number.isFinite(runStartMs) ? Math.max(0, parseTimeMs(ev.created_at) - runStartMs) : 0
                       const role = mapEventToRole(ev)
                       const isExpanded = expandedEventRowID === ev.id
                       return (
                         <React.Fragment key={ev.id}>
                           <tr className={`cursor-pointer transition-colors ${isExpanded ? 'bg-gray-50' : 'hover:bg-gray-50/50'}`} onClick={() => setExpandedEventRowID(isExpanded ? '' : ev.id)}>
                             <td className="px-4 py-2 text-gray-500 font-mono text-xs">{ev.seq}</td>
                             <td className="px-4 py-2 text-gray-500 font-mono text-xs">+{formatDuration(offset)}</td>
                             <td className="px-4 py-2">
                               <span className={`inline-flex items-center justify-center px-2 py-0.5 text-[10px] uppercase tracking-wide font-bold rounded shadow-sm ${getRoleColor(role)}`}>
                                 {role}
                               </span>
                             </td>
                             <td className="px-4 py-2 font-medium text-gray-700">{ev.event_type}</td>
                             <td className="px-4 py-2 text-gray-500 font-mono text-xs">{ev.step_id || '-'}</td>
                             <td className="px-4 py-2">
                               <div className="flex items-center gap-2">
                                 <span className="text-gray-400 font-mono text-xs truncate max-w-xs block">{truncateText(JSON.stringify(ev.parsed), 80)}</span>
                                 <IconChevronDown size={14} className={`text-gray-400 transition-transform ml-auto ${isExpanded ? 'rotate-180' : ''}`} />
                               </div>
                             </td>
                           </tr>
                           {isExpanded && (
                             <tr>
                               <td colSpan={6} className="px-4 pb-4 pt-1 bg-gray-50 border-b border-gray-100">
                                 <div className="ml-8 border-l-2 border-gray-200 pl-4">
                                   <p className="text-[11px] text-gray-500 mb-2">Created at {new Date(ev.created_at).toLocaleString()}</p>
                                   <pre className="max-h-64 overflow-auto rounded bg-gray-900 p-3 font-mono text-[11px] text-gray-100 shadow-inner whitespace-pre-wrap">{JSON.stringify(ev.parsed, null, 2)}</pre>
                                 </div>
                               </td>
                             </tr>
                           )}
                         </React.Fragment>
                       )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {activeTab === 'artifacts' ? (
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 bg-gray-50">
                <div className="flex items-center gap-2">
                  <IconFile size={16} className="text-gray-500" />
                  <h3 className="text-sm font-semibold tracking-tight text-gray-900">Run Artifacts</h3>
                </div>
                <span className="text-xs font-semibold bg-white border border-gray-200 text-gray-700 px-2.5 py-0.5 rounded-full shadow-sm">
                  {displayArtifacts.length}
                </span>
              </div>
              <div className="p-5">
                {displayArtifacts.length === 0 ? (
                  <div className="text-center text-gray-500 py-10 flex flex-col items-center justify-center">
                    <IconFile size={40} className="text-gray-300 mb-3" />
                    <p className="text-sm font-medium text-gray-900 mb-1">No artifacts found</p>
                    <p className="text-xs">This session has not generated files or logs yet.</p>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {displayArtifacts.map((artifact) => (
                      <StepArtifactCard key={artifact.id} runID={id} artifact={artifact} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {isArtifactsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 bg-gray-50/80">
              <div className="flex items-center gap-2">
                <IconFile size={18} className="text-gray-500" />
                <h2 className="text-lg font-semibold text-gray-900">Run Artifacts <span className="text-gray-500 font-normal text-sm ml-1">({displayArtifacts.length})</span></h2>
              </div>
              <button 
                onClick={() => setIsArtifactsModalOpen(false)} 
                className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-1.5 rounded-md transition-colors"
              >
                <IconX size={20} />
              </button>
            </div>
            <div className="p-6 overflow-auto bg-gray-50/30">
              {displayArtifacts.length === 0 ? (
                <div className="text-center text-gray-500 py-12 flex flex-col items-center justify-center">
                  <IconFile size={48} className="text-gray-300 mb-4" />
                  <p className="text-base font-medium text-gray-900 mb-1">No artifacts found</p>
                  <p className="text-sm">This session hasn't generated any files or logs yet.</p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {displayArtifacts.map((artifact) => (
                    <StepArtifactCard key={artifact.id} runID={id} artifact={artifact} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function mapEventToRole(ev: EventRow) {
  if (ev.event_type === 'run.started') return 'Running'
  if (ev.actor === 'user') return 'User'
  if (ev.event_type === 'tool.result') {
     const parsed = ev.parsed as any
     if (parsed?.tool === 'bash') return 'Bash'
     if (parsed?.tool === 'write') return 'Write'
     if (typeof parsed?.tool === 'string' && parsed.tool) {
        return parsed.tool
     }
     return 'Tool'
  }
  return 'Agent'
}

function summarizeEvent(row: EventRow) {
  if (typeof row.parsed !== 'object' || row.parsed === null) return String(row.parsed)
  const parsed = row.parsed as Record<string, unknown>
  const snippet = extractSnippet(parsed)

  if (row.event_type === 'tool.result') {
    const tool = toolLabel(typeof parsed.tool === 'string' && parsed.tool.trim() ? parsed.tool : 'tool')
    const status = typeof parsed.status === 'string' && parsed.status.trim() ? parsed.status : ''
    const error = typeof parsed.error === 'string' ? parsed.error.trim() : ''
    if (error) return `${tool} failed`
    if (status === 'completed') return summarizeToolResult(parsed, tool) || `${tool} completed`
    if (status) return `${tool} ${status}`
    return summarizeToolResult(parsed, tool) || `${tool} finished`
  }

  if (row.event_type === 'model.response') {
    if (snippet) return snippet
    const toolCalls = parsed.tool_calls
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      return `Model requested ${toolCalls.length} tool call${toolCalls.length > 1 ? 's' : ''}`
    }
    return 'Model response'
  }

  if (row.event_type === 'run.completed') {
    return snippet ? `Final result generated` : 'Run completed'
  }
  if (row.event_type === 'run.started') {
    const provider = typeof parsed.provider === 'string' ? parsed.provider : ''
    const model = typeof parsed.model === 'string' ? parsed.model : ''
    if (provider || model) return `Using ${provider}${provider && model ? ' ' : ''}${model}`.trim()
    return 'Run started'
  }
  if (row.event_type === 'run.created') {
    return 'Run queued'
  }

  if (typeof parsed.reason === 'string' && parsed.reason.trim()) return parsed.reason.trim()
  if (typeof parsed.error === 'string' && parsed.error.trim()) return `Error: ${parsed.error.trim()}`
  if (typeof parsed.status === 'string' && parsed.status.trim()) return `Status: ${parsed.status.trim()}`
  if (typeof parsed.text === 'string' && parsed.text.trim()) return truncateText(parsed.text)
  if (typeof parsed.result === 'string' && parsed.result.trim()) return truncateText(parsed.result)

  return truncateText(JSON.stringify(parsed))
}

function transcriptLine(row: EventRow) {
  const readable = summarizeEvent(row)
  switch (row.event_type) {
    case 'run.created':
      return { title: 'Run queued', subtitle: readable || 'Run is queued and waiting for execution.' }
    case 'run.started':
      return { title: 'Run started', subtitle: readable || 'Agent runtime has started.' }
    case 'run.completed':
      return { title: 'Run completed', subtitle: readable || 'Run completed successfully.' }
    case 'run.failed':
      return { title: 'Run failed', subtitle: readable || 'Run ended with an error.' }
    case 'model.response':
      return { title: 'Agent response', subtitle: readable || 'Model generated a response.' }
    case 'tool.result':
      return { title: 'Tool execution', subtitle: readable || 'Tool completed.' }
    case 'approval.requested':
      return { title: 'Approval requested', subtitle: readable || 'Operator approval is required.' }
    case 'approval.approved':
      return { title: 'Approval granted', subtitle: readable || 'Operator approved and session resumed.' }
    default:
      return { title: humanizeEventType(row.event_type), subtitle: readable || 'Event recorded.' }
  }
}

function extractSnippet(parsed: Record<string, unknown>) {
  if (typeof parsed.result === 'string' && parsed.result.trim()) return truncateText(parsed.result, 120)
  if (typeof parsed.text === 'string' && parsed.text.trim()) return truncateText(parsed.text, 120)
  if (typeof parsed.log === 'string' && parsed.log.trim()) return truncateText(parsed.log, 120)

  const output = parsed.output
  if (typeof output === 'string' && output.trim()) return truncateText(output, 120)
  if (output && typeof output === 'object') {
    const outRec = output as Record<string, unknown>
    if (typeof outRec.output === 'string' && outRec.output.trim()) return truncateText(outRec.output, 120)
    if (typeof outRec.result === 'string' && outRec.result.trim()) return truncateText(outRec.result, 120)
  }
  return ''
}

function truncateText(value: string, max = 180) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact
}

function humanizeEventType(value: string) {
  if (!value) return 'Event'
  return value.replace(/[._]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

function toolLabel(name: string) {
  return name.replace(/\./g, ' ').trim()
}

function summarizeToolResult(parsed: Record<string, unknown>, tool: string) {
  const output = parsed.output
  let exitCode = 0
  let outText = ''
  if (output && typeof output === 'object') {
    const outRec = output as Record<string, unknown>
    exitCode = Number(outRec.exit_code || 0)
    if (typeof outRec.output === 'string') outText = outRec.output
    if (!outText && typeof outRec.result === 'string') outText = outRec.result
  }
  if (!outText && typeof parsed.log === 'string') outText = parsed.log
  if (!outText && typeof parsed.result === 'string') outText = parsed.result

  const ipInfo = compactIPInfo(outText)
  if (ipInfo) return `${tool} ${ipInfo}`
  if (exitCode !== 0) return `${tool} exited with code ${exitCode}`
  return `${tool} completed`
}

function compactIPInfo(text: string) {
  if (!text) return ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return ''
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>
    const ip = typeof parsed.ip === 'string' ? parsed.ip : ''
    const city = typeof parsed.city === 'string' ? parsed.city : ''
    const country = typeof parsed.country === 'string' ? parsed.country : ''
    if (ip && city) return `returned ${ip} (${city}${country ? `, ${country}` : ''})`
    if (ip) return `returned ${ip}`
  } catch {
    return ''
  }
  return ''
}

function StepArtifacts({ runID, artifacts }: { runID: string; artifacts: DisplayArtifact[] }) {
  if (artifacts.length === 0) return <p className="text-[11px] text-gray-500">No artifacts for this step.</p>
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-700">Artifacts ({artifacts.length})</p>
      {artifacts.map((artifact) => (
        <StepArtifactCard key={artifact.id} runID={runID} artifact={artifact} />
      ))}
    </div>
  )
}

function StepArtifactCard({ runID, artifact }: { runID: string; artifact: DisplayArtifact }) {
  const hasInlineLog = typeof artifact._inline_log === 'string'
  const isImage = !hasInlineLog && artifact.mime_type.startsWith('image/')
  const contentURL = !hasInlineLog ? api.getRunArtifactContentURL(runID, artifact.id) : ''
  return (
    <div className="rounded border border-gray-200 bg-white p-2 text-sm shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{artifact.kind}</p>
        <div className="flex items-center gap-1">
          {hasInlineLog ? (
            <button
              className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50 transition-colors"
              onClick={() => navigator.clipboard.writeText(String(artifact._inline_log || ''))}
            >
              <IconCopy size={12} />
              Copy log
            </button>
          ) : (
            <>
              <button className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50 transition-colors" onClick={() => navigator.clipboard.writeText(toDisplayPath(artifact.path))}>
                <IconCopy size={12} />
                Copy path
              </button>
              <a href={contentURL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50 transition-colors">
                Open
              </a>
            </>
          )}
        </div>
      </div>
      <p className="break-all font-mono text-[11px] text-gray-600 mt-1">{toDisplayPath(artifact.path)}</p>
      <p className="text-[11px] text-gray-500">{(artifact.size_bytes / 1024).toFixed(1)} KB</p>
      {hasInlineLog ? (
        <pre className="mt-2 max-h-36 overflow-auto rounded bg-gray-900 p-2 font-mono text-[11px] text-gray-100">{String(artifact._inline_log)}</pre>
      ) : null}
      {isImage ? (
        <a href={contentURL} target="_blank" rel="noreferrer" className="mt-2 block rounded border border-gray-200 bg-gray-50 p-1">
          <img src={contentURL} alt={artifact.kind} className="max-h-72 w-full rounded object-contain" loading="lazy" />
        </a>
      ) : null}
    </div>
  )
}

function actorFromEventType(eventType: string): ActorLaneId {
  if (eventType.startsWith('user')) return 'user'
  if (eventType.startsWith('tool')) return 'tools'
  if (eventType.startsWith('model') || eventType.startsWith('run.step')) return 'orchestrator'
  return 'system'
}

function actorFromSpan(span: TraceSpan): ActorLaneId {
  if (span.kind === 'tool' || span.name.startsWith('tool.')) return 'tools'
  if (span.kind === 'model' || span.name.startsWith('model')) return 'orchestrator'
  return 'system'
}

function parseTimeMs(value?: string) {
  if (!value) return NaN
  const n = Date.parse(value)
  return Number.isNaN(n) ? NaN : n
}

function tryParseJSON(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return value
  }
}

function usageLabelFromPayload(payload: Record<string, unknown> | string) {
  if (typeof payload !== 'object' || payload === null) return null
  const usage = payload.usage as Record<string, unknown>
  if (!usage) return null
  const inTokens = Number(usage.input_tokens || 0)
  const outTokens = Number(usage.output_tokens || 0)
  if (inTokens === 0 && outTokens === 0) return null
  return { inTokens, outTokens }
}

function formatDuration(ms: number) {
  if (!ms || ms < 0) return '0s'
  if (ms < 1000) return '<1s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m < 60) return `${m}m ${rem}s`
  const h = Math.floor(m / 60)
  const remM = m % 60
  return `${h}h ${remM}m`
}

function toDisplayPath(rawPath: string) {
  const value = String(rawPath || '').trim()
  if (!value) return ''
  if (value.startsWith('inline://')) return value
  const normalized = value.replaceAll('\\', '/')
  const artifactsIdx = normalized.lastIndexOf('/artifacts/')
  if (artifactsIdx >= 0) return normalized.slice(artifactsIdx + 1)
  const projectIdx = normalized.lastIndexOf('/colosseum/')
  if (projectIdx >= 0) return normalized.slice(projectIdx + '/colosseum/'.length)
  return normalized.replace(/^\/+/, '')
}
