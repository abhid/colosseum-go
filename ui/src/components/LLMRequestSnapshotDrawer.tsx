import { useMemo, useState } from 'react'
import { IconCopy, IconCheck } from '@tabler/icons-react'

import { parseJSONStringRecord, prettyJSON } from '../lib/time'
import { useRunEventStream } from '../lib/useRunEventStream'
import type { LLMRequestSnapshot } from '../lib/types'
import { Drawer } from './ui/Drawer'
import { Chip } from './ui/Chip'
import { LoadingState } from './Common'
import { FOCUS_RING } from '../lib/tokens'

type Props = {
  runID: string
  stepID?: string
  open: boolean
  onClose: () => void
}

const MAX_TOOL_PILLS = 10

export function LLMRequestSnapshotDrawer({ runID, stepID, open, onClose }: Props) {
  const { telemetry, isLoading } = useRunEventStream(runID, { subscribeSSE: open })

  const snapshot = useMemo(() => {
    const steps = telemetry?.steps ?? []
    const modelSteps = steps.filter((s) => s.step_type === 'model')
    const chosen = stepID
      ? modelSteps.find((s) => s.id === stepID) ?? nearestModelStepBefore(modelSteps, steps, stepID)
      : modelSteps[modelSteps.length - 1]
    if (!chosen) return null
    const request = (parseJSONStringRecord(chosen.input_json) ?? {}) as LLMRequestSnapshot
    const output = parseJSONStringRecord(chosen.output_json) ?? {}
    const usage = output.usage && typeof output.usage === 'object' ? (output.usage as Record<string, unknown>) : null
    return {
      stepID: chosen.id,
      idx: chosen.idx,
      model: String(request.model || '-'),
      systemPrompt: String(request.system_prompt || ''),
      systemPromptLen: Number(request.system_prompt_len || 0),
      messageCount: Number(request.message_count || 0),
      toolCount: Number(request.tool_count || 0),
      toolNames: Array.isArray(request.tool_names) ? request.tool_names.filter(Boolean) : [],
      roleCounts: request.message_role_counts && typeof request.message_role_counts === 'object'
        ? (request.message_role_counts as Record<string, number>)
        : {},
      messages: Array.isArray(request.messages) ? request.messages : [],
      inputTokens: Number((usage?.input_tokens as number) || 0),
      outputTokens: Number((usage?.output_tokens as number) || 0),
      rawRequest: chosen.input_json || '',
      rawResponse: chosen.output_json || '',
    }
  }, [telemetry, stepID])

  const title = snapshot
    ? `Step ${snapshot.idx} · ${snapshot.model}`
    : isLoading
      ? 'Loading…'
      : 'No model step yet'

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Model request"
      title={title}
      widthClass="max-w-2xl"
    >
      <div className="flex-1 px-4 py-4">
        {isLoading && !snapshot ? (
          <LoadingState label="Loading model request…" />
        ) : !snapshot ? (
          <p className="text-sm text-gray-500">This run hasn't sent a model request yet.</p>
        ) : (
          <div className="space-y-5 text-sm">
            <StatsRow snapshot={snapshot} />
            <Section title="System prompt">
              {snapshot.systemPrompt ? (
                <div className="relative">
                  <CopyButton value={snapshot.systemPrompt} ariaLabel="Copy system prompt" />
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-2 pr-10 font-mono text-[11px] text-gray-800">
                    {snapshot.systemPrompt}
                  </pre>
                </div>
              ) : (
                <p className="text-xs text-gray-500">No system prompt recorded.</p>
              )}
              <p className="mt-1 text-[10px] text-gray-500">{snapshot.systemPromptLen} chars</p>
            </Section>
            <Section title={`Messages (${snapshot.messages.length} shown of ${snapshot.messageCount})`}>
              {snapshot.messages.length === 0 ? (
                <p className="text-xs text-gray-500">No message previews available.</p>
              ) : (
                <ol className="space-y-2">
                  {snapshot.messages.map((msg, idx) => (
                    <li key={idx} className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-medium text-gray-800">
                          {msg.role || 'unknown'}
                          {msg.name ? ` · ${msg.name}` : ''}
                        </span>
                        <span className="font-mono text-[10px] text-gray-500">
                          {msg.content_length ? `${msg.content_length} chars` : ''}
                          {msg.content_parts ? ` · ${msg.content_parts} parts` : ''}
                        </span>
                      </div>
                      {msg.content_preview ? (
                        <p className="mt-1 whitespace-pre-wrap break-words text-[11px] text-gray-700">{msg.content_preview}</p>
                      ) : null}
                      {msg.content_part_preview && msg.content_part_preview.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 text-[10px] text-gray-500">
                          {msg.content_part_preview.map((part, pIdx) => (
                            <li key={pIdx} className="truncate">• {part}</li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </Section>
            <Section title={`Tools enabled (${snapshot.toolCount})`}>
              {snapshot.toolNames.length === 0 ? (
                <p className="text-xs text-gray-500">No tools attached to this request.</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {snapshot.toolNames.slice(0, MAX_TOOL_PILLS).map((name) => (
                    <Chip key={name} className="font-mono">{name}</Chip>
                  ))}
                  {snapshot.toolNames.length > MAX_TOOL_PILLS ? (
                    <Chip>+{snapshot.toolNames.length - MAX_TOOL_PILLS} more</Chip>
                  ) : null}
                </div>
              )}
            </Section>
            <details>
              <summary className={`cursor-pointer rounded text-xs font-medium text-gray-600 hover:text-gray-900 ${FOCUS_RING}`}>
                Raw request / response JSON
              </summary>
              <div className="mt-2 grid gap-2 lg:grid-cols-2">
                <div className="relative">
                  <CopyButton value={prettyJSON(snapshot.rawRequest)} ariaLabel="Copy raw request" light />
                  <pre className="max-h-64 overflow-auto rounded bg-gray-900 p-2 pr-10 font-mono text-[11px] text-gray-100">
                    {prettyJSON(snapshot.rawRequest)}
                  </pre>
                </div>
                <div className="relative">
                  <CopyButton value={prettyJSON(snapshot.rawResponse)} ariaLabel="Copy raw response" light />
                  <pre className="max-h-64 overflow-auto rounded bg-gray-900 p-2 pr-10 font-mono text-[11px] text-gray-100">
                    {prettyJSON(snapshot.rawResponse)}
                  </pre>
                </div>
              </div>
            </details>
          </div>
        )}
      </div>
    </Drawer>
  )
}

function CopyButton({ value, ariaLabel, light = false }: { value: string; ariaLabel: string; light?: boolean }) {
  const [copied, setCopied] = useState(false)
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // ignore
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`absolute right-1.5 top-1.5 rounded-md p-1 transition-colors ${
        light
          ? 'bg-gray-800/60 text-gray-200 hover:bg-gray-700 hover:text-white'
          : 'bg-white/80 text-gray-500 hover:bg-white hover:text-gray-700'
      } ${FOCUS_RING}`}
    >
      {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
    </button>
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

function StatsRow({ snapshot }: { snapshot: { messageCount: number; toolCount: number; systemPromptLen: number; inputTokens: number; outputTokens: number; roleCounts: Record<string, number> } }) {
  const pills: Array<{ label: string; value: string | number }> = [
    { label: 'messages', value: snapshot.messageCount },
    { label: 'tools', value: snapshot.toolCount },
    { label: 'system chars', value: snapshot.systemPromptLen },
    { label: 'user msgs', value: Number(snapshot.roleCounts.user || 0) },
    { label: 'assistant', value: Number(snapshot.roleCounts.assistant || 0) },
    { label: 'tool msgs', value: Number(snapshot.roleCounts.tool || 0) },
  ]
  if (snapshot.inputTokens > 0 || snapshot.outputTokens > 0) {
    pills.push({ label: 'in tokens', value: snapshot.inputTokens })
    pills.push({ label: 'out tokens', value: snapshot.outputTokens })
  }
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

function nearestModelStepBefore<T extends { id: string; idx: number }>(
  modelSteps: T[],
  allSteps: T[],
  stepID: string,
): T | undefined {
  if (modelSteps.length === 0) return undefined
  const anchor = allSteps.find((s) => s.id === stepID)
  if (!anchor) return modelSteps[modelSteps.length - 1]
  const before = modelSteps.filter((s) => s.idx <= anchor.idx)
  return before.length > 0 ? before[before.length - 1] : modelSteps[modelSteps.length - 1]
}
