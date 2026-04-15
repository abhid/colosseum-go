import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Pencil, Sparkles, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { Card, EmptyState, SectionTitle } from '../components/Common'

export function AgentsPage() {
  const qc = useQueryClient()
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
  const [editId, setEditId] = useState('')
  const [editForm, setEditForm] = useState({ name: '', description: '', provider: '', model: '', system_prompt: '', allowed_tools: [] as string[] })

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
    if (createToolsInitialized) return
    if (availableTools.length === 0) return
    setForm((f) => ({ ...f, allowed_tools: availableTools.map((t) => t.name) }))
    setCreateToolsInitialized(true)
  }, [availableTools, createToolsInitialized])

  const createAgent = useMutation({
    mutationFn: api.createAgent,
    onSuccess: () => {
      setForm((f) => ({ ...f, name: '', description: '', system_prompt: '' }))
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
    mutationFn: (id: string) => api.deleteAgent(id),
    onSuccess: () => {
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
        <h3 className="mb-3 text-sm font-semibold tracking-tight">Create Agent</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <input className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm" placeholder="Agent name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <input className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm" placeholder="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          <select
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
            value={form.provider}
            onChange={(e) => {
              const provider = e.target.value
              setForm((f) => ({
                ...f,
                provider,
                model: provider === 'openai' ? pickPreferredOpenAIModel(openAIModels, f.model) : f.model,
              }))
            }}
          >
            {providerIDs.map((provider) => (
              <option key={provider} value={provider}>{provider}</option>
            ))}
          </select>
          {form.provider === 'openai' && openAIModels.length > 0 ? (
            <select className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}>
              {openAIModels.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          ) : (
            <input className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm" placeholder="Model" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
          )}
        </div>
        <div className="relative mt-3">
          <textarea className="h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-28 text-sm" placeholder="System prompt" value={form.system_prompt} onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))} />
          <button
            className="absolute bottom-2 right-2 inline-flex h-7 items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
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
        {providerIDs.length === 0 ? <p className="mt-3 text-xs text-slate-600">No providers are configured. Set provider API keys and restart.</p> : null}
        <button
          className="mt-3 h-9 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white disabled:opacity-50"
          disabled={providerIDs.length === 0 || !form.provider || !form.model}
          onClick={() => createAgent.mutate(form)}
        >
          Create Agent
        </button>
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold tracking-tight">Agent Definitions</h3>
        {(agents.data ?? []).length === 0 ? <EmptyState title="No agents" body="Create an agent profile to start runs." /> : (
          <div className="space-y-2">
            {(agents.data ?? []).map((a) => (
              <div key={a.id} className="rounded border border-slate-200 p-3">
                {editId === a.id ? (
                  <div className="space-y-2">
                    <div className="grid gap-2 md:grid-cols-2">
                      <input className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                      <input className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm" value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
                      <select
                        className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
                        value={editForm.provider}
                        onChange={(e) => {
                          const provider = e.target.value
                          setEditForm((f) => ({
                            ...f,
                            provider,
                            model: provider === 'openai' ? pickPreferredOpenAIModel(openAIModels, f.model) : f.model,
                          }))
                        }}
                      >
                        {providerIDs.map((provider) => (
                          <option key={provider} value={provider}>{provider}</option>
                        ))}
                      </select>
                      {editForm.provider === 'openai' && openAIModels.length > 0 ? (
                        <select className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm" value={editForm.model} onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))}>
                          {openAIModels.map((model) => <option key={model} value={model}>{model}</option>)}
                        </select>
                      ) : (
                        <input className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm" value={editForm.model} onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))} />
                      )}
                    </div>
                    <div className="relative">
                      <textarea className="h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-28 text-sm" value={editForm.system_prompt} onChange={(e) => setEditForm((f) => ({ ...f, system_prompt: e.target.value }))} />
                      <button
                        className="absolute bottom-2 right-2 inline-flex h-7 items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
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
                    <div className="flex gap-2">
                      <button
                        className="h-8 rounded-md bg-indigo-600 px-3 text-sm font-medium text-white disabled:opacity-50"
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
                      <button className="h-8 rounded-md border border-slate-300 px-3 text-sm" onClick={() => setEditId('')}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{a.name}</p>
                        <p className="text-xs text-slate-600">{a.provider}:{a.model}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
                          onClick={() => {
                            setEditId(a.id)
                            setEditForm({
                              name: a.name,
                              description: a.description,
                              provider: a.provider,
                              model: a.model,
                              system_prompt: a.system_prompt,
                              allowed_tools: a.allowed_tools ?? [],
                            })
                          }}
                          aria-label="Edit agent"
                          title="Edit agent"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                          onClick={() => {
                            const ok = window.confirm(`Delete agent "${a.name}"?`)
                            if (!ok) return
                            deleteAgent.mutate(a.id)
                          }}
                          disabled={deleteAgent.isPending}
                          aria-label="Delete agent"
                          title="Delete agent"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{a.description}</p>
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
    <details className="mt-3 rounded-md border border-slate-200 bg-slate-50/50 p-2" open>
      <summary className="cursor-pointer select-none text-sm font-medium text-slate-700">
        {title} ({selected.length} selected)
      </summary>
      <div className="mt-2 space-y-2">
        <input
          className="h-8 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm"
          placeholder="Filter tools..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="max-h-52 space-y-2 overflow-auto rounded-md border border-slate-200 bg-white p-2">
          {grouped.length === 0 ? <p className="text-xs text-slate-500">No tools match filter.</p> : null}
          {grouped.map(([group, items]) => (
            <div key={group} className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{group}</p>
              {items.map((tool) => {
                const checked = selected.includes(tool.name)
                return (
                  <label key={tool.name} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) onChange([...selected, tool.name])
                        else onChange(selected.filter((v) => v !== tool.name))
                      }}
                    />
                    <span className="min-w-0 text-xs">
                      <span className="font-mono text-slate-700">{tool.name}</span>
                      <span className="ml-1 text-slate-500">{tool.description}</span>
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
