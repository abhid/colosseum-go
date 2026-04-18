import { useEffect, useMemo } from 'react'
import { IconX } from '@tabler/icons-react'

import { tryParseJSON } from '../lib/time'
import { useRunEventStream } from '../lib/useRunEventStream'

type Props = {
  runID: string
  onClose: () => void
}

type PackedPayload = {
  session_id?: string
  turn_index?: number
  summary_count?: number
  workspace_entries?: number
  session_artifacts?: number
  prior_exchange_len?: number
  primer_chars?: number
  primer?: string
  summaries?: Array<{ run_id?: string; turn_index?: number; summary?: string }>
  manifest?: Array<{ path?: string; is_dir?: boolean }>
  artifacts?: Array<{ id?: string; kind?: string; mime?: string; path?: string; workspace_path?: string }>
}

export function SessionContextInspector({ runID, onClose }: Props) {
  const { telemetry, isLoading } = useRunEventStream(runID, { subscribeSSE: true })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const packed = useMemo<PackedPayload | null>(() => {
    const events = telemetry?.events ?? []
    const contextPacked = [...events].reverse().find((ev) => ev.event_type === 'session.context_packed')
    if (!contextPacked) return null
    const parsed = tryParseJSON(contextPacked.payload_json || '')
    return typeof parsed === 'object' && parsed !== null ? (parsed as PackedPayload) : null
  }, [telemetry?.events])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-2xl flex-col overflow-hidden bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Session context</p>
            <p className="truncate text-sm font-semibold text-gray-900">
              What the agent saw on the latest turn
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close session context inspector"
          >
            <IconX size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isLoading && !packed ? (
            <p className="text-sm text-gray-500">Loading context...</p>
          ) : !packed ? (
            <div className="rounded border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-600">
              <p className="font-medium text-gray-700">No packed context yet.</p>
              <p className="mt-1">
                The session context packer emits a <code className="rounded bg-gray-100 px-1 text-[10px]">session.context_packed</code> event once the next turn starts. Come back after sending another message.
              </p>
            </div>
          ) : (
            <div className="space-y-5 text-sm">
              <StatsRow packed={packed} />
              <Section title="Session primer">
                {packed.primer ? (
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-2 font-mono text-[11px] text-gray-800">
                    {packed.primer}
                  </pre>
                ) : (
                  <p className="text-xs text-gray-500">No primer body in this event. Backend may not yet emit the full primer.</p>
                )}
              </Section>
              <Section title={`Prior turns (${packed.summaries?.length ?? 0})`}>
                {(packed.summaries?.length ?? 0) === 0 ? (
                  <p className="text-xs text-gray-500">No prior-turn summaries available.</p>
                ) : (
                  <ol className="space-y-1.5">
                    {(packed.summaries ?? []).map((s, idx) => (
                      <li key={`${s.run_id ?? idx}`} className="rounded border border-gray-200 bg-gray-50 p-2">
                        <p className="text-[11px] font-medium text-gray-700">Turn {s.turn_index ?? '-'}</p>
                        {s.summary ? (
                          <p className="mt-0.5 text-[11px] text-gray-600">{s.summary}</p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </Section>
              <Section title={`Workspace files (${packed.manifest?.length ?? 0})`}>
                {(packed.manifest?.length ?? 0) === 0 ? (
                  <p className="text-xs text-gray-500">No workspace files scanned.</p>
                ) : (
                  <ul className="grid grid-cols-1 gap-0.5 font-mono text-[11px] text-gray-700 sm:grid-cols-2">
                    {(packed.manifest ?? []).map((e) => (
                      <li key={e.path} className="truncate">
                        {e.is_dir ? `${e.path}/` : e.path}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section title={`Recallable artifacts (${packed.artifacts?.length ?? 0})`}>
                {(packed.artifacts?.length ?? 0) === 0 ? (
                  <p className="text-xs text-gray-500">
                    No prior-run artifacts in this session. Once the agent produces images or files, they appear here and can be pulled back into the conversation via <code className="rounded bg-gray-100 px-1 text-[10px]">recall_artifact</code>.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {(packed.artifacts ?? []).map((a) => (
                      <li key={a.id} className="rounded border border-gray-200 bg-gray-50 p-2 text-[11px] text-gray-700">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-gray-800">{a.workspace_path || a.path}</span>
                          <span className="shrink-0 text-[10px] text-gray-500">{a.kind} · {a.mime}</span>
                        </div>
                        {a.id ? <p className="mt-0.5 font-mono text-[10px] text-gray-500">id={a.id}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</p>
      {children}
    </div>
  )
}

function StatsRow({ packed }: { packed: PackedPayload }) {
  const pills: Array<{ label: string; value: string | number }> = [
    { label: 'turn', value: packed.turn_index ?? '-' },
    { label: 'summaries', value: packed.summary_count ?? 0 },
    { label: 'workspace', value: packed.workspace_entries ?? 0 },
    { label: 'artifacts', value: packed.session_artifacts ?? 0 },
    { label: 'primer chars', value: packed.primer_chars ?? 0 },
  ]
  return (
    <div className="flex flex-wrap gap-1.5">
      {pills.map((p) => (
        <span key={p.label} className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-700">
          <span className="font-mono text-gray-800">{p.value}</span> <span className="text-gray-500">{p.label}</span>
        </span>
      ))}
    </div>
  )
}
