import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import React from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  IconChevronDown,
  IconGitBranch,
  IconCloud,
  IconFile,
  IconLock,
  IconClock,
  IconPlayerPlay,
  IconDatabase,
  IconCopy,
  IconArrowUpRight,
  IconArrowDownLeft,
} from '@tabler/icons-react'
import { api } from '../lib/api'
import type { Artifact, LLMRequestSnapshot, TraceSpan } from '../lib/types'
import { queryKeys } from '../lib/queryKeys'
import { formatDuration, parseJSONStringRecord, parseTimeMs, prettyJSON, tryParseJSON } from '../lib/time'
import { QueryErrorState, StatusBadge } from '../components/Common'
import { Button } from '../components/ui/Button'
import { Chip } from '../components/ui/Chip'
import { Modal } from '../components/ui/Modal'
import { Tabs, type TabItem } from '../components/ui/Tabs'
import { ACTOR_COLORS, FOCUS_RING } from '../lib/tokens'

import { formatDistanceToNow } from 'date-fns'

type TabId = 'transcript' | 'debug' | 'events' | 'artifacts'

const RUN_DETAIL_TABS: TabItem[] = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'debug', label: 'Debug' },
  { id: 'events', label: 'All events' },
  { id: 'artifacts', label: 'Artifacts' },
]

