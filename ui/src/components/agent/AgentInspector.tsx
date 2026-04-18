import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { IconCheck, IconCopy, IconChevronLeft, IconChevronRight } from '@tabler/icons-react'

import { FOCUS_RING } from '../../lib/tokens'
import type { AgentFormState, FieldDiff } from '../../lib/agentForm'
import { diffAgentForm, fieldLabel } from '../../lib/agentForm'

type ViewID = 'spec' | 'api' | 'diff'

export function AgentInspector({
  agentID,
  value,
  baseline,
  collapsed,
  onToggleCollapsed,
}: {
  agentID: string
  value: AgentFormState
  baseline: AgentFormState
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const [view, setView] = useState<ViewID>('spec')
  const [copied, setCopied] = useState(false)
  const diffs = useMemo(() => diffAgentForm(baseline, value), [baseline, value])
  const isDirty = diffs.length > 0
  const effectiveView: ViewID = view === 'diff' && !isDirty ? 'spec' : view

  const yaml = useMemo(() => renderYaml(value), [value])
  const curl = useMemo(() => renderCurl(agentID, value), [agentID, value])
  const copyTarget = effectiveView === 'spec' ? yaml : effectiveView === 'api' ? curl : ''

  const handleCopy = async () => {
    if (!copyTarget) return
    try {
      await navigator.clipboard.writeText(copyTarget)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // ignore
    }
  }

  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center border-l border-gray-200 bg-gray-50 pt-4">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className={clsx(
            'flex h-8 w-8 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900',
            FOCUS_RING,
          )}
          aria-label="Expand inspector"
        >
          <IconChevronLeft className="h-4 w-4" />
        </button>
        <div className="mt-5 -rotate-90 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          Inspector
        </div>
      </div>
    )
  }

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
        <SegmentedControl
          value={effectiveView}
          onChange={setView}
          items={[
            { id: 'spec', label: 'Spec' },
            { id: 'api', label: 'API' },
            { id: 'diff', label: isDirty ? `Diff (${diffs.length})` : 'Diff', disabled: !isDirty },
          ]}
        />
        <div className="flex items-center gap-1">
          {copyTarget ? (
            <button
              type="button"
              onClick={handleCopy}
              className={clsx(
                'flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-200',
                FOCUS_RING,
              )}
              aria-label="Copy"
            >
              {copied ? <IconCheck className="h-3.5 w-3.5 text-green-600" /> : <IconCopy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onToggleCollapsed}
            className={clsx(
              'flex h-7 w-7 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900',
              FOCUS_RING,
            )}
            aria-label="Collapse inspector"
          >
            <IconChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {effectiveView === 'spec' ? (
          <pre className="rounded-md bg-gray-900 p-3 font-mono text-[12px] leading-relaxed text-gray-100">{yaml}</pre>
        ) : null}
        {effectiveView === 'api' ? (
          <pre className="rounded-md bg-gray-900 p-3 font-mono text-[11px] leading-relaxed text-gray-100">{curl}</pre>
        ) : null}
        {effectiveView === 'diff' ? <DiffView diffs={diffs} /> : null}
      </div>
    </aside>
  )
}

function SegmentedControl({
  value,
  onChange,
  items,
}: {
  value: ViewID
  onChange: (next: ViewID) => void
  items: Array<{ id: ViewID; label: string; disabled?: boolean }>
}) {
  return (
    <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-[12px] shadow-sm">
      {items.map((item) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            disabled={item.disabled}
            onClick={() => !item.disabled && onChange(item.id)}
            className={clsx(
              'rounded px-2.5 py-1 font-medium transition-colors',
              FOCUS_RING,
              active
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100',
              item.disabled && 'opacity-40',
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

function DiffView({ diffs }: { diffs: FieldDiff[] }) {
  if (diffs.length === 0) {
    return <p className="px-1 text-xs text-gray-500">No unsaved changes.</p>
  }
  return (
    <ul className="space-y-3">
      {diffs.map((d) => (
        <li key={d.field} className="rounded-md border border-gray-200 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{fieldLabel(d.field)}</p>
          <div className="mt-1 overflow-hidden rounded border border-gray-200 text-[12px]">
            <div className="border-b border-gray-200 bg-red-50 px-2 py-1 font-mono text-red-800">
              <span className="mr-1 select-none text-red-400">−</span>
              {d.before || <span className="italic text-gray-400">(empty)</span>}
            </div>
            <div className="bg-green-50 px-2 py-1 font-mono text-green-800">
              <span className="mr-1 select-none text-green-500">+</span>
              {d.after || <span className="italic text-gray-400">(empty)</span>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function renderYaml(v: AgentFormState): string {
  const lines: string[] = []
  lines.push(`name: ${yamlEscape(v.name || 'unnamed-agent')}`)
  if (v.description) lines.push(`description: ${yamlEscape(v.description)}`)
  lines.push(`provider: ${yamlEscape(v.provider || 'provider')}`)
  lines.push(`model: ${yamlEscape(v.model || 'model')}`)
  lines.push(`planning_mode: ${v.planning_mode}`)
  lines.push('tools:')
  if (v.allowed_tools.length === 0) lines.push('  []')
  else for (const t of v.allowed_tools) lines.push(`  - ${yamlEscape(t)}`)
  if (v.system_prompt) {
    lines.push('system: |')
    for (const line of v.system_prompt.split('\n')) lines.push(`  ${line}`)
  } else {
    lines.push('system: ""')
  }
  lines.push('defaults:')
  if (v.default_task) lines.push(`  task: ${yamlEscape(v.default_task)}`)
  lines.push(`  max_steps: ${v.default_max_steps}`)
  if (v.default_workspace_path) lines.push(`  workspace_path: ${yamlEscape(v.default_workspace_path)}`)
  if (v.default_environment_id) lines.push(`  environment_id: ${yamlEscape(v.default_environment_id)}`)
  if (v.default_credential_vault_id) lines.push(`  credential_vault_id: ${yamlEscape(v.default_credential_vault_id)}`)
  if (v.output_contract_type && v.output_contract_type !== 'none') {
    lines.push('output_contract:')
    lines.push(`  type: ${v.output_contract_type}`)
    if (v.output_contract_payload) {
      lines.push('  payload: |')
      for (const line of v.output_contract_payload.split('\n')) lines.push(`    ${line}`)
    }
  }
  if (v.starter_prompts.length > 0) {
    lines.push('starter_prompts:')
    for (const p of v.starter_prompts) lines.push(`  - ${yamlEscape(p)}`)
  }
  return lines.join('\n')
}

function yamlEscape(s: string): string {
  if (!s) return '""'
  if (/[:\n"'#&*!|>%@`,{}[\]]/.test(s)) {
    return JSON.stringify(s)
  }
  return s
}

function renderCurl(agentID: string, v: AgentFormState): string {
  const body: Record<string, unknown> = {
    name: v.name,
    description: v.description,
    provider: v.provider,
    model: v.model,
    system_prompt: v.system_prompt,
    allowed_tools: v.allowed_tools,
    starter_prompts: v.starter_prompts,
    default_task: v.default_task,
    default_max_steps: v.default_max_steps,
    default_workspace_path: v.default_workspace_path,
    default_environment_id: v.default_environment_id,
    default_credential_vault_id: v.default_credential_vault_id,
    output_contract_type: v.output_contract_type,
    output_contract_payload: v.output_contract_payload,
    planning_mode: v.planning_mode,
  }
  return `curl -X PUT /api/agents/${agentID} \\
  -H "authorization: Bearer $TOKEN" \\
  -H "content-type: application/json" \\
  -d '${JSON.stringify(body, null, 2)}'`
}
