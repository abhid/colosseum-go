import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { IconPlayerPlay } from '@tabler/icons-react'
import clsx from 'clsx'

import { Card, EmptyState, ErrorBanner, LoadingState, QueryErrorState } from '../components/Common'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../lib/tokens'
import { api } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'
import {
  EMPTY_AGENT_FORM,
  agentToFormState,
  diffAgentForm,
  isAgentFormDirty,
  validateContractPayload,
} from '../lib/agentForm'
import type { AgentFormState } from '../lib/agentForm'
import { AgentEditorForm } from '../components/agent/AgentEditorForm'
import type { ToolOption } from '../components/agent/AgentEditorForm'
import { AgentInspector } from '../components/agent/AgentInspector'
import { SectionNav } from '../components/ui/SectionNav'
import type { SectionEntry } from '../components/ui/SectionNav'
import { RunLaunchDialog } from '../components/agent/RunLaunchDialog'
import { DangerZone } from '../components/agent/DangerZone'

const INSPECTOR_STORAGE_KEY = 'agent-detail-inspector-collapsed'

const SECTIONS: SectionEntry[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'model', label: 'Model' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'tools', label: 'Tools' },
  { id: 'defaults', label: 'Defaults' },
  { id: 'contract', label: 'Contract' },
  { id: 'starters', label: 'Starters' },
  { id: 'danger', label: 'Danger zone' },
]

