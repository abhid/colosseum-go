import { useMemo, useState } from 'react'
import { IconChevronDown, IconCode } from '@tabler/icons-react'

import { formatDuration, parseTimeMs, prettyJSON } from '../lib/time'
import { useRunEventStream } from '../lib/useRunEventStream'
import type { ToolCall } from '../lib/types'
import { LLMRequestSnapshotDrawer } from './LLMRequestSnapshotDrawer'
import { FOCUS_RING } from '../lib/tokens'

type Props = {
  runID: string
  isLive?: boolean
}

type ToolCallRow = ToolCall & { durationMs: number; startedMs: number }

export function RunInlineTimeline({ runID, isLive = false }: Props) {
  const { telemetry } = useRunEventStream(runID, { subscribeSSE: isLive })
  const [expandedCallIDs, setExpandedCallIDs] = useState<Set<string>>(new Set())
  const [snapshotStepID, setSnapshotStepID] = useState<string | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)

  const rows = useMemo<ToolCallRow[]>(() => {
    const calls = telemetry?.tool_calls ?? []
    const enriched = calls.map((call) => {
      const startedMs = parseTimeMs(call.started_at)
      const endedMs = parseTimeMs(call.ended_at)
      const durationMs = Number.isFinite(startedMs) && Number.isFinite(endedMs) && endedMs >= startedMs
        ? endedMs - startedMs
        : 0
      return { ...call, startedMs: Number.isFinite(startedMs) ? startedMs : 0, durationMs }
    })
    enriched.sort((a, b) => a.startedMs - b.startedMs)
    return enriched
  }, [telemetry?.tool_calls])

  if (rows.length === 0) {
    if (isLive) {
      return (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-gray-500">
          <IconCode size={12} className="text-gray-400" />
          <span>Waiting for tools…</span>
        </div>
      )
    }
    return null
  }

  const totalMs = rows.reduce((sum, row) => sum + row.durationMs, 0)
  const allDone = rows.every((row) => row.status === 'completed' || row.status === 'failed')
  const countLabel = `${rows.length} tool${rows.length === 1 ? '' : 's'}`
  const durationLabel = totalMs > 0 ? `${formatDuration(totalMs)}` : ''
  const stateLabel = allDone ? '' : 'running'

  const toggleRow = (id: string) => {
    setExpandedCallIDs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        <IconCode size={12} className="text-gray-400" />
        <span>Tool activity</span>
        <span className="text-gray-300">·</span>
        <span className="tabular-nums text-gray-600">{countLabel}</span>
        {durationLabel ? (
          <>
            <span className="text-gray-300">·</span>
            <span className="tabular-nums text-gray-600">{durationLabel}</span>
          </>
        ) : null}
        {stateLabel ? (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-gray-600">{stateLabel}</span>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => setSummaryOpen((v) => !v)}
          aria-expanded={summaryOpen}
          aria-label={summaryOpen ? 'Collapse tool activity' : 'Expand tool activity'}
          className={`ml-auto rounded p-0.5 text-gray-400 transition-colors hover:text-gray-700 ${FOCUS_RING}`}
        >
          <IconChevronDown size={12} className={`transition-transform ${summaryOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {summaryOpen ? (
        <div className="space-y-1.5">
          {rows.map((row) => {
            const expanded = expandedCallIDs.has(row.id)
            const status = row.status || 'pending'
            const badge = statusBadgeClass(status)
            return (
              <div
                key={row.id}
                className={`rounded-md border text-xs transition-colors ${expanded ? 'border-gray-300 bg-white' : 'border-gray-200 bg-gray-50 hover:bg-white'}`}
              >
                <button
                  type="button"
                  onClick={() => toggleRow(row.id)}
                  aria-expanded={expanded}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left ${FOCUS_RING}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badge}`}>
                      {status}
                    </span>
                    <span className="truncate font-mono text-[11px] text-gray-800">{row.tool_name || 'tool'}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-[10px] text-gray-500">
                    {row.durationMs > 0 ? <span className="font-mono">{formatDuration(row.durationMs)}</span> : null}
                    <IconChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
                  </span>
                </button>
                {expanded ? (
                  <div className="space-y-2 border-t border-gray-200 bg-white px-2 py-2">
                    {row.error_message ? (
                      <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
                        {row.error_class ? <span className="font-medium">{row.error_class}:</span> : null} {row.error_message}
                      </div>
                    ) : null}
                    <CodeBlock label="Input" content={prettyJSON(row.input_json || '')} />
                    <details>
                      <summary className={`cursor-pointer rounded text-[10px] font-medium uppercase tracking-wide text-gray-500 hover:text-gray-800 ${FOCUS_RING}`}>
                        Show output
                      </summary>
                      <div className="mt-1">
                        <CodeBlock label="Output" content={prettyJSON(row.output_json || '')} />
                      </div>
                    </details>
                    {row.step_id ? (
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          setSnapshotStepID(row.step_id)
                        }}
                        className={`inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 ${FOCUS_RING}`}
                      >
                        View model request
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
      <LLMRequestSnapshotDrawer
        runID={runID}
        stepID={snapshotStepID ?? undefined}
        open={snapshotStepID !== null}
        onClose={() => setSnapshotStepID(null)}
      />
    </div>
  )
}

function statusBadgeClass(status: string): string {
  const normalized = status.toLowerCase()
  if (normalized === 'completed') return 'border-green-200 bg-green-50 text-green-700'
  if (normalized === 'failed' || normalized === 'error') return 'border-red-200 bg-red-50 text-red-700'
  if (normalized === 'cancelled') return 'border-gray-200 bg-gray-100 text-gray-600'
  return 'border-gray-200 bg-gray-100 text-gray-600'
}

function CodeBlock({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <pre className="max-h-48 overflow-auto rounded bg-gray-900 p-2 font-mono text-[11px] leading-snug text-gray-100">{content}</pre>
    </div>
  )
}
