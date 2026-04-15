import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Sparkles, Trash2 } from 'lucide-react'
import { EmptyState, SectionTitle } from '../components/Common'
import { api } from '../lib/api'

export function AgentDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const agentsQ = useQuery({ queryKey: ['agents'], queryFn: api.listAgents })
  const toolsQ = useQuery({ queryKey: ['tools'], queryFn: api.listTools })
  const providersQ = useQuery({ queryKey: ['providers'], queryFn: api.listProviders })
  const providerIDs = useMemo(() => (providersQ.data ?? []).map((p) => p.provider), [providersQ.data])
  const openAIModelsQ = useQuery({
    queryKey: ['providers', 'openai', 'models'],
    queryFn: api.listOpenAIModels,
    enabled: providerIDs.includes('openai'),
  })
  const openAIModels = openAIModelsQ.data ?? []
  const agent = useMemo(() => (agentsQ.data ?? []).find((a) => a.id === id), [agentsQ.data, id])
  const availableTools = useMemo(
    () =>
      (toolsQ.data ?? [])
        .filter((t) => t.enabled)
        .map((t) => ({ name: t.name, description: t.description, isBuiltin: t.is_builtin })),
    [toolsQ.data],
  )

  const [form, setForm] = useState({
    name: '',
    description: '',
    provider: '',
    model: '',
    system_prompt: '',
    allowed_tools: [] as string[],
    starter_prompts_text: '',
    default_task: '',
    default_max_steps: 30,
    default_workspace_path: '',
  })
  const [providerModelInput, setProviderModelInput] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [activePanel, setActivePanel] = useState<'config' | 'source' | 'preview'>('source')
  const [coachText, setCoachText] = useState('')
  const [launchTask, setLaunchTask] = useState('')

  useEffect(() => {
    if (!agent) return
    setForm({
      name: agent.name,
      description: agent.description,
      provider: agent.provider,
      model: agent.model,
      system_prompt: agent.system_prompt,
      allowed_tools: agent.allowed_tools ?? [],
      starter_prompts_text: starterPromptsToText(agent.starter_prompts ?? []),
      default_task: agent.default_task ?? '',
      default_max_steps: agent.default_max_steps ?? 30,
      default_workspace_path: agent.default_workspace_path ?? '',
    })
    setProviderModelInput(formatProviderModel(agent.provider, agent.model))
    setLaunchTask(agent.default_task || (agent.starter_prompts ?? [])[0] || '')
  }, [agent])

  useEffect(() => {
    if (!form.provider && providerIDs.length > 0) {
      setForm((prev) => ({ ...prev, provider: providerIDs[0] }))
    }
  }, [providerIDs, form.provider])

  const providerModelSuggestions = useMemo(() => {
    const out: string[] = []
    for (const provider of providerIDs) {
      if (provider === 'openai' && openAIModels.length > 0) {
        for (const model of openAIModels) out.push(formatProviderModel(provider, model))
      } else {
        out.push(formatProviderModel(provider, ''))
      }
    }
    return Array.from(new Set(out))
  }, [providerIDs, openAIModels])
  const updateAgent = useMutation({
    mutationFn: () =>
      api.updateAgent(id, {
        name: form.name,
        description: form.description,
        provider: form.provider,
        model: form.model,
        system_prompt: form.system_prompt,
        allowed_tools: form.allowed_tools,
        starter_prompts: parseStarterPrompts(form.starter_prompts_text),
        default_task: form.default_task,
        default_max_steps: form.default_max_steps,
        default_workspace_path: form.default_workspace_path,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
    },
  })

  const createRun = useMutation({
    mutationFn: () =>
      api.createRun({
        agent_id: id,
        task: launchTask || form.default_task,
        max_steps: form.default_max_steps,
        workspace_path: form.default_workspace_path,
      }),
    onSuccess: (out) => navigate(`/sessions/${out.id}`),
  })

  const enhancePrompt = useMutation({
    mutationFn: () => api.enhanceSystemPrompt({ prompt: form.system_prompt, provider: form.provider, model: form.model }),
    onSuccess: (out) => setForm((f) => ({ ...f, system_prompt: out.prompt })),
  })

  const deleteAgent = useMutation({
    mutationFn: (force: boolean) => api.deleteAgent(id, force),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      navigate('/agents')
    },
  })

  const generatedPayload = useMemo(
    () => ({
      name: form.name || 'unnamed-agent',
      model: `${form.provider || 'provider'}/${form.model || 'model'}`,
      tools: form.allowed_tools.map((tool) => ({ type: tool })),
      system: form.system_prompt || '',
      starter_prompts: parseStarterPrompts(form.starter_prompts_text),
      defaults: {
        task: form.default_task || '',
        max_steps: form.default_max_steps || 30,
        workspace_path: form.default_workspace_path || '',
      },
    }),
    [form.name, form.provider, form.model, form.allowed_tools, form.system_prompt, form.starter_prompts_text, form.default_task, form.default_max_steps, form.default_workspace_path],
  )

  const yamlPreview = useMemo(() => payloadToYaml(generatedPayload), [generatedPayload])

  const createCallPreview = useMemo(() => {
    return `curl -X POST /v1/agents \\
-H "content-type: application/json" \\
-d '${JSON.stringify(generatedPayload, null, 2)}'`
  }, [generatedPayload])

  if (agentsQ.isLoading) {
    return (
      <div className="space-y-4">
        <SectionTitle title="Agent" subtitle="Loading..." />
        <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">Loading agent details...</p>
        </div>
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="space-y-4">
        <SectionTitle title="Agent" subtitle="Not found" />
        <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <EmptyState title="Agent not found" body="The selected agent does not exist or was deleted." />
          <div className="mt-4">
            <Link to="/agents" className="text-sm font-medium text-gray-700 underline underline-offset-2">
              Back to agents
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="-mx-8 -my-6 min-h-[calc(100vh-2rem)] border-l border-gray-200 bg-[#f7f7f7]">
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Link to="/agents" className="hover:text-gray-900 transition-colors">
            Agents
          </Link>
          <span>/</span>
          <span className="font-medium text-gray-700">{form.name || id}</span>
        </div>
        <div className="hidden items-center gap-3 text-xs md:flex">
          <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-gray-700">
            <span className="h-2 w-2 rounded-full bg-gray-900" />
            Create agent
          </span>
          <span className="text-gray-400">Configure environment</span>
          <span className="text-gray-400">Start session</span>
          <span className="text-gray-400">Integrate</span>
        </div>
      </div>

      <div className="grid min-h-[calc(100vh-7rem)] grid-cols-1 lg:grid-cols-[420px_minmax(0,1fr)]">
        <aside className="border-r border-gray-200 bg-[#f9f9f9] p-5">
          <SectionTitle title={form.name || 'Agent'} subtitle={id} />
          <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm leading-relaxed text-gray-700">{form.description || 'Add a concise description for this agent.'}</p>
          </div>

          <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Generated agent config</p>
            <pre className="max-h-44 overflow-auto rounded bg-gray-900 p-3 font-mono text-[11px] text-gray-100">{createCallPreview}</pre>
            <div className="mt-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono text-gray-700">agent_id: {id}</div>
          </div>

          <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Refine the goal</p>
            <textarea
              value={coachText}
              onChange={(e) => setCoachText(e.target.value)}
              className="h-24 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
              placeholder="Describe what you'd like to achieve."
            />
            <button
              type="button"
              className="mt-2 h-8 rounded-md border border-gray-300 px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
              onClick={() => {
                if (!coachText.trim()) return
                setForm((prev) => ({ ...prev, description: coachText.trim() }))
                setCoachText('')
              }}
            >
              Apply to description
            </button>
          </div>

          <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Start session</p>
            <textarea
              className="h-24 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
              placeholder="Session task"
              value={launchTask}
              onChange={(e) => setLaunchTask(e.target.value)}
            />
            {(parseStarterPrompts(form.starter_prompts_text)).length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {parseStarterPrompts(form.starter_prompts_text).slice(0, 5).map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] text-gray-600 transition-colors hover:bg-gray-100"
                    onClick={() => setLaunchTask(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className="mt-3 h-8 rounded-md bg-gray-900 px-3 text-xs font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
              onClick={() => createRun.mutate()}
              disabled={createRun.isPending || !(launchTask || form.default_task).trim()}
            >
              {createRun.isPending ? 'Starting...' : 'Start Session'}
            </button>
          </div>

          {deleteError ? (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{deleteError}</p>
          ) : null}
        </aside>

        <section className="p-5">
          <div className="mb-3 flex items-center gap-5 border-b border-gray-200 px-1">
            {[
              { id: 'config', label: 'Config' },
              { id: 'source', label: 'Source code' },
              { id: 'preview', label: 'Preview' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActivePanel(tab.id as 'config' | 'source' | 'preview')}
                className={`pb-2 text-sm font-medium transition-colors ${
                  activePanel === tab.id ? 'border-b-2 border-gray-900 text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activePanel === 'config' ? (
            <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <input
                className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Agent name"
              />
              <input
                className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Description"
              />
              <input
                list="provider-model-suggestions-detail"
                className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                placeholder="OpenAI/gpt-5.4 or Anthropic/claude-3-5-sonnet-latest"
                value={providerModelInput}
                onChange={(e) => {
                  const next = e.target.value
                  setProviderModelInput(next)
                  const parsed = parseProviderModelInput(next, providerIDs, form.provider || providerIDs[0] || '')
                  setForm((f) => ({ ...f, provider: parsed.provider, model: parsed.model }))
                }}
                onBlur={() => setProviderModelInput(formatProviderModel(form.provider, form.model))}
              />
              <datalist id="provider-model-suggestions-detail">
                {providerModelSuggestions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
              <div className="relative">
                <textarea
                  className="h-44 w-full rounded-md border border-gray-300 bg-white px-3 py-2 pr-28 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                  value={form.system_prompt}
                  onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
                  placeholder="System prompt"
                />
                <button
                  className="absolute bottom-3 right-3 inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-100 disabled:opacity-50"
                  disabled={!form.provider || enhancePrompt.isPending}
                  onClick={() => enhancePrompt.mutate()}
                  type="button"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {enhancePrompt.isPending ? 'Enhancing...' : 'AI Enhance'}
                </button>
              </div>
              <ToolSelectorAccordion
                title="Allowed tools"
                tools={availableTools}
                selected={form.allowed_tools}
                onChange={(next) => setForm((f) => ({ ...f, allowed_tools: next }))}
              />
              <textarea
                className="h-20 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                value={form.starter_prompts_text}
                onChange={(e) => setForm((f) => ({ ...f, starter_prompts_text: e.target.value }))}
                placeholder="Starter prompts (one per line)"
              />
              <textarea
                className="h-24 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                value={form.default_task}
                onChange={(e) => setForm((f) => ({ ...f, default_task: e.target.value }))}
                placeholder="Default session task (used when task is blank)"
              />
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  type="number"
                  min={1}
                  className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                  value={form.default_max_steps}
                  onChange={(e) => setForm((f) => ({ ...f, default_max_steps: Number(e.target.value || 30) }))}
                  placeholder="Default max steps"
                />
                <input
                  className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                  value={form.default_workspace_path}
                  onChange={(e) => setForm((f) => ({ ...f, default_workspace_path: e.target.value }))}
                  placeholder="Default workspace path (supports {{run_id}})"
                />
              </div>
            </div>
          ) : null}

          {activePanel === 'source' ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                <span>yaml</span>
                <span>{form.provider}/{form.model}</span>
              </div>
              <pre className="max-h-[620px] overflow-auto rounded bg-gray-900 p-4 font-mono text-[12px] leading-relaxed text-gray-100">{yamlPreview}</pre>
            </div>
          ) : null}

          {activePanel === 'preview' ? (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold tracking-tight text-gray-900">Agent Preview</h3>
              <p className="mt-3 text-sm text-gray-600">{form.description || 'No description provided yet.'}</p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <PreviewStat label="Provider" value={form.provider || '-'} />
                <PreviewStat label="Model" value={form.model || '-'} />
                <PreviewStat label="Tools" value={String(form.allowed_tools.length)} />
              </div>
              <pre className="mt-4 max-h-72 overflow-auto rounded bg-gray-900 p-3 font-mono text-[11px] text-gray-100">
                {JSON.stringify(generatedPayload, null, 2)}
              </pre>
            </div>
          ) : null}

          <div className="mt-4 flex items-center gap-2">
            <button
              className="h-9 rounded-md bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
              disabled={updateAgent.isPending}
              onClick={() => updateAgent.mutate()}
            >
              {updateAgent.isPending ? 'Saving...' : 'Save changes'}
            </button>
            <button
              className="h-9 rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
              disabled={deleteAgent.isPending}
              onClick={async () => {
                const ok = window.confirm(`Delete agent "${form.name}"?`)
                if (!ok) return
                setDeleteError('')
                try {
                  await deleteAgent.mutateAsync(false)
                } catch (err) {
                  const message = err instanceof Error ? err.message : 'Failed to delete agent'
                  if (message.includes('agent has runs') || message.includes('agent has sessions')) {
                    const force = window.confirm(
                      `Agent "${form.name}" has sessions.\n\nForce delete will permanently remove all session history for this agent.\n\nContinue?`,
                    )
                    if (!force) {
                      setDeleteError(message)
                      return
                    }
                    try {
                      await deleteAgent.mutateAsync(true)
                    } catch (forceErr) {
                      setDeleteError(forceErr instanceof Error ? forceErr.message : 'Failed to force delete agent')
                    }
                    return
                  }
                  setDeleteError(message)
                }
              }}
            >
              <Trash2 className="mr-1 inline-block h-3.5 w-3.5" />
              Delete
            </button>
            <button
              className="h-9 rounded-md border border-gray-300 px-3 text-sm transition-colors hover:bg-gray-50"
              onClick={() => navigate('/agents')}
            >
              Back
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-gray-900">{value}</p>
    </div>
  )
}

function ToolSelectorAccordion({
  title,
  tools,
  selected,
  onChange,
}: {
  title: string
  tools: Array<{ name: string; description: string; isBuiltin: boolean }>
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [filter, setFilter] = useState('')
  const needle = filter.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!needle) return tools
    return tools.filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(needle))
  }, [tools, needle])
  const grouped = useMemo(() => {
    const groups: Record<string, Array<{ name: string; description: string; isBuiltin: boolean }>> = {}
    for (const tool of filtered) {
      const key = tool.name.includes('.') ? tool.name.split('.')[0] : 'other'
      if (!groups[key]) groups[key] = []
      groups[key].push(tool)
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  return (
    <details className="mt-3 rounded-md border border-gray-200 bg-gray-50/50 p-2">
      <summary className="cursor-pointer select-none text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
        {title} ({selected.length} selected)
      </summary>
      <div className="mt-3 space-y-2">
        <input
          className="h-8 w-full rounded-md border border-gray-300 bg-white px-2.5 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
          placeholder="Filter tools..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="max-h-52 space-y-2 overflow-auto rounded-md border border-gray-200 bg-white p-2 shadow-sm">
          {grouped.length === 0 ? <p className="text-xs text-gray-500">No tools match filter.</p> : null}
          {grouped.map(([group, items]) => (
            <div key={group} className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 pl-1">{group}</p>
              {items.map((tool) => {
                const checked = selected.includes(tool.name)
                return (
                  <label key={tool.name} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1.5 hover:bg-gray-50 transition-colors">
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) onChange([...selected, tool.name])
                        else onChange(selected.filter((v) => v !== tool.name))
                      }}
                    />
                    <span className="min-w-0 text-xs">
                      <span className="font-mono text-gray-700">{tool.name}</span>
                      <span className="ml-1 text-gray-500">{tool.description}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </details>
  )
}

function providerDisplayName(provider: string) {
  const normalized = provider.trim().toLowerCase()
  if (normalized === 'openai') return 'OpenAI'
  if (normalized === 'anthropic') return 'Anthropic'
  if (!normalized) return ''
  return normalized[0].toUpperCase() + normalized.slice(1)
}

function formatProviderModel(provider: string, model: string) {
  const p = provider.trim()
  const m = model.trim()
  if (!p && !m) return ''
  const label = providerDisplayName(p || 'openai')
  if (!m) return `${label}/`
  return `${label}/${m}`
}

function parseProviderModelInput(value: string, providerIDs: string[], fallbackProvider: string) {
  const raw = value.trim()
  const fallback = fallbackProvider || providerIDs[0] || ''
  if (!raw) return { provider: fallback, model: '' }
  const slash = raw.indexOf('/')
  if (slash < 0) {
    return { provider: fallback, model: raw }
  }
  const providerPart = raw.slice(0, slash).trim().toLowerCase()
  const modelPart = raw.slice(slash + 1).trim()
  const matchedProvider =
    providerIDs.find((p) => p.toLowerCase() === providerPart) ||
    providerIDs.find((p) => providerDisplayName(p).toLowerCase() === providerPart) ||
    fallback
  return { provider: matchedProvider, model: modelPart }
}

function parseStarterPrompts(value: string) {
  return Array.from(
    new Set(
      value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  )
}

function starterPromptsToText(prompts: string[]) {
  return prompts.join('\n')
}

function payloadToYaml(payload: { name: string; model: string; tools: Array<{ type: string }>; system: string }) {
  const toolsBlock = payload.tools.length > 0 ? payload.tools.map((tool) => `  - type: ${tool.type}`).join('\n') : '  - type: none'
  const systemLines = payload.system
    ? payload.system
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n')
    : '  Add a system prompt.'

  return `name: ${payload.name}
model: ${payload.model}
tools:
${toolsBlock}
system: |
${systemLines}`
}