export function AgentDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const agentsQ = useQuery({ queryKey: queryKeys.agents, queryFn: api.listAgents })
  const toolsQ = useQuery({ queryKey: queryKeys.tools, queryFn: api.listTools })
  const providersQ = useQuery({ queryKey: queryKeys.providers, queryFn: api.listProviders })
  const environmentsQ = useQuery({ queryKey: ['environments'], queryFn: api.listEnvironments })
  const vaultsQ = useQuery({ queryKey: ['credential-vaults'], queryFn: api.listCredentialVaults })
  const providerIDs = useMemo(() => (providersQ.data ?? []).map((p) => p.provider), [providersQ.data])
  const openAIModelsQ = useQuery({
    queryKey: queryKeys.openAIModels,
    queryFn: api.listOpenAIModels,
    enabled: providerIDs.includes('openai'),
  })
  const openAIModels = useMemo(() => openAIModelsQ.data ?? [], [openAIModelsQ.data])

  const agent = useMemo(() => (agentsQ.data ?? []).find((a) => a.id === id), [agentsQ.data, id])

  const availableTools: ToolOption[] = useMemo(
    () =>
      (toolsQ.data ?? [])
        .filter((t) => t.enabled)
        .map((t) => ({ name: t.name, description: t.description, isBuiltin: t.is_builtin })),
    [toolsQ.data],
  )
  const allBuiltinTools = useMemo(
    () => (toolsQ.data ?? []).filter((t) => t.enabled && t.is_builtin).map((t) => t.name),
    [toolsQ.data],
  )
  const environments = useMemo(
    () =>
      (environmentsQ.data ?? []).map((e) => ({
        id: String((e as Record<string, unknown>).id ?? ''),
        name: String((e as Record<string, unknown>).name ?? (e as Record<string, unknown>).id ?? ''),
      })),
    [environmentsQ.data],
  )
  const credentialVaults = useMemo(
    () =>
      (vaultsQ.data ?? []).map((v) => ({
        id: String((v as Record<string, unknown>).id ?? ''),
        name: String((v as Record<string, unknown>).name ?? (v as Record<string, unknown>).id ?? ''),
      })),
    [vaultsQ.data],
  )

  const providerModelSuggestions = useMemo(() => {
    const out: string[] = []
    for (const provider of providerIDs) {
      if (provider === 'openai' && openAIModels.length > 0) {
        for (const model of openAIModels) out.push(`${formatProviderDisplay(provider)}/${model}`)
      } else {
        out.push(`${formatProviderDisplay(provider)}/`)
      }
    }
    return Array.from(new Set(out))
  }, [providerIDs, openAIModels])

  const [baseline, setBaseline] = useState<AgentFormState>(EMPTY_AGENT_FORM)
  const [form, setForm] = useState<AgentFormState>(EMPTY_AGENT_FORM)
  const [inspectorCollapsed, setInspectorCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const stored = window.localStorage.getItem(INSPECTOR_STORAGE_KEY)
    return stored === null ? true : stored === '1'
  })
  const [launchOpen, setLaunchOpen] = useState(false)
  const editorScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!agent) return
    const next = agentToFormState(agent)
    setBaseline(next)
    setForm(next)
  }, [agent])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(INSPECTOR_STORAGE_KEY, inspectorCollapsed ? '1' : '0')
  }, [inspectorCollapsed])

  const isDirty = useMemo(() => isAgentFormDirty(baseline, form), [baseline, form])
  const diffCount = useMemo(() => diffAgentForm(baseline, form).length, [baseline, form])
  const contractError = validateContractPayload(form.output_contract_type, form.output_contract_payload)

  const updateAgent = useMutation({
    mutationFn: () =>
      api.updateAgent(id, {
        name: form.name,
        description: form.description,
        provider: form.provider,
        model: form.model,
        system_prompt: form.system_prompt,
        allowed_tools: form.allowed_tools,
        starter_prompts: form.starter_prompts,
        default_task: form.default_task,
        default_max_steps: form.default_max_steps,
        default_workspace_path: form.default_workspace_path,
        default_environment_id: form.default_environment_id,
        default_credential_vault_id: form.default_credential_vault_id,
        output_contract_type: form.output_contract_type,
        output_contract_payload: form.output_contract_payload,
        planning_mode: form.planning_mode,
      }),
    onSuccess: () => {
      setBaseline(form)
      qc.invalidateQueries({ queryKey: queryKeys.agents })
    },
  })

  const canSave = isDirty && !contractError && !updateAgent.isPending

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        if (canSave) {
          e.preventDefault()
          updateAgent.mutate()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canSave, updateAgent])

  if (agentsQ.isLoading) {
    return (
      <Card>
        <LoadingState label="Loading agent details…" />
      </Card>
    )
  }

  if (!agent) {
    return (
      <Card>
        <QueryErrorState title="Failed to load agent" query={agentsQ} />
        <EmptyState
          title="Agent not found"
          body="The selected agent does not exist or was deleted."
          action={
            <Link
              to="/agents"
              className={clsx('text-sm font-medium text-gray-700 underline underline-offset-2 rounded', FOCUS_RING)}
            >
              Back to agents
            </Link>
          }
        />
      </Card>
    )
  }

  return (
    <div className="-mx-8 -mb-6 flex h-[calc(100vh-3.5rem)] flex-col border-l border-gray-200 bg-gray-50">
      <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-6 py-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-xs text-gray-500">
          <Link to="/agents" className={clsx('transition-colors hover:text-gray-900 rounded', FOCUS_RING)}>
            Agents
          </Link>
          <span aria-hidden>/</span>
          <span className="truncate font-medium text-gray-700">{form.name || id}</span>
        </nav>
        <div className="flex items-center gap-3">
          {isDirty ? (
            <>
              <span className="text-xs text-amber-700">
                {diffCount} unsaved {diffCount === 1 ? 'change' : 'changes'}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={updateAgent.isPending}
                onClick={() => setForm(baseline)}
              >
                Discard
              </Button>
            </>
          ) : (
            <span className="text-xs text-gray-400">All changes saved</span>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setLaunchOpen(true)}
            leadingIcon={<IconPlayerPlay className="h-3.5 w-3.5" />}
          >
            Start a run
          </Button>
          <Button size="sm" disabled={!canSave} onClick={() => updateAgent.mutate()}>
            {updateAgent.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <ErrorBanner
        className="mx-6 mt-3"
        title="Couldn't save changes"
        message={updateAgent.error ? (updateAgent.error as Error).message : undefined}
      />

      <div
        className={clsx(
          'grid min-h-0 flex-1',
          inspectorCollapsed
            ? 'grid-cols-[180px_minmax(0,1fr)_44px]'
            : 'grid-cols-[180px_minmax(0,1fr)_minmax(320px,420px)]',
        )}
      >
        <aside className="min-h-0 overflow-auto border-r border-gray-200 bg-gray-50 px-3 py-5">
          <SectionNav sections={SECTIONS} containerRef={editorScrollRef} />
        </aside>

        <div ref={editorScrollRef} className="min-h-0 overflow-auto px-6 py-5">
          <AgentEditorForm
            value={form}
            onChange={setForm}
            providerIDs={providerIDs}
            providerModelSuggestions={providerModelSuggestions}
            availableTools={availableTools}
            environments={environments}
            credentialVaults={credentialVaults}
            allBuiltinTools={allBuiltinTools}
          />
          <div className="mt-8">
            <DangerZone agentID={id} agentName={form.name || id} />
          </div>
        </div>

        <AgentInspector
          agentID={id}
          value={form}
          baseline={baseline}
          collapsed={inspectorCollapsed}
          onToggleCollapsed={() => setInspectorCollapsed((v) => !v)}
        />
      </div>

      <RunLaunchDialog
        open={launchOpen}
        onClose={() => setLaunchOpen(false)}
        agentID={id}
        agentName={form.name || id}
        defaults={{
          default_task: form.default_task,
          default_max_steps: form.default_max_steps,
          default_workspace_path: form.default_workspace_path,
          starter_prompts: form.starter_prompts,
        }}
        onLaunched={(runID) => navigate(`/runs/${runID}`)}
      />
    </div>
  )
}

function formatProviderDisplay(provider: string): string {
  const normalized = provider.trim().toLowerCase()
  if (normalized === 'openai') return 'OpenAI'
  if (normalized === 'anthropic') return 'Anthropic'
  if (!normalized) return ''
  return normalized[0].toUpperCase() + normalized.slice(1)
}
