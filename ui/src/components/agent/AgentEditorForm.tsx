import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { IconPlus, IconSparkles, IconX } from '@tabler/icons-react'
import clsx from 'clsx'

import { Button } from '../ui/Button'
import { ToolSelectorAccordion } from '../ToolSelectorAccordion'
import { ProviderModelCombobox } from '../ProviderModelCombobox'
import { ErrorBanner } from '../Common'
import { FOCUS_RING } from '../../lib/tokens'
import { api } from '../../lib/api'
import type { AgentFormState } from '../../lib/agentForm'
import type { PlanningMode } from '../../lib/types'
import { PlanningModeField } from './PlanningModeField'
import { OutputContractField } from './OutputContractField'

const INPUT_CLASSES = `h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm transition-colors focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 ${FOCUS_RING}`
const TEXTAREA_CLASSES = `w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm transition-colors focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 ${FOCUS_RING}`
const EYEBROW = 'text-[11px] font-semibold uppercase tracking-wide text-gray-500'

export type ToolOption = { name: string; description: string; isBuiltin: boolean }

type Props = {
  value: AgentFormState
  onChange: (next: AgentFormState) => void
  providerIDs: string[]
  providerModelSuggestions: string[]
  availableTools: ToolOption[]
  environments: Array<{ id: string; name: string }>
  credentialVaults: Array<{ id: string; name: string }>
  allBuiltinTools: string[]
}

