import { useMemo } from 'react'

import { tryParseJSON } from '../lib/time'
import { useRunEventStream } from '../lib/useRunEventStream'
import { Drawer } from './ui/Drawer'
import { Chip } from './ui/Chip'
import { LoadingState } from './Common'

type Props = {
  runID: string
  open: boolean
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

export function SessionContextInspector({ runID, open, onClose }: Props) {
  const { telemetry, isLoading } = useRunEventStream(runID, { subscribeSSE: open })

  const packed = useMemo<PackedPayload | null>(() => {
    const events = telemetry?.events ?? []
    const contextPacked = events.findLast((ev) => ev.event_type === 'session.context_packed')
    if (!contextPacked) return null
    const parsed = tryParseJSON(contextPacked.payload_json || '')
    return typeof parsed === 'object' && parsed !== null ? (parsed as PackedPayload) : null
  }, [telemetry?.events])

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Session context"
      title="What the agent saw on the latest turn"
      widthClass="max-w-2xl"
    >
      <div className="flex-1 px-4 py-4">
        {isLoading && !packed ? (
          <LoadingState label="Loading context…" />
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
                    <li key={e.path} className="truncate" title={e.path}>
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
                  {(packed.artifacts ?? []).map((a) => {
                    const kind = a.kind || ''
                    const mime = a.mime || ''
                    const label = [kind, mime].filter(Boolean).join(' · ')
                    return (
                      <li key={a.id} className="rounded border border-gray-200 bg-gray-50 p-2 text-[11px] text-gray-700">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-gray-800" title={a.workspace_path || a.path}>
                            {a.workspace_path || a.path}
                          </span>
                          {label ? <span className="shrink-0 text-[10px] text-gray-500">{label}</span> : null}
                        </div>
                        {a.id ? <p className="mt-0.5 font-mono text-[10px] text-gray-500">id={a.id}</p> : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </Section>
          </div>
        )}
      </div>
    </Drawer>
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
        <Chip key={p.label}>
          <span className="font-mono text-gray-800">{p.value}</span>
          <span className="text-gray-500">{p.label}</span>
        </Chip>
      ))}
    </div>
  )
}
