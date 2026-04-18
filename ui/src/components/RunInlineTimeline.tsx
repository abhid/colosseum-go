import { useMemo, useState } from 'react'
import { IconChevronDown, IconCode } from '@tabler/icons-react'

import { formatDuration, parseTimeMs, prettyJSON } from '../lib/time'
import { useRunEventStream } from '../lib/useRunEventStream'
import type { ToolCall } from '../lib/types'
import { LLMRequestSnapshotDrawer } from './LLMRequestSnapshotDrawer'

type Props = {
  runID: string
  isLive?: boolean
}

type ToolCallRow = ToolCall & { durationMs: number; startedMs: number }

export function RunInlineTimeline({ runID, isLive = false }: Props) {
  const { telemetry } = useRunEventStream(runID, { subscribeSSE: isLive })
  const [expandedCallID, setExpandedCallID] = useState('')
  const [snapshotStepID, setSnapshotStepID] = useState<string | null>(null)

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

  if (rows.length === 0) return null

  const totalMs = rows.reduce((sum, row) => sum + row.durationMs, 0)
  const allDone = rows.every((row) => row.status === 'completed' || row.status === 'failed')
  const summaryLabel = `${rows.length} tool${rows.length === 1 ? '' : 's'}${totalMs > 0 ? ` • ${formatDuration(totalMs)}` : ''}${allDone ? '' : ' • running'}`

  return (
    <div className="mt-2 border-t border-gray-200/70 pt-2">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] text-gray-500 hover:text-gray-700">
          <span className="inline-flex items-center gap-1.5 font-medium uppercase tracking-wide">
            <IconCode size={12} className="text-gray-400" />
            {summaryLabel}
          </span>
          <IconChevronDown size={12} className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-2 space-y-1.5">
          {rows.map((row) => {
            const expanded = expandedCallID === row.id
            const status = row.status || 'pending'
            const badge = statusBadgeClass(status)
            return (
              <div
                key={row.id}
                className={`rounded-md border text-xs transition-colors ${expanded ? 'border-gray-300 bg-white' : 'border-gray-200 bg-gray-50 hover:bg-white'}`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedCallID(expanded ? '' : row.id)}
                  className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left"
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
                  <div className="border-t border-gray-200 bg-white px-2 py-2 space-y-2">
                    {row.error_message ? (
                      <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
                        {row.error_class ? <span className="font-medium">{row.error_class}:</span> : null} {row.error_message}
                      </div>
                    ) : null}
                    <div className="grid gap-2 lg:grid-cols-2">
                      <CodeBlock label="Input" content={prettyJSON(row.input_json || '')} />
                      <CodeBlock label="Output" content={prettyJSON(row.output_json || '')} />
                    </div>
                    {row.step_id ? (
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          setSnapshotStepID(row.step_id)
                        }}
                        className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-600 shadow-sm hover:bg-gray-50"
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
      </details>
      {snapshotStepID ? (
        <LLMRequestSnapshotDrawer
          runID={runID}
          stepID={snapshotStepID}
          onClose={() => setSnapshotStepID(null)}
        />
      ) : null}
    </div>
  )
}

function statusBadgeClass(status: string): string {
  const normalized = status.toLowerCase()
  if (normalized === 'completed') return 'border-green-200 bg-green-50 text-green-700'
  if (normalized === 'failed' || normalized === 'error') return 'border-red-200 bg-red-50 text-red-700'
  if (normalized === 'cancelled') return 'border-gray-200 bg-gray-100 text-gray-600'
  return 'border-amber-200 bg-amber-50 text-amber-700'
}

function CodeBlock({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <pre className="max-h-48 overflow-auto rounded bg-gray-900 p-2 font-mono text-[10.5px] leading-snug text-gray-100">{content}</pre>
    </div>
  )
}
