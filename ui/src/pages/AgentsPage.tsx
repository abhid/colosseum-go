import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil, Sparkles, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { Card, EmptyState, SectionTitle } from '../components/Common'

export function AgentsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const agents = useQuery({ queryKey: ['agents'], queryFn: api.listAgents })
  const toolsQ = useQuery({ queryKey: ['tools'], queryFn: api.listTools })
  const providersQ = useQuery({ queryKey: ['providers'], queryFn: api.listProviders })
  const availableTools = useMemo(
    () =>
      (toolsQ.data ?? [])
        .filter((t) => t.enabled)
        .map((t) => ({ name: t.name, description: t.description, isBuiltin: t.is_builtin })),
    [toolsQ.data],
  )
  const providerIDs = useMemo(() => (providersQ.data ?? []).map((p) => p.provider), [providersQ.data])
  const openAIModelsQ = useQuery({
    queryKey: ['providers', 'openai', 'models'],
    queryFn: api.listOpenAIModels,
    enabled: providerIDs.includes('openai'),
  })
  const openAIModels = openAIModelsQ.data ?? []
  const [form, setForm] = useState({
    name: '',
    description: '',
    provider: '',
    model: '',
    system_prompt: '',
    allowed_tools: [] as string[],
  })
  const [createToolsInitialized, setCreateToolsInitialized] = useState(false)
  const [createProviderModelInput, setCreateProviderModelInput] = useState('')
  const [editId, setEditId] = useState('')
  const [editForm, setEditForm] = useState({ name: '', description: '', provider: '', model: '', system_prompt: '', allowed_tools: [] as string[] })
  const [editProviderModelInput, setEditProviderModelInput] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const providerModelSuggestions = useMemo(() => {
    const out: string[] = []
    for (const provider of providerIDs) {
      if (provider === 'openai' && openAIModels.length > 0) {
        for (const model of openAIModels) {
          out.push(formatProviderModel(provider, model))
        }
        continue
      }
      out.push(formatProviderModel(provider, ''))
    }
    return Array.from(new Set(out))
  }, [providerIDs, openAIModels])

  useEffect(() => {
    if (providerIDs.length === 0) {
      setForm((f) => ({ ...f, provider: '', model: '' }))
      return
    }
    const preferredProvider = providerIDs.includes(form.provider) ? form.provider : providerIDs[0]
    const preferredModel = preferredProvider === 'openai' ? pickPreferredOpenAIModel(openAIModels, form.model) : (form.model || '')
    setForm((f) => {
      if (f.provider === preferredProvider && f.model === preferredModel) return f
      return { ...f, provider: preferredProvider, model: preferredModel }
    })
  }, [providerIDs, openAIModels, form.provider, form.model])

  useEffect(() => {
    if (createProviderModelInput.trim()) return
    setCreateProviderModelInput(formatProviderModel(form.provider, form.model))
  }, [form.provider, form.model, createProviderModelInput])

  useEffect(() => {
    if (createToolsInitialized) return
    if (availableTools.length === 0) return
    setForm((f) => ({ ...f, allowed_tools: availableTools.map((t) => t.name) }))
    setCreateToolsInitialized(true)
  }, [availableTools, createToolsInitialized])

  const createAgent = useMutation({
    mutationFn: api.createAgent,
    onSuccess: () => {
      setForm((f) => ({ ...f, name: '', description: '', system_prompt: '' }))
      setCreateProviderModelInput('')
      qc.invalidateQueries({ queryKey: ['agents'] })
    },
  })

  const updateAgent = useMutation({
    mutationFn: (payload: { id: string; body: { name: string; description: string; provider: string; model: string; system_prompt: string; allowed_tools: string[] } }) =>
      api.updateAgent(payload.id, payload.body),
    onSuccess: () => {
      setEditId('')
      qc.invalidateQueries({ queryKey: ['agents'] })
    },
  })
  const deleteAgent = useMutation({
    mutationFn: (payload: { id: string; force?: boolean }) => api.deleteAgent(payload.id, payload.force ?? false),
    onSuccess: () => {
      setDeleteError('')
      if (editId) setEditId('')
      qc.invalidateQueries({ queryKey: ['agents'] })
    },
  })
  const enhanceCreatePrompt = useMutation({
    mutationFn: () => api.enhanceSystemPrompt({ prompt: form.system_prompt, provider: form.provider, model: form.model }),
    onSuccess: (out) => setForm((f) => ({ ...f, system_prompt: out.prompt })),
  })
  const enhanceEditPrompt = useMutation({
    mutationFn: () => api.enhanceSystemPrompt({ prompt: editForm.system_prompt, provider: editForm.provider, model: editForm.model }),
    onSuccess: (out) => setEditForm((f) => ({ ...f, system_prompt: out.prompt })),
  })

  return (
    <div className="space-y-4">
      <SectionTitle title="Agents" subtitle="Define reusable model+tool profiles." />
      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Create Agent</h3>
        <div className="grid gap-3">
          <input className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" placeholder="Agent name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <input className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" placeholder="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          <input
            list="provider-model-suggestions"
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
            placeholder="OpenAI/gpt-5.4 or Anthropic/claude-3-5-sonnet-latest"
            value={createProviderModelInput}
            onChange={(e) => {
              const next = e.target.value
              setCreateProviderModelInput(next)
              const parsed = parseProviderModelInput(next, providerIDs, form.provider || providerIDs[0] || '')
              setForm((f) => ({ ...f, provider: parsed.provider, model: parsed.model }))
            }}
            onBlur={() => setCreateProviderModelInput(formatProviderModel(form.provider, form.model))}
          />
        </div>
        <datalist id="provider-model-suggestions">
          {providerModelSuggestions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
        <div className="relative mt-3">
          <textarea className="h-24 w-full rounded-md border border-gray-300 bg-white px-3 py-2 pr-28 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" placeholder="System prompt" value={form.system_prompt} onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))} />
          <button
            className="absolute bottom-3 right-3 inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-100 disabled:opacity-50"
            disabled={!form.provider || enhanceCreatePrompt.isPending}
            onClick={() => enhanceCreatePrompt.mutate()}
            type="button"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {enhanceCreatePrompt.isPending ? 'Enhancing...' : 'AI Enhance'}
          </button>
        </div>
        <ToolSelectorAccordion
          title="Allowed tools"
          tools={availableTools}
          selected={form.allowed_tools}
          onChange={(next) => setForm((f) => ({ ...f, allowed_tools: next }))}
        />
        {providerIDs.length === 0 ? <p className="mt-3 text-xs text-gray-500">No providers are configured. Set provider API keys and restart.</p> : null}
        <button
          className="mt-4 h-9 rounded-md bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
          disabled={providerIDs.length === 0 || !form.provider || !form.model}
          onClick={() => createAgent.mutate(form)}
        >
          Create Agent
        </button>
      </Card>

      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Agent Definitions</h3>
        {deleteError ? (
          <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{deleteError}</p>
        ) : null}
        {(agents.data ?? []).length === 0 ? <EmptyState title="No agents" body="Create an agent profile to start runs." /> : (
          <div className="space-y-3">
            {(agents.data ?? []).map((a) => (
              <div key={a.id} className="group cursor-pointer rounded-lg border border-gray-200 p-4 transition-colors hover:border-gray-300" onClick={() => navigate(`/agents/${a.id}`)}>
                {editId === a.id ? (
                  <div className="space-y-3">
                    <div className="grid gap-2">
                      <input className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                      <input className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
                      <input
                        list="provider-model-suggestions"
                        className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                        placeholder="OpenAI/gpt-5.4 or Anthropic/claude-3-5-sonnet-latest"
                        value={editProviderModelInput}
                        onChange={(e) => {
                          const next = e.target.value
                          setEditProviderModelInput(next)
                          const parsed = parseProviderModelInput(next, providerIDs, editForm.provider || providerIDs[0] || '')
                          setEditForm((f) => ({ ...f, provider: parsed.provider, model: parsed.model }))
                        }}
                        onBlur={() => setEditProviderModelInput(formatProviderModel(editForm.provider, editForm.model))}
                      />
                    </div>
                    <div className="relative">
                      <textarea className="h-24 w-full rounded-md border border-gray-300 bg-white px-3 py-2 pr-28 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" value={editForm.system_prompt} onChange={(e) => setEditForm((f) => ({ ...f, system_prompt: e.target.value }))} />
                      <button
                        className="absolute bottom-3 right-3 inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-100 disabled:opacity-50"
                        disabled={!editForm.provider || enhanceEditPrompt.isPending}
                        onClick={() => enhanceEditPrompt.mutate()}
                        type="button"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {enhanceEditPrompt.isPending ? 'Enhancing...' : 'AI Enhance'}
                      </button>
                    </div>
                    <ToolSelectorAccordion
                      title="Allowed tools"
                      tools={availableTools}
                      selected={editForm.allowed_tools}
                      onChange={(next) => setEditForm((f) => ({ ...f, allowed_tools: next }))}
                    />
                    <div className="flex gap-2 pt-2">
                      <button
                        className="h-8 rounded-md bg-gray-900 px-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
                        disabled={updateAgent.isPending}
                        onClick={() =>
                          updateAgent.mutate({
                            id: a.id,
                            body: {
                              name: editForm.name,
                              description: editForm.description,
                              provider: editForm.provider,
                              model: editForm.model,
                              system_prompt: editForm.system_prompt,
                              allowed_tools: editForm.allowed_tools,
                            },
                          })
                        }
                      >
                        Save
                      </button>
                      <button className="h-8 rounded-md border border-gray-300 px-3 text-sm transition-colors hover:bg-gray-50" onClick={() => setEditId('')}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{a.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{a.provider}:{a.model}</p>
                      </div>
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-600 transition-colors hover:bg-gray-100"
                          onClick={(event) => {
                            event.stopPropagation()
                            setEditId(a.id)
                            setEditForm({
                              name: a.name,
                              description: a.description,
                              provider: a.provider,
                              model: a.model,
                              system_prompt: a.system_prompt,
                              allowed_tools: a.allowed_tools ?? [],
                            })
                            setEditProviderModelInput(formatProviderModel(a.provider, a.model))
                          }}
                          aria-label="Edit agent"
                          title="Edit agent"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-200 text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                          onClick={async (event) => {
                            event.stopPropagation()
                            const ok = window.confirm(`Delete agent "${a.name}"?`)
                            if (!ok) return
                            setDeleteError('')
                            try {
                              await deleteAgent.mutateAsync({ id: a.id })
                            } catch (err) {
                              const message = err instanceof Error ? err.message : 'Failed to delete agent'
                              if (message.includes('agent has runs')) {
                                const force = window.confirm(
                                  `Agent "${a.name}" has runs.\n\nForce delete will permanently remove all runs and run history for this agent.\n\nContinue?`,
                                )
                                if (!force) {
                                  setDeleteError(message)
                                  return
                                }
                                try {
                                  await deleteAgent.mutateAsync({ id: a.id, force: true })
                                } catch (forceErr) {
                                  const forceMessage = forceErr instanceof Error ? forceErr.message : 'Failed to force delete agent'
                                  setDeleteError(forceMessage)
                                }
                                return
                              }
                              setDeleteError(message)
                            }
                          }}
                          disabled={deleteAgent.isPending}
                          aria-label="Delete agent"
                          title="Delete agent"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-gray-700 leading-relaxed">{a.description}</p>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
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

function pickPreferredOpenAIModel(models: string[], current: string) {
  const trimmedCurrent = current.trim()
  if (trimmedCurrent && models.includes(trimmedCurrent)) return trimmedCurrent
  const preferredOrder = ['gpt-5.4', 'gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4o']
  for (const candidate of preferredOrder) {
    if (models.includes(candidate)) return candidate
  }
  return models[0] || trimmedCurrent || 'gpt-5.4'
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