export function AgentEditorForm({
  value,
  onChange,
  providerIDs,
  providerModelSuggestions,
  availableTools,
  environments,
  credentialVaults,
  allBuiltinTools,
}: Props) {
  const enhancePrompt = useMutation({
    mutationFn: () => api.enhanceSystemPrompt({ prompt: value.system_prompt, provider: value.provider, model: value.model }),
    onSuccess: (out) => onChange({ ...value, system_prompt: out.prompt }),
  })

  const providerModelValue = useMemo(() => {
    if (!value.provider && !value.model) return ''
    return `${providerDisplay(value.provider)}/${value.model}`
  }, [value.provider, value.model])

  const newBuiltins = useMemo(() => {
    const current = new Set(value.allowed_tools)
    return allBuiltinTools.filter((name) => !current.has(name))
  }, [allBuiltinTools, value.allowed_tools])

  return (
    <div className="space-y-8">
      <Section id="identity" title="Identity" hint="How humans recognize this agent.">
        <Field label="Name" htmlFor="agent-name">
          <input
            id="agent-name"
            className={INPUT_CLASSES}
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            placeholder="e.g. george"
          />
        </Field>
        <Field label="Description" htmlFor="agent-description">
          <input
            id="agent-description"
            className={INPUT_CLASSES}
            value={value.description}
            onChange={(e) => onChange({ ...value, description: e.target.value })}
            placeholder="One sentence describing what this agent is for."
          />
        </Field>
      </Section>

      <Section id="model" title="Model" hint="Provider, model, and how the agent plans.">
        <Field label="Provider / model" htmlFor="agent-provider-model">
          <ProviderModelCombobox
            value={providerModelValue}
            options={providerModelSuggestions}
            placeholder="OpenAI/gpt-5.4 or Anthropic/claude-3-5-sonnet-latest"
            onValueChange={(next) => {
              const parsed = parseProviderModel(next, providerIDs, value.provider || providerIDs[0] || '')
              onChange({ ...value, provider: parsed.provider, model: parsed.model })
            }}
          />
        </Field>
        <Field label="Planning mode">
          <PlanningModeField
            value={value.planning_mode}
            onChange={(mode: PlanningMode) => onChange({ ...value, planning_mode: mode })}
          />
        </Field>
      </Section>

      <Section id="behavior" title="Behavior" hint="The system prompt that anchors every turn.">
        <div className="relative">
          <textarea
            aria-label="System prompt"
            className={`${TEXTAREA_CLASSES} min-h-[180px] pr-28`}
            rows={autosizeRows(value.system_prompt)}
            value={value.system_prompt}
            onChange={(e) => onChange({ ...value, system_prompt: e.target.value })}
            placeholder="Tell the agent who it is and how it should behave."
          />
          <div className="absolute bottom-3 right-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={!value.provider || enhancePrompt.isPending}
              onClick={() => enhancePrompt.mutate()}
            >
              <IconSparkles className="mr-1 h-3.5 w-3.5" />
              {enhancePrompt.isPending ? 'Enhancing…' : 'AI Enhance'}
            </Button>
          </div>
        </div>
        <ErrorBanner
          className="mt-3"
          title="Couldn't enhance prompt"
          message={enhancePrompt.error ? (enhancePrompt.error as Error).message : undefined}
        />
      </Section>

      <Section
        id="tools"
        title="Tools"
        hint="Only the tools checked here are visible to the model at runtime."
        right={
          newBuiltins.length > 0 ? (
            <button
              type="button"
              className={clsx(
                'inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-100',
                FOCUS_RING,
              )}
              onClick={() => onChange({ ...value, allowed_tools: [...value.allowed_tools, ...newBuiltins] })}
            >
              <IconPlus className="h-3 w-3" />
              {newBuiltins.length} new builtins — add
            </button>
          ) : null
        }
      >
        <ToolSelectorAccordion
          title={`Allowed tools (${value.allowed_tools.length} selected)`}
          tools={availableTools}
          selected={value.allowed_tools}
          onChange={(next) => onChange({ ...value, allowed_tools: next })}
        />
      </Section>

      <Section id="defaults" title="Defaults" hint="Used when a run or chat session doesn't specify these explicitly.">
        <Field label="Default task" htmlFor="agent-default-task">
          <textarea
            id="agent-default-task"
            className={`${TEXTAREA_CLASSES} h-20`}
            value={value.default_task}
            onChange={(e) => onChange({ ...value, default_task: e.target.value })}
            placeholder="Seed task when a run is launched without one."
          />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Max steps" htmlFor="agent-max-steps">
            <input
              id="agent-max-steps"
              type="number"
              min={1}
              className={INPUT_CLASSES}
              value={value.default_max_steps}
              onChange={(e) => onChange({ ...value, default_max_steps: Number(e.target.value || 30) })}
            />
          </Field>
          <Field label="Workspace path" htmlFor="agent-workspace">
            <input
              id="agent-workspace"
              className={INPUT_CLASSES}
              value={value.default_workspace_path}
              onChange={(e) => onChange({ ...value, default_workspace_path: e.target.value })}
              placeholder="supports {{run_id}}"
            />
          </Field>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Environment" htmlFor="agent-environment">
            <select
              id="agent-environment"
              className={INPUT_CLASSES}
              value={value.default_environment_id}
              onChange={(e) => onChange({ ...value, default_environment_id: e.target.value })}
            >
              <option value="">None</option>
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Credential vault" htmlFor="agent-vault">
            <select
              id="agent-vault"
              className={INPUT_CLASSES}
              value={value.default_credential_vault_id}
              onChange={(e) => onChange({ ...value, default_credential_vault_id: e.target.value })}
            >
              <option value="">None</option>
              {credentialVaults.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section id="contract" title="Output contract" hint="Shape of the agent's final output. Enforced when the run completes.">
        <OutputContractField
          type={value.output_contract_type}
          payload={value.output_contract_payload}
          onChange={(next) => onChange({ ...value, output_contract_type: next.type, output_contract_payload: next.payload })}
        />
      </Section>

      <Section id="starters" title="Starter prompts" hint="Suggestions shown when someone drafts a new run.">
        <StarterPromptsEditor
          value={value.starter_prompts}
          onChange={(next) => onChange({ ...value, starter_prompts: next })}
        />
      </Section>
    </div>
  )
}

function Section({
  id,
  title,
  hint,
  right,
  children,
}: {
  id: string
  title: string
  hint?: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section data-section={id} id={`section-${id}`} className="scroll-mt-24 space-y-3">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-gray-900">{title}</h3>
          {hint ? <p className="mt-0.5 text-xs text-gray-500">{hint}</p> : null}
        </div>
        {right}
      </div>
      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">{children}</div>
    </section>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className={`mb-1 block ${EYEBROW}`}>
        {label}
      </label>
      {children}
    </div>
  )
}

function StarterPromptsEditor({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (!v) return
    if (value.includes(v)) {
      setDraft('')
      return
    }
    onChange([...value, v])
    setDraft('')
  }
  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <p className="text-xs text-gray-500">No starter prompts yet. Add one below.</p>
      ) : (
        <ul className="space-y-1">
          {value.map((prompt, idx) => (
            <li key={`${prompt}-${idx}`} className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{prompt}</span>
              <button
                type="button"
                className={clsx('rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600', FOCUS_RING)}
                onClick={() => onChange(value.filter((_, i) => i !== idx))}
                aria-label={`Remove "${prompt}"`}
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <input
          className={INPUT_CLASSES}
          placeholder="Add a starter prompt"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <Button type="button" variant="secondary" size="sm" onClick={add} disabled={!draft.trim()}>
          <IconPlus className="mr-1 h-3.5 w-3.5" />
          Add
        </Button>
      </div>
    </div>
  )
}

function autosizeRows(text: string): number {
  const lines = text.split('\n').length
  return Math.max(6, Math.min(40, lines + 2))
}

function providerDisplay(provider: string): string {
  const normalized = provider.trim().toLowerCase()
  if (normalized === 'openai') return 'OpenAI'
  if (normalized === 'anthropic') return 'Anthropic'
  if (!normalized) return ''
  return normalized[0].toUpperCase() + normalized.slice(1)
}

function parseProviderModel(
  value: string,
  providerIDs: string[],
  fallbackProvider: string,
): { provider: string; model: string } {
  const raw = value.trim()
  const fallback = fallbackProvider || providerIDs[0] || ''
  if (!raw) return { provider: fallback, model: '' }
  const slash = raw.indexOf('/')
  if (slash < 0) return { provider: fallback, model: raw }
  const providerPart = raw.slice(0, slash).trim().toLowerCase()
  const modelPart = raw.slice(slash + 1).trim()
  const matched =
    providerIDs.find((p) => p.toLowerCase() === providerPart) ||
    providerIDs.find((p) => providerDisplay(p).toLowerCase() === providerPart) ||
    fallback
  return { provider: matched, model: modelPart }
}