const SCROLL_SNAP_WINDOW_MS = 2000

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
  const [timelineTooltip, setTimelineTooltip] = useState<{ x: number; y: number; name: string; duration: string; actor: string } | null>(null)

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
  const timelineRows = useMemo(() => {
    type TSpan = (typeof spans)[number]
    if (!timeline) return [] as TSpan[][]
    const sorted = [...timeline.spans].sort((a, b) => a.__start - b.__start)
    const rows: TSpan[][] = []
    for (const span of sorted) {
      const start = span.__start
      let placed = false
      for (const row of rows) {
        const last = row[row.length - 1]
        const lastEnd = last.__end || last.__start
        if (lastEnd <= start) {
          row.push(span)
          placed = true
          break
        }
      }
      if (!placed) rows.push([span])
    }
    return rows
  }, [timeline])

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
  const llmRequestRows = useMemo(() => {
    return (telemetry?.steps ?? [])
      .filter((step) => step.step_type === 'model')
      .map((step) => {
        const input = parseJSONStringRecord(step.input_json)
        const output = parseJSONStringRecord(step.output_json)
        const request = input as LLMRequestSnapshot
        const usage = output?.usage && typeof output.usage === 'object'
          ? (output.usage as Record<string, unknown>)
          : null
        const inputTokens = usage ? Number(usage.input_tokens || 0) : 0
        const outputTokens = usage ? Number(usage.output_tokens || 0) : 0
        const roleCounts = request.message_role_counts && typeof request.message_role_counts === 'object'
          ? request.message_role_counts
          : {}
        return {
          stepID: step.id,
          idx: step.idx,
          status: step.status,
          model: String(request.model || runQ.data?.model || '-'),
          messageCount: Number(request.message_count || 0),
          systemPromptLength: Number(request.system_prompt_len || 0),
          toolCount: Number(request.tool_count || 0),
          toolNames: Array.isArray(request.tool_names) ? request.tool_names.filter(Boolean) : [],
          userMessages: Number(roleCounts.user || 0),
          assistantMessages: Number(roleCounts.assistant || 0),
          toolMessages: Number(roleCounts.tool || 0),
          systemMessages: Number(roleCounts.system || 0),
          inputTokens,
          outputTokens,
          inputRaw: step.input_json || '',
          outputRaw: step.output_json || '',
          messagePreviewRows: Array.isArray(request.messages) ? request.messages.slice(-3) : [],
        }
      })
      .sort((a, b) => a.idx - b.idx)
  }, [telemetry?.steps, runQ.data?.model])

  if (!id) return null

  const taskTitle = runQ.data?.task || 'Run Detail'
  const statusLabel = runQ.data?.status || 'Unknown'

  return (
    <div className="flex flex-col h-[100vh] bg-[#fafafa] text-sm -mt-5 -mx-6 -mb-5 rounded-tl-xl overflow-hidden shadow-sm border-l border-t border-gray-200">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-2 text-sm text-gray-500">
              <Link to="/runs" className={`rounded transition-colors hover:text-gray-700 ${FOCUS_RING}`}>Runs</Link>
              <span className="text-gray-300" aria-hidden="true">/</span>
              <span className="truncate font-medium text-gray-600">{id}</span>
            </nav>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="min-w-0 flex-1 text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                {taskTitle}
              </h1>
              <StatusBadge status={statusLabel} />
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
            <label htmlFor="run-steer" className="sr-only">Message agent</label>
            <input
              id="run-steer"
              type="text"
              value={steerText}
              onChange={(e) => setSteerText(e.target.value)}
              placeholder="Message agent..."
              className={`h-9 min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm transition-colors focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 lg:w-80 lg:flex-none ${FOCUS_RING}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void sendSteeringMessage()
                }
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void sendSteeringMessage()}
              disabled={!steerText.trim() || steer.isPending}
              trailingIcon={<IconArrowUpRight size={14} className="text-gray-400" />}
            >
              {steer.isPending ? 'Sending…' : 'Send'}
            </Button>
            {steerError ? <p className="w-full text-xs text-red-600" role="alert">{steerError}</p> : null}
          </div>
        </div>
      </div>

      {/* Tags row */}
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-[#fafafa]/50 px-6 py-3 text-xs text-gray-600">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 font-medium shadow-sm">
            <IconGitBranch size={14} className="text-gray-400" /> {agentQ.data?.name || runQ.data?.agent_id || 'default-agent'}
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 font-medium shadow-sm">
            <IconCloud size={14} className="text-gray-400" /> {environmentLabel}
          </div>
          <button
            type="button"
            onClick={() => setIsArtifactsModalOpen(true)}
            className={`flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 font-medium shadow-sm transition-colors hover:bg-gray-50 ${FOCUS_RING}`}
          >
            <IconFile size={14} className="text-gray-400" /> {displayArtifacts.length} {displayArtifacts.length === 1 ? 'file' : 'files'}
          </button>
          <div className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 font-medium text-gray-500 shadow-sm">
            <IconLock size={14} className="text-gray-400" /> {vaultLabel}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 font-medium text-gray-500">
          <span className="flex items-center gap-1.5">
            <IconClock size={14} /> {runQ.data?.created_at ? formatDistanceToNow(new Date(runQ.data.created_at), { addSuffix: true }) : 'Just now'}
          </span>
          <span className="flex items-center gap-1.5">
            <IconPlayerPlay size={14} /> {metrics.elapsedLabel}
          </span>
          <span className="flex items-center gap-1.5">
            <IconDatabase size={14} /> {(metrics.inTokens / 1000).toFixed(1)}k / {(metrics.outTokens / 1000).toFixed(1)}k ({metrics.inTokens + metrics.outTokens > 0 ? Math.round((metrics.outTokens / (metrics.inTokens + metrics.outTokens)) * 100) : 0}%)
          </span>
        </div>
      </div>

      {runQ.isError || telemetryQ.isError ? (
        <div className="px-6 py-3">
          <QueryErrorState title="Couldn't load run" query={runQ.isError ? runQ : telemetryQ} />
        </div>
      ) : null}

      {/* Main content body */}
      <div className="flex-1 overflow-auto bg-[#fafafa]">
        {/* Tabs */}
        <div className="sticky top-0 z-10 border-b border-gray-200 bg-[#fafafa] px-6 pt-3">
          <Tabs tabs={RUN_DETAIL_TABS} value={activeTab} onChange={(next) => setActiveTab(next as TabId)} />
        </div>

        <div className={`p-6 mx-auto ${activeTab === 'transcript' ? 'max-w-6xl' : activeTab === 'events' ? 'max-w-none' : 'max-w-5xl'}`}>
          {activeTab === 'transcript' ? (
            <>
              {/* Timeline Component */}
              <div className="mb-8 rounded-lg border border-gray-200 bg-white px-4 pt-3 pb-2.5 shadow-sm">
                <div className="mb-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-sm font-semibold tabular-nums text-gray-900">
                      {formatDuration(timeline?.total ?? 0)}
                    </span>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-600">{timelineMeta?.totalSpans ?? 0} {timelineMeta?.totalSpans === 1 ? 'span' : 'spans'}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-gray-500">
                    {(timelineMeta?.orchestrator ?? 0) > 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: ACTOR_COLORS.orchestrator }} />
                        <span className="tabular-nums">{timelineMeta?.orchestrator}</span>
                        <span className="text-gray-400">orch</span>
                      </span>
                    ) : null}
                    {(timelineMeta?.tools ?? 0) > 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: ACTOR_COLORS.tool }} />
                        <span className="tabular-nums">{timelineMeta?.tools}</span>
                        <span className="text-gray-400">tool</span>
                      </span>
                    ) : null}
                    {(timelineMeta?.system ?? 0) > 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: ACTOR_COLORS.system }} />
                        <span className="tabular-nums">{timelineMeta?.system}</span>
                        <span className="text-gray-400">sys</span>
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="relative w-full">
                  {timeline ? (
                    <div className="space-y-[3px]">
                      {timelineRows.map((row, rowIdx) => (
                        <div key={rowIdx} className="relative h-5 w-full">
                          {row.map((span) => {
                            const start = ((span.__start - timeline.min) / timeline.total) * 100
                            const spanMs = Math.max(0, (span.__end || span.__start) - span.__start)
                            const width = Math.max(0.3, (spanMs / timeline.total) * 100)
                            const bgColor = span.__actor === 'tools'
                              ? ACTOR_COLORS.tool
                              : span.__actor === 'orchestrator'
                                ? ACTOR_COLORS.orchestrator
                                : ACTOR_COLORS.system
                            return (
                              <button
                                type="button"
                                key={span.id}
                                className={`group absolute top-0 h-5 cursor-pointer rounded-[2px] opacity-80 transition-opacity hover:opacity-100 focus-visible:opacity-100 ${FOCUS_RING}`}
                                style={{ left: `${start}%`, width: `${width}%`, backgroundColor: bgColor }}
                                aria-label={`${span.name}, ${formatDuration(spanMs)}, ${span.__actor}`}
                                onMouseEnter={(ev) => {
                                  const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
                                  setTimelineTooltip({
                                    x: rect.left + rect.width / 2,
                                    y: rect.top,
                                    name: span.name,
                                    duration: formatDuration(spanMs),
                                    actor: span.__actor,
                                  })
                                }}
                                onMouseLeave={() => setTimelineTooltip(null)}
                                onFocus={(ev) => {
                                  const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
                                  setTimelineTooltip({
                                    x: rect.left + rect.width / 2,
                                    y: rect.top,
                                    name: span.name,
                                    duration: formatDuration(spanMs),
                                    actor: span.__actor,
                                  })
                                }}
                                onBlur={() => setTimelineTooltip(null)}
                                onClick={() => {
                                  const targetMs = span.__start
                                  let best: { id: string; dist: number } | null = null
                                  for (const ev of eventRows) {
                                    const evMs = parseTimeMs(ev.created_at)
                                    if (!Number.isFinite(evMs)) continue
                                    const dist = Math.abs(evMs - targetMs)
                                    if (!best || dist < best.dist) best = { id: ev.id, dist }
                                  }
                                  if (best && best.dist < SCROLL_SNAP_WINDOW_MS) {
                                    const el = document.getElementById(`run-event-${best.id}`)
                                    if (el) {
                                      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                      setExpandedRowID(best.id)
                                    }
                                  }
                                }}
                              />
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-5 w-full items-center justify-center rounded-sm bg-gray-50 text-[11px] text-gray-400">
                      Waiting for spans…
                    </div>
                  )}
                  <div className="mt-2 flex h-3 w-full items-start justify-between border-t border-gray-100 pt-1 text-[10px] tabular-nums text-gray-400">
                    {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
                      <span
                        key={frac}
                        className={`px-0.5 ${frac === 0 ? 'text-left' : frac === 1 ? 'text-right' : 'text-center'}`}
                      >
                        {formatDuration(Math.round((timeline?.total ?? 0) * frac))}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              {timelineTooltip ? (
                <div
                  className="pointer-events-none fixed z-50 max-w-xs -translate-x-1/2 -translate-y-full rounded-md bg-gray-900 px-2.5 py-1.5 text-[11px] leading-tight text-white shadow-lg"
                  style={{
                    left: Math.min(Math.max(timelineTooltip.x, 80), window.innerWidth - 80),
                    top: Math.max(timelineTooltip.y - 8, 32),
                  }}
                >
                  <div className="font-medium">{timelineTooltip.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-gray-300">
                    <span className="tabular-nums">{timelineTooltip.duration}</span>
                    <span className="text-gray-500">·</span>
                    <span>{timelineTooltip.actor}</span>
                  </div>
                </div>
              ) : null}

              {/* Agent lane heading */}
              <div className="mx-auto mb-6 flex max-w-5xl items-center gap-6 border-b border-gray-200">
                <span className="-mb-px border-b-2 border-gray-900 pb-2 text-sm font-medium text-gray-900">Orchestrator</span>
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
                    <div key={ev.id} id={`run-event-${ev.id}`} className={`group border transition-colors rounded-md px-3 py-2 scroll-mt-24 ${expanded ? 'bg-white border-gray-200 shadow-sm' : 'border-transparent hover:border-gray-200 hover:bg-white hover:shadow-sm'}`}>
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
                    <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-gray-900 p-4 font-mono text-[11px] text-gray-100">{JSON.stringify(runQ.data, null, 2)}</pre>
                  </details>
                </div>

                <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                    <h3 className="text-sm font-semibold tracking-tight text-gray-900">LLM Requests</h3>
                    <span className="text-xs font-semibold bg-white border border-gray-200 text-gray-700 px-2.5 py-0.5 rounded-full shadow-sm">{llmRequestRows.length}</span>
                  </div>
                  <div className="p-5 space-y-3">
                    {llmRequestRows.length === 0 ? (
                      <p className="text-sm text-gray-500">No model request snapshots yet.</p>
                    ) : llmRequestRows.map((row) => (
                      <details key={row.stepID} className="group rounded-md border border-gray-200 bg-white p-3">
                        <summary className="cursor-pointer list-none">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Chip>Step {row.idx}</Chip>
                              <Chip className="font-mono">{row.model}</Chip>
                              <Chip>{row.messageCount} msgs</Chip>
                              <Chip>{row.toolCount} tools</Chip>
                              <Chip>system {row.systemPromptLength} chars</Chip>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-gray-500">
                              {row.inputTokens > 0 || row.outputTokens > 0 ? (
                                <span className="font-mono">{row.inputTokens} in / {row.outputTokens} out</span>
                              ) : null}
                              <IconChevronDown size={14} className="transition-transform group-open:rotate-180" />
                            </div>
                          </div>
                        </summary>
                        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
                          <div className="flex flex-wrap gap-2 text-[11px] text-gray-600">
                            <Chip>user {row.userMessages}</Chip>
                            <Chip>assistant {row.assistantMessages}</Chip>
                            <Chip>tool {row.toolMessages}</Chip>
                            <Chip>system {row.systemMessages}</Chip>
                          </div>
                          {row.toolNames.length > 0 ? (
                            <p className="text-[11px] text-gray-600">
                              <span className="font-medium text-gray-700">Tools enabled:</span> {row.toolNames.join(', ')}
                            </p>
                          ) : null}
                          {row.messagePreviewRows.length > 0 ? (
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-gray-700">Last messages sent</p>
                              {row.messagePreviewRows.map((msg, idx) => (
                                <div key={`${row.stepID}-${idx}`} className="rounded border border-gray-200 bg-gray-50 p-2">
                                  <p className="text-[11px] font-medium text-gray-700">
                                    {msg.role || 'unknown'}
                                    {msg.name ? ` • ${msg.name}` : ''}
                                    {msg.content_length ? ` • ${msg.content_length} chars` : ''}
                                  </p>
                                  {msg.content_preview ? (
                                    <p className="mt-1 text-[11px] text-gray-600 break-words">{msg.content_preview}</p>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                          <details>
                            <summary className="cursor-pointer text-xs font-medium text-gray-600 hover:text-gray-900">
                              View raw request/response JSON
                            </summary>
                            <div className="mt-2 grid gap-2 lg:grid-cols-2">
                              <pre className="max-h-64 overflow-auto rounded bg-gray-900 p-2 font-mono text-[11px] text-gray-100">{prettyJSON(row.inputRaw)}</pre>
                              <pre className="max-h-64 overflow-auto rounded bg-gray-900 p-2 font-mono text-[11px] text-gray-100">{prettyJSON(row.outputRaw)}</pre>
                            </div>
                          </details>
                        </div>
                      </details>
                    ))}
                  </div>
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
                              <StatusBadge status={s.status} />
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
                                 <StatusBadge status={tc.status} />
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
                                   <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-gray-900 p-3 font-mono text-[11px] text-gray-100">{JSON.stringify(ev.parsed, null, 2)}</pre>
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

      <Modal
        open={isArtifactsModalOpen}
        onClose={() => setIsArtifactsModalOpen(false)}
        title={<span className="flex items-center gap-2"><IconFile size={18} className="text-gray-500" />Run Artifacts <span className="ml-1 text-sm font-normal text-gray-500">({displayArtifacts.length})</span></span>}
        widthClass="max-w-4xl"
      >
        {displayArtifacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-gray-500">
            <IconFile size={48} className="mb-4 text-gray-300" />
            <p className="mb-1 text-base font-medium text-gray-900">No artifacts found</p>
            <p className="text-sm">This session hasn't generated any files or logs yet.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {displayArtifacts.map((artifact) => (
              <StepArtifactCard key={artifact.id} runID={id} artifact={artifact} />
            ))}
          </div>
        )}
      </Modal>
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

function usageLabelFromPayload(payload: Record<string, unknown> | string) {
  if (typeof payload !== 'object' || payload === null) return null
  const usage = payload.usage as Record<string, unknown>
  if (!usage) return null
  const inTokens = Number(usage.input_tokens || 0)
  const outTokens = Number(usage.output_tokens || 0)
  if (inTokens === 0 && outTokens === 0) return null
  return { inTokens, outTokens }
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
