import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, ChevronDown, Clock3, Copy, ExternalLink, Filter, Layers, PauseCircle, Play, PlayCircle, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'
import { Card, EmptyState, StatusBadge } from '../components/Common'
import type { Artifact, RunTelemetry, ToolCall, TraceSpan } from '../lib/types'

type TabId = 'transcript' | 'debug' | 'events'

type EventRow = {
  id: string
  seq: number
  event_type: string
  step_id: string
  created_at: string
  parsed: Record<string, unknown> | string
  actor: ActorLaneId
  duration_ms?: number
  usage_label?: string
}

type DisplayArtifact = Artifact & {
  _inline_log?: string
  _order?: number
}

type ActorLaneId = 'orchestrator' | 'tools' | 'system' | 'user'

const laneMeta: Record<ActorLaneId, { label: string; tone: string; barTone: string }> = {
  orchestrator: { label: 'Orchestrator', tone: 'bg-indigo-50 text-indigo-700 border-indigo-200', barTone: 'bg-indigo-400' },
  tools: { label: 'Tools', tone: 'bg-cyan-50 text-cyan-700 border-cyan-200', barTone: 'bg-cyan-400' },
  system: { label: 'System', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', barTone: 'bg-emerald-400' },
  user: { label: 'User', tone: 'bg-violet-50 text-violet-700 border-violet-200', barTone: 'bg-violet-400' },
}

export function RunDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabId>('transcript')
  const [filterText, setFilterText] = useState('')
  const [steerText, setSteerText] = useState('')
  const [selectedSpan, setSelectedSpan] = useState<TraceSpan | null>(null)
  const [selectedToolCallID, setSelectedToolCallID] = useState('')
  const activeActors: ActorLaneId[] = ['orchestrator', 'tools', 'system', 'user']

  const runQ = useQuery({ queryKey: ['run', id], queryFn: () => api.getRun(id), enabled: Boolean(id), refetchInterval: 1800 })
  const telemetryQ = useQuery({ queryKey: ['telemetry', id], queryFn: () => api.getRunTelemetry(id), enabled: Boolean(id), refetchInterval: 1800 })
  const artifactsQ = useQuery({ queryKey: ['artifacts', id], queryFn: () => api.getRunArtifacts(id), enabled: Boolean(id), refetchInterval: 2500 })

  const interrupt = useMutation({ mutationFn: () => api.interruptRun(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['run', id] }) })
  const resume = useMutation({ mutationFn: () => api.resumeRun(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['run', id] }) })
  const approve = useMutation({ mutationFn: () => api.approveRun(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['telemetry', id] }) })
  const steer = useMutation({ mutationFn: () => api.steerRun(id, { message: steerText }), onSuccess: () => setSteerText('') })
  const restart = useMutation({
    mutationFn: async () => {
      if (!runQ.data) throw new Error('Run not loaded')
      return api.createRun({
        agent_id: runQ.data.agent_id,
        task: runQ.data.task,
        provider: runQ.data.provider,
        model: runQ.data.model,
        max_steps: runQ.data.max_steps,
      })
    },
    onSuccess: (out) => {
      navigate(`/runs/${out.id}`)
    },
  })
  const replay = useMutation({
    mutationFn: (args: { resumeFromStep: number }) => api.replayRun(id, { resume_from_step: args.resumeFromStep }),
    onSuccess: (out) => navigate(`/runs/${out.id}`),
  })

  useEffect(() => {
    if (!id) return
    const es = new EventSource(`/api/stream/runs/${id}`)
    es.addEventListener('run_event', () => {
      qc.invalidateQueries({ queryKey: ['telemetry', id] })
      qc.invalidateQueries({ queryKey: ['run', id] })
      qc.invalidateQueries({ queryKey: ['artifacts', id] })
    })
    return () => es.close()
  }, [id, qc])

  const telemetry = telemetryQ.data
  const selectedToolCall = useMemo(() => {
    if (!selectedToolCallID) return null
    return (telemetry?.tool_calls ?? []).find((tc) => tc.id === selectedToolCallID) ?? null
  }, [telemetry?.tool_calls, selectedToolCallID])

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
      usage_label: usageLabelFromPayload(tryParseJSON(String(ev.payload_json || ''))),
    }))
  }, [telemetry, stepDurationByID, toolDurationByStepID])

  const stepIndexByID = useMemo(() => {
    const out: Record<string, number> = {}
    for (const s of telemetry?.steps ?? []) {
      out[s.id] = s.idx
    }
    return out
  }, [telemetry?.steps])

  const filteredEvents = useMemo(() => {
    let out = eventRows.filter((ev) => activeActors.includes(ev.actor))
    if (!filterText.trim()) return out
    const q = filterText.toLowerCase()
    return out.filter((ev) => `${ev.event_type} ${JSON.stringify(ev.parsed)}`.toLowerCase().includes(q))
  }, [eventRows, filterText, activeActors])

  const spans = useMemo(() => {
    return (telemetry?.spans ?? [])
      .map((s) => ({ ...s, __start: parseTimeMs(s.started_at), __end: parseTimeMs(s.ended_at), __actor: actorFromSpan(s) }))
      .filter((s) => Number.isFinite(s.__start))
      .filter((s) => activeActors.includes(s.__actor))
  }, [telemetry, activeActors])

  const timeline = useMemo(() => {
    if (spans.length === 0) return null
    const min = Math.min(...spans.map((s) => s.__start))
    const max = Math.max(...spans.map((s) => s.__end || s.__start))
    const total = Math.max(1, max - min)

    return {
      min,
      max,
      total,
      lanes: [
        { id: 'orchestrator' as ActorLaneId, label: laneMeta.orchestrator.label, spans: spans.filter((s) => s.__actor === 'orchestrator') },
        { id: 'tools' as ActorLaneId, label: laneMeta.tools.label, spans: spans.filter((s) => s.__actor === 'tools') },
        { id: 'system' as ActorLaneId, label: laneMeta.system.label, spans: spans.filter((s) => s.__actor === 'system') },
        { id: 'user' as ActorLaneId, label: laneMeta.user.label, spans: spans.filter((s) => s.__actor === 'user') },
      ],
    }
  }, [spans])

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

  const sessionLifecycle = useMemo(() => {
    const status = runQ.data?.status || 'unknown'
    const stopReason = detectStopReason(status, eventRows)
    return { status, stopReason }
  }, [runQ.data?.status, eventRows])

  const runStartMs = useMemo(() => {
    const runStart = parseTimeMs(runQ.data?.started_at) || parseTimeMs(runQ.data?.created_at)
    if (Number.isFinite(runStart)) return runStart
    if (eventRows.length === 0) return NaN
    const first = parseTimeMs(eventRows[0].created_at)
    return Number.isFinite(first) ? first : NaN
  }, [runQ.data?.started_at, runQ.data?.created_at, eventRows])

  const finalResult = useMemo(() => {
    const completed = [...eventRows].reverse().find((e) => e.event_type === 'run.completed')
    if (completed && typeof completed.parsed === 'object' && completed.parsed !== null) {
      const parsed = completed.parsed as Record<string, unknown>
      if (typeof parsed.result === 'string' && parsed.result.trim()) return parsed.result
      if (typeof parsed.text === 'string' && parsed.text.trim()) return parsed.text
    }
    const lastModelResponse = [...eventRows].reverse().find((e) => e.event_type === 'model.response')
    if (lastModelResponse && typeof lastModelResponse.parsed === 'object' && lastModelResponse.parsed !== null) {
      const parsed = lastModelResponse.parsed as Record<string, unknown>
      if (typeof parsed.text === 'string' && parsed.text.trim()) return parsed.text
      if (typeof parsed.result === 'string' && parsed.result.trim()) return parsed.result
    }
    return ''
  }, [eventRows])

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

  const finalOutcomeArtifacts = useMemo(() => {
    const completed = [...eventRows].reverse().find((e) => e.event_type === 'run.completed')
    const completedStepID = completed?.step_id || ''
    if (completedStepID && stepArtifactsByStepID[completedStepID]?.length) {
      return stepArtifactsByStepID[completedStepID]
    }
    if (displayArtifacts.length === 0) return []
    const imageArtifacts = displayArtifacts.filter((a) => a.mime_type.startsWith('image/'))
    if (imageArtifacts.length > 0) return imageArtifacts.slice(0, 3)
    return displayArtifacts.slice(0, 3)
  }, [eventRows, stepArtifactsByStepID, displayArtifacts])

  if (!id) return <EmptyState title="Missing run ID" body="Select a run from the runs list." />

  return (
    <div className="min-w-0 space-y-3.5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Session</p>
            <h1 className="truncate text-xl font-semibold text-slate-900">{runQ.data?.task || 'Session Detail'}</h1>
            <p className="font-mono text-xs text-slate-500">{id}</p>
            <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs text-slate-600">
              {sessionLifecycle.stopReason ? <span>Stop reason: <span className="font-medium text-slate-700">{sessionLifecycle.stopReason}</span></span> : null}
            </div>
          </div>
          {runQ.data ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={runQ.data.status || 'unknown'} />
              {(runQ.data.provider || runQ.data.model) ? <MetaChip label="Provider" value={`${runQ.data.provider || ''}${runQ.data.provider && runQ.data.model ? ':' : ''}${runQ.data.model || ''}`} /> : null}
              <div className="inline-flex overflow-hidden rounded-md border border-slate-200 bg-white text-xs text-slate-700">
                <span className="inline-flex items-center gap-1 border-r border-slate-200 px-2.5 py-1">
                  <span className="text-slate-500">Duration</span>
                  <span className="font-medium text-slate-900">{metrics.elapsedLabel}</span>
                </span>
                <span className="inline-flex items-center gap-1 border-r border-slate-200 px-2.5 py-1">
                  <span className="text-slate-500">Steps</span>
                  <span className="font-medium text-slate-900">{metrics.stepCount}</span>
                </span>
                <span className="inline-flex items-center gap-1 border-r border-slate-200 px-2.5 py-1">
                  <span className="text-slate-500">Tokens</span>
                  <span className="font-medium text-slate-900">{metrics.inTokens + metrics.outTokens}</span>
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-1">
                  <span className="text-slate-500">Artifacts</span>
                  <span className="font-medium text-slate-900">{displayArtifacts.length}</span>
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      {finalResult ? (
        <Card>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">Run Outcome</p>
              <FinalResultBody value={finalResult} />
              {finalOutcomeArtifacts.length > 0 ? (
                <div className="mt-2 space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">Output Artifacts</p>
                  {finalOutcomeArtifacts.map((artifact) => (
                    <StepArtifactCard key={artifact.id} runID={id} artifact={artifact} />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        {runQ.data?.error ? <p className="mb-3 rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">{runQ.data.error}</p> : null}

        <div className="flex flex-wrap gap-2">
          <button onClick={() => interrupt.mutate()} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"><PauseCircle className="h-3.5 w-3.5" />Interrupt</button>
          <button onClick={() => resume.mutate()} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"><Play className="h-3.5 w-3.5" />Resume</button>
          <button onClick={() => approve.mutate()} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"><ShieldCheck className="h-3.5 w-3.5" />Approve</button>
          <button onClick={() => restart.mutate()} disabled={!runQ.data || restart.isPending} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />Restart run</button>
          <button onClick={() => qc.invalidateQueries({ queryKey: ['telemetry', id] })} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
          <a href={`/api/runs/${id}/export`} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50">Export bundle</a>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            type="text"
            value={steerText}
            onChange={(e) => setSteerText(e.target.value)}
            placeholder="Steer the session with additional operator instructions..."
            className="h-9 rounded-md border border-slate-300 px-3 text-sm"
          />
          <button
            disabled={!steerText || steer.isPending}
            onClick={() => steer.mutate()}
            className="h-9 rounded-md bg-indigo-600 px-3 text-xs font-medium text-white disabled:opacity-50"
          >
            Send steer event
          </button>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold tracking-tight">Session Timeline</h3>
        </div>
        {!timeline ? (
          <EmptyState title="No timeline data yet" body="Timeline appears as trace spans are emitted." />
        ) : (
          <div className="space-y-1.5">
            <div className="rounded border border-slate-200 bg-slate-50/70 p-2">
              <div className="space-y-2">
                {timeline.lanes
                  .filter((lane) => lane.spans.length > 0)
                  .sort((a, b) => b.spans.length - a.spans.length)
                  .map((lane) => (
                    <div key={lane.id} className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-2">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{lane.label}</div>
                      <div className="relative h-6 overflow-hidden rounded border border-slate-200 bg-white">
                        {lane.spans.map((span) => {
                          const start = ((span.__start - timeline.min) / timeline.total) * 100
                          const width = Math.max(0.6, (((span.__end || span.__start) - span.__start) / timeline.total) * 100)
                          const tone = laneMeta[lane.id].barTone
                          return (
                            <button
                              key={span.id}
                              className={`absolute top-1 h-4 rounded-[3px] px-1 text-left text-[9px] font-medium text-white ${tone}`}
                              style={{ left: `${start}%`, width: `${width}%` }}
                              onClick={() => setSelectedSpan(span)}
                              title={`${span.name} (${span.status})`}
                            >
                              <span className="block truncate leading-4">{span.name}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <div className="sticky top-0 z-10 -mx-1 mb-3 flex flex-wrap items-center justify-between gap-2 bg-white px-1 py-1">
          <div className="inline-flex rounded-md border border-slate-300 bg-white p-1">
            <TabButton active={activeTab === 'transcript'} onClick={() => setActiveTab('transcript')} icon={<PlayCircle className="h-4 w-4" />} label="Transcript" />
            <TabButton active={activeTab === 'debug'} onClick={() => setActiveTab('debug')} icon={<Layers className="h-4 w-4" />} label="Debug" />
            <TabButton active={activeTab === 'events'} onClick={() => setActiveTab('events')} icon={<Clock3 className="h-4 w-4" />} label="All events" />
          </div>
          <div className="flex items-center gap-2 rounded-md border border-slate-300 px-2 py-1">
            <Filter className="h-4 w-4 text-slate-500" />
            <input value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder="Filter transcript/events..." className="w-56 border-none bg-transparent text-sm outline-none" />
          </div>
        </div>

        {activeTab === 'transcript' ? (
          <TranscriptTab
            runID={id}
            rows={filteredEvents}
            runStartMs={runStartMs}
            stepIndexByID={stepIndexByID}
            stepArtifactsByStepID={stepArtifactsByStepID}
            replayPending={replay.isPending}
            onReplayFromStep={(step) => replay.mutate({ resumeFromStep: step })}
          />
        ) : null}

        {activeTab === 'debug' ? (
          <DebugTab
            telemetry={telemetry}
            selectedSpan={selectedSpan}
            onSelectSpan={setSelectedSpan}
            selectedToolCallID={selectedToolCallID}
            onSelectToolCall={setSelectedToolCallID}
            selectedToolCall={selectedToolCall}
          />
        ) : null}

        {activeTab === 'events' ? (
          <EventsTab rows={filteredEvents} />
        ) : null}
      </Card>
    </div>
  )
}

function TranscriptTab({
  runID,
  rows,
  runStartMs,
  stepIndexByID,
  stepArtifactsByStepID,
  replayPending,
  onReplayFromStep,
}: {
  runID: string
  rows: EventRow[]
  runStartMs: number
  stepIndexByID: Record<string, number>
  stepArtifactsByStepID: Record<string, DisplayArtifact[]>
  replayPending: boolean
  onReplayFromStep: (step: number) => void
}) {
  const [expandedRowID, setExpandedRowID] = useState('')
  if (rows.length === 0) return <EmptyState title="No transcript events" body="Events appear while the session runs." />

  return (
    <div className="max-h-[560px] space-y-1 overflow-auto pr-1">
      {rows.map((row) => {
        const expanded = expandedRowID === row.id
        const role = laneMeta[row.actor]
        const line = transcriptLine(row)
        const relativeSince = Number.isFinite(runStartMs) ? formatRelativeSince(runStartMs, row.created_at) : ''
        const rowArtifacts = stepArtifactsByStepID[row.step_id] ?? []
        const metaItems: ReactNode[] = []
        if (row.duration_ms) metaItems.push(<span key="duration">{formatDuration(row.duration_ms)}</span>)
        if (row.usage_label) metaItems.push(<span key="usage">{row.usage_label}</span>)
        if (relativeSince) metaItems.push(<span key="relative">{relativeSince}</span>)
        return (
          <div key={row.id} className="rounded-md border border-slate-200 bg-white">
            <button
              className="w-full px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
              onClick={() => setExpandedRowID(expanded ? '' : row.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-0.5 flex items-center gap-1.5">
                    <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${role.tone}`}>{role.label}</span>
                    <span className="text-[11px] font-medium text-slate-400">#{row.seq}</span>
                    <span className="truncate text-[12px] font-semibold leading-4 text-slate-800">{line.title}</span>
                  </div>
                  <p className="line-clamp-2 break-all text-[12px] leading-4 text-slate-600">{line.subtitle}</p>
                </div>
                <div className="shrink-0">
                  <div className="flex items-center gap-1 text-[11px] text-slate-500">
                    {metaItems.map((item, idx) => (
                      <span key={`meta-${idx}`} className="inline-flex items-center gap-1">
                        {idx > 0 ? <span className="text-slate-400">•</span> : null}
                        {item}
                      </span>
                    ))}
                    {stepIndexByID[row.step_id] && metaItems.length > 0 ? <span className="text-slate-400">•</span> : null}
                    {stepIndexByID[row.step_id] ? (
                      <button
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          onReplayFromStep(stepIndexByID[row.step_id])
                        }}
                        disabled={replayPending}
                        className="inline-flex items-center gap-0.5 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        title={`Restart from step ${stepIndexByID[row.step_id]}`}
                      >
                        <RotateCcw className="h-2.5 w-2.5" />
                        Restart here
                      </button>
                    ) : null}
                    <ChevronDown className={`ml-1 h-3.5 w-3.5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                  </div>
                </div>
              </div>
            </button>
            {expanded ? (
              <div className="space-y-3 border-t border-slate-200 bg-slate-50/60 px-3 py-3">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-700">Inspector</p>
                  <p className="text-[11px] text-slate-500">{humanizeEventType(row.event_type)} • {new Date(row.created_at).toLocaleString()}</p>
                  <pre className="max-h-64 overflow-auto rounded-md bg-slate-900 p-2 font-mono text-[11px] text-slate-100">{JSON.stringify(row.parsed, null, 2)}</pre>
                </div>
                <StepArtifacts runID={runID} artifacts={rowArtifacts} />
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function DebugTab({
  telemetry,
  selectedSpan,
  onSelectSpan,
  selectedToolCallID,
  onSelectToolCall,
  selectedToolCall,
}: {
  telemetry: RunTelemetry | undefined
  selectedSpan: TraceSpan | null
  onSelectSpan: (span: TraceSpan) => void
  selectedToolCallID: string
  onSelectToolCall: (id: string) => void
  selectedToolCall: ToolCall | null
}) {
  const spans = telemetry?.spans ?? []
  const toolCalls = telemetry?.tool_calls ?? []

  if (!telemetry) return <p className="text-sm text-slate-600">Loading debug data...</p>

  return (
    <>
      <div className="grid gap-3 xl:grid-cols-[1fr_1fr]">
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Trace Spans</h4>
        <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
          {spans.length === 0 ? <EmptyState title="No spans" body="Span records will appear here." /> : spans.map((span) => (
            <button key={span.id} onClick={() => onSelectSpan(span)} className="w-full rounded border border-slate-200 p-2 text-left hover:border-indigo-200">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{span.name}</span>
                <span className="text-slate-500">{span.status}</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{span.kind} • {formatSpanDuration(span.started_at, span.ended_at)}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Tool Calls</h4>
        <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
          {toolCalls.length === 0 ? <EmptyState title="No tool calls" body="Tool calls appear during execution." /> : toolCalls.map((tc) => (
            <button
              key={tc.id}
              onClick={() => onSelectToolCall(tc.id)}
              className={`w-full rounded border p-2 text-left text-xs ${selectedToolCallID === tc.id ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-200 hover:border-indigo-200'}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{tc.tool_name}</span>
                <StatusBadge status={tc.status} />
              </div>
              <p className="mt-1 text-slate-500">{formatSpanDuration(tc.started_at, tc.ended_at)}</p>
            </button>
          ))}
        </div>

        {selectedSpan ? (
          <div className="rounded border border-indigo-200 bg-indigo-50/40 p-2 text-xs">
            <p className="font-medium">Selected Span: {selectedSpan.name}</p>
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-900 p-2 font-mono text-[11px] text-slate-100">{prettyJSON(selectedSpan.attrs_json)}</pre>
          </div>
        ) : null}
      </div>
      </div>
      {selectedToolCall ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h5 className="text-sm font-semibold">Tool execution detail</h5>
            <div className="flex items-center gap-2">
              <button className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px]" onClick={() => navigator.clipboard.writeText(selectedToolCall.input_json || '')}>Copy input</button>
              <button className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px]" onClick={() => navigator.clipboard.writeText(selectedToolCall.output_json || '')}>Copy output</button>
            </div>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">Request</p>
              <pre className="max-h-44 overflow-auto rounded bg-slate-900 p-2 font-mono text-[11px] text-slate-100">{prettyMaybeJSON(selectedToolCall.input_json)}</pre>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">Response</p>
              <pre className="max-h-44 overflow-auto rounded bg-slate-900 p-2 font-mono text-[11px] text-slate-100">{prettyMaybeJSON(selectedToolCall.output_json)}</pre>
            </div>
          </div>
          {(selectedToolCall.error_message || selectedToolCall.error_class) ? (
            <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
              [{selectedToolCall.error_class || 'error'}] {selectedToolCall.error_message || 'unknown error'}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

function EventsTab({ rows }: { rows: EventRow[] }) {
  if (rows.length === 0) return <EmptyState title="No events" body="No events match your current filter." />
  return (
    <div className="max-h-[540px] overflow-auto">
      <table className="w-full table-fixed text-left text-xs">
        <thead className="sticky top-0 bg-white">
          <tr className="border-b border-slate-200 text-slate-500">
            <th className="py-2">Seq</th>
            <th className="py-2">Type</th>
            <th className="py-2">Time</th>
            <th className="py-2">Summary</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100">
              <td className="w-12 py-2">{row.seq}</td>
              <td className="w-44 truncate py-2 font-medium">{row.event_type}</td>
              <td className="w-24 py-2 text-slate-600">{new Date(row.created_at).toLocaleTimeString()}</td>
              <td className="truncate py-2 text-slate-700">{summarizeEvent(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StepArtifacts({ runID, artifacts }: { runID: string; artifacts: DisplayArtifact[] }) {
  if (artifacts.length === 0) return <p className="text-[11px] text-slate-500">No artifacts for this step.</p>
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-700">Artifacts ({artifacts.length})</p>
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
    <div className="rounded border border-slate-200 bg-white p-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{artifact.kind}</p>
        <div className="flex items-center gap-1">
          {hasInlineLog ? (
            <button
              className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-xs"
              onClick={() => navigator.clipboard.writeText(String(artifact._inline_log || ''))}
            >
              <Copy className="h-3 w-3" />
              Copy log
            </button>
          ) : (
            <>
              <button className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-xs" onClick={() => navigator.clipboard.writeText(artifact.path)}>
                <Copy className="h-3 w-3" />
                Copy path
              </button>
              <a href={contentURL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50">
                <ExternalLink className="h-3 w-3" />
                Open
              </a>
            </>
          )}
        </div>
      </div>
      <p className="break-all font-mono text-[11px] text-slate-600">{artifact.path}</p>
      <p className="text-[11px] text-slate-500">{(artifact.size_bytes / 1024).toFixed(1)} KB</p>
      {hasInlineLog ? (
        <pre className="mt-2 max-h-36 overflow-auto rounded bg-slate-900 p-2 font-mono text-[11px] text-slate-100">{String(artifact._inline_log)}</pre>
      ) : null}
      {isImage ? (
        <a href={contentURL} target="_blank" rel="noreferrer" className="mt-2 block rounded border border-slate-200 bg-slate-50 p-1">
          <img src={contentURL} alt={artifact.kind} className="max-h-72 w-full rounded object-contain" loading="lazy" />
        </a>
      ) : null}
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition ${active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'}`}
    >
      {icon}
      {label}
    </button>
  )
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </span>
  )
}

function FinalResultBody({ value }: { value: string }) {
  const normalized = value.trim()
  if (!normalized) return null

  if (shouldRenderFinalResultAsPre(normalized)) {
    return (
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-2 text-sm leading-5 text-slate-800">
        {prettifyFinalResult(normalized)}
      </pre>
    )
  }

  return <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-slate-800">{normalized}</p>
}

function shouldRenderFinalResultAsPre(value: string) {
  if (value.includes('\n')) return true
  if (value.includes('```')) return true
  if (/^\s*[{[]/.test(value)) return true
  if (/^\s{2,}\S/m.test(value)) return true
  if (/^\s*[-*]\s+/m.test(value)) return true
  if (/^\s*\d+\.\s+/m.test(value)) return true
  return isDashSeparatedKeyValueSummary(value)
}

function prettifyFinalResult(value: string) {
  if (!isDashSeparatedKeyValueSummary(value)) return value
  return value
    .split(/\s-\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n')
}

function isDashSeparatedKeyValueSummary(value: string) {
  if (value.includes('\n')) return false
  const parts = value.split(/\s-\s+/).map((part) => part.trim()).filter(Boolean)
  if (parts.length < 3) return false
  const labeled = parts.filter((part) => /^[A-Za-z0-9_ /().]+:\s+.+$/.test(part))
  return labeled.length >= 3
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
      return { title: 'Session queued', subtitle: readable || 'Run is queued and waiting for execution.' }
    case 'run.started':
      return { title: 'Session started', subtitle: readable || 'Agent runtime has started.' }
    case 'run.completed':
      return { title: 'Session completed', subtitle: readable || 'Run completed successfully.' }
    case 'run.failed':
      return { title: 'Session failed', subtitle: readable || 'Run ended with an error.' }
    case 'model.response':
      return { title: 'Agent response', subtitle: readable || 'Model generated a response.' }
    case 'tool.result':
      return { title: 'Tool execution', subtitle: readable || 'Tool completed.' }
    case 'approval.requested':
      return { title: 'Approval requested', subtitle: readable || 'Operator approval is required.' }
    case 'approval.approved':
      return { title: 'Approval granted', subtitle: readable || 'Operator approved and run resumed.' }
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

function humanizeEventType(value: string) {
  if (!value) return 'Event'
  return value.replace(/[._]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

function truncateText(value: string, max = 180) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact
}

function usageLabelFromPayload(payload: Record<string, unknown> | string) {
  if (typeof payload !== 'object' || payload === null) return ''
  const usage = payload.usage
  if (!usage || typeof usage !== 'object') return ''
  const rec = usage as Record<string, unknown>
  const inTokens = Number(rec.input_tokens || 0)
  const outTokens = Number(rec.output_tokens || 0)
  if (inTokens === 0 && outTokens === 0) return ''
  return `${inTokens} tok in / ${outTokens} tok out`
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

function toolLabel(name: string) {
  return name.replace(/\./g, ' ').trim()
}

function detectStopReason(status: string, rows: EventRow[]) {
  if (status === 'completed') return 'end_turn'
  if (status === 'cancelled') return 'cancelled'
  const latest = [...rows].reverse().find((row) => row.event_type === 'run.failed' || row.event_type === 'approval.requested')
  if (!latest || typeof latest.parsed !== 'object' || latest.parsed === null) return ''
  const payload = latest.parsed as Record<string, unknown>
  if (typeof payload.reason === 'string' && payload.reason) return payload.reason
  if (typeof payload.error === 'string' && payload.error) return payload.error
  if (latest.event_type === 'approval.requested') return 'approval_required'
  return ''
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

function prettyJSON(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function prettyMaybeJSON(value?: string) {
  if (!value) return '{}'
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
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

function formatSpanDuration(start?: string, end?: string) {
  const s = parseTimeMs(start)
  const e = parseTimeMs(end)
  if (!Number.isFinite(s)) return '-'
  if (!Number.isFinite(e)) return 'running'
  return formatDuration(e - s)
}

function formatRelativeSince(runStartMs: number, eventTime: string) {
  const eventMs = parseTimeMs(eventTime)
  if (!Number.isFinite(runStartMs) || !Number.isFinite(eventMs)) return ''
  const delta = Math.max(0, eventMs - runStartMs)
  return formatDuration(delta)
}
