import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Pencil, Sparkles, Trash2 } from 'lucide-react'
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
    starter_prompts_text: '',
    default_task: '',
    default_max_steps: 30,
    default_workspace_path: '',
  })
  const [createToolsInitialized, setCreateToolsInitialized] = useState(false)
  const [createProviderModelInput, setCreateProviderModelInput] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [createStartingPoint, setCreateStartingPoint] = useState<'blank' | 'template'>('blank')
  const [createTemplateKey, setCreateTemplateKey] = useState('deep_researcher')
  const [createDescribeInput, setCreateDescribeInput] = useState('')
  const [createConfigFormat, setCreateConfigFormat] = useState<'yaml' | 'json'>('yaml')
  const [createConfigText, setCreateConfigText] = useState('')
  const [createConfigError, setCreateConfigError] = useState('')
  const [isEditingCreateConfig, setIsEditingCreateConfig] = useState(false)
  const [editId, setEditId] = useState('')
  const [editForm, setEditForm] = useState({
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
  const createTemplates = useMemo(
    () => [
      {
        key: 'deep_researcher',
        name: 'Deep researcher',
        description: 'Web-heavy synthesis with evidence-backed summaries.',
        system_prompt:
          'You are a rigorous research agent. Gather evidence from web and local tools, verify claims, and produce concise, well-structured outputs with clear source grounding.',
        starter_prompts_text: ['Research this topic deeply and provide a fact-checked report.', 'Compare alternatives and recommend the best option with rationale.'].join('\n'),
      },
      {
        key: 'support_triage',
        name: 'Support triage',
        description: 'Classify requests, propose next actions, and draft responses.',
        system_prompt:
          'You are a support triage agent. Classify urgency, identify missing context, propose next actions, and draft a clear response with minimal back-and-forth.',
        starter_prompts_text: ['Triage this issue and suggest next steps.', 'Draft a customer reply and internal follow-up checklist.'].join('\n'),
      },
      {
        key: 'coding_assistant',
        name: 'Coding assistant',
        description: 'Code-focused autonomous session with tool-first behavior.',
        system_prompt:
          'You are a coding agent. Prefer direct execution, inspect existing code before editing, and produce concrete deliverables with validation steps and concise rationale.',
        starter_prompts_text: ['Implement this feature end-to-end and validate.', 'Debug this issue and provide a tested fix.'].join('\n'),
      },
    ],
    [],
  )

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
      setForm((f) => ({ ...f, name: '', description: '', system_prompt: '', starter_prompts_text: '', default_task: '', default_workspace_path: '' }))
      setCreateProviderModelInput('')
      setCreateDescribeInput('')
      setCreateStartingPoint('blank')
      setCreateConfigError('')
      setIsEditingCreateConfig(false)
      setIsCreateOpen(false)
      qc.invalidateQueries({ queryKey: ['agents'] })
    },
  })

  const updateAgent = useMutation({
    mutationFn: (payload: {
      id: string
      body: {
        name: string
        description: string
        provider: string
        model: string
        system_prompt: string
        allowed_tools: string[]
        starter_prompts: string[]
        default_task: string
        default_max_steps: number
        default_workspace_path: string
      }
    }) =>
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
  const generateCreateAgent = useMutation({
    mutationFn: async () => {
      const text = createDescribeInput.trim()
      if (!text) throw new Error('Please describe your agent first.')
      const provider = form.provider || providerIDs[0] || ''
      if (!provider) throw new Error('No model provider configured.')
      const model = form.model || (provider === 'openai' ? pickPreferredOpenAIModel(openAIModels, '') : '')
      const draftPrompt = [
        'Create a high-quality system prompt for this agent request.',
        'Focus on clear role, boundaries, output style, and tool usage behavior.',
        `User request: ${text}`,
      ].join('\n')
      const out = await api.enhanceSystemPrompt({ prompt: draftPrompt, provider, model })
      return { generatedPrompt: out.prompt, provider, model, text }
    },
    onSuccess: ({ generatedPrompt, provider, model, text }) => {
      setForm((f) => ({
        ...f,
        provider,
        model,
        name: f.name || text.slice(0, 60),
        description: text,
        default_task: f.default_task || text,
        system_prompt: generatedPrompt,
      }))
      setCreateProviderModelInput(formatProviderModel(provider, model))
    },
  })
  const enhanceEditPrompt = useMutation({
    mutationFn: () => api.enhanceSystemPrompt({ prompt: editForm.system_prompt, provider: editForm.provider, model: editForm.model }),
    onSuccess: (out) => setEditForm((f) => ({ ...f, system_prompt: out.prompt })),
  })

  const applyCreateTemplate = (key: string) => {
    const template = createTemplates.find((t) => t.key === key)
    if (!template) return
    setForm((f) => ({
      ...f,
      name: f.name || template.name,
      description: template.description,
      system_prompt: template.system_prompt,
      starter_prompts_text: template.starter_prompts_text,
      default_task: f.default_task || template.starter_prompts_text.split('\n')[0] || '',
    }))
  }

  const createConfigObject = useMemo(() => {
    const tools = (form.allowed_tools ?? []).map((name) => ({ type: name }))
    return {
      name: form.name.trim() || 'Untitled agent',
      description: form.description.trim() || 'A blank starting point with the core toolset.',
      model: formatProviderModel(form.provider, form.model),
      system: form.system_prompt.trim() || 'You are a general-purpose agent that can research, write code, run commands, and use connected tools to complete the user task.',
      tools,
      starter_prompts: parseStarterPrompts(form.starter_prompts_text),
      default_task: form.default_task.trim(),
    }
  }, [form])
  const createConfigYAML = useMemo(() => toSimpleYAML(createConfigObject), [createConfigObject])
  const createConfigJSON = useMemo(() => JSON.stringify(createConfigObject, null, 2), [createConfigObject])

  useEffect(() => {
    if (isEditingCreateConfig) return
    setCreateConfigText(createConfigFormat === 'yaml' ? createConfigYAML : createConfigJSON)
  }, [createConfigFormat, createConfigYAML, createConfigJSON, isEditingCreateConfig])

  const applyCreateConfigText = (text: string, format: 'yaml' | 'json') => {
    const parsed = parseAgentConfigText(text, format)
    if (parsed.ok === false) {
      setCreateConfigError(parsed.error)
      return
    }
    setCreateConfigError('')
    setForm((current) => {
      const next = { ...current }
      const patch = parsed.patch
      if (patch.name !== undefined) next.name = patch.name
      if (patch.description !== undefined) next.description = patch.description
      if (patch.system_prompt !== undefined) next.system_prompt = patch.system_prompt
      if (patch.default_task !== undefined) next.default_task = patch.default_task
      if (patch.starter_prompts_text !== undefined) next.starter_prompts_text = patch.starter_prompts_text
      if (patch.allowed_tools !== undefined) next.allowed_tools = patch.allowed_tools
      if (patch.provider !== undefined) next.provider = patch.provider
      if (patch.model !== undefined) next.model = patch.model
      setCreateProviderModelInput(formatProviderModel(next.provider, next.model))
      return next
    })
  }

  return (
    <div className="space-y-4">
      <SectionTitle title="Agents" subtitle="Define reusable model+tool profiles." />
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-gray-900">Create Agent</h3>
            <p className="mt-1 text-xs text-gray-500">Start from a template or describe what you need.</p>
          </div>
          <button
            className="h-9 rounded-md bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-800"
            onClick={() => setIsCreateOpen(true)}
            type="button"
          >
            New Agent
          </button>
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Agent Definitions</h3>
        {deleteError ? (
          <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{deleteError}</p>
        ) : null}
        {(agents.data ?? []).length === 0 ? <EmptyState title="No agents" body="Create an agent profile to start sessions." /> : (
          <div className="space-y-3">
            {(agents.data ?? []).map((a) => (
              <div key={a.id} className="group cursor-pointer rounded-lg border border-gray-200 p-4 transition-colors hover:border-gray-300" onClick={() => navigate(`/agents/${a.id}`)}>
                {editId === a.id ? (
                  <div className="space-y-3">
                    <div className="grid gap-2">
                      <input className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                      <input className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
                      <ProviderModelCombobox
                        value={editProviderModelInput}
                        options={providerModelSuggestions}
                        placeholder="OpenAI/gpt-5.4 or Anthropic/claude-3-5-sonnet-latest"
                        disabled={providerIDs.length === 0}
                        onValueChange={(next) => {
                          setEditProviderModelInput(next)
                          const parsed = parseProviderModelInput(next, providerIDs, editForm.provider || providerIDs[0] || '')
                          setEditForm((f) => ({ ...f, provider: parsed.provider, model: parsed.model }))
                        }}
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
                    <textarea
                      className="h-20 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                      placeholder="Starter prompts (one per line)"
                      value={editForm.starter_prompts_text}
                      onChange={(e) => setEditForm((f) => ({ ...f, starter_prompts_text: e.target.value }))}
                    />
                    <textarea
                      className="h-20 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                      placeholder="Default session task (used when task is blank)"
                      value={editForm.default_task}
                      onChange={(e) => setEditForm((f) => ({ ...f, default_task: e.target.value }))}
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
                              starter_prompts: parseStarterPrompts(editForm.starter_prompts_text),
                              default_task: editForm.default_task,
                              default_max_steps: editForm.default_max_steps,
                              default_workspace_path: editForm.default_workspace_path,
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
                        <p className="text-xs text-gray-500 mt-0.5">{a.provider}/{a.model}</p>
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
                              starter_prompts_text: (a.starter_prompts ?? []).join('\n'),
                              default_task: a.default_task ?? '',
                              default_max_steps: a.default_max_steps ?? 30,
                              default_workspace_path: a.default_workspace_path ?? '',
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
                              if (message.includes('agent has runs') || message.includes('agent has sessions')) {
                                const force = window.confirm(
                                  `Agent "${a.name}" has sessions.\n\nForce delete will permanently remove all session history for this agent.\n\nContinue?`,
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
                    {(a.starter_prompts ?? []).length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(a.starter_prompts ?? []).slice(0, 3).map((prompt) => (
                          <span key={prompt} className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] text-gray-600">
                            {prompt}
                          </span>
                        ))}
                        {(a.starter_prompts ?? []).length > 3 ? (
                          <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] text-gray-500">
                            +{(a.starter_prompts ?? []).length - 3} more
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {isCreateOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-brightness-75">
          <div role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-xl md:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-gray-900">Create agent</h3>
                <p className="mt-1 text-sm text-gray-500">Start from a template or describe what you need.</p>
              </div>
              <button
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                onClick={() => setIsCreateOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Starting point</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${createStartingPoint === 'blank' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
                  onClick={() => setCreateStartingPoint('blank')}
                >
                  Describe your agent
                </button>
                <button
                  type="button"
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${createStartingPoint === 'template' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
                  onClick={() => {
                    setCreateStartingPoint('template')
                    applyCreateTemplate(createTemplateKey)
                  }}
                >
                  Template
                </button>
              </div>
              {createStartingPoint === 'template' ? (
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {createTemplates.map((template) => {
                    const active = template.key === createTemplateKey
                    return (
                      <button
                        key={template.key}
                        type="button"
                        className={`rounded-lg border p-2.5 text-left transition-colors ${active ? 'border-gray-900 bg-white shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                        onClick={() => {
                          setCreateTemplateKey(template.key)
                          applyCreateTemplate(template.key)
                        }}
                      >
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-900">{template.name}</p>
                        <p className="mt-1 text-xs leading-relaxed text-gray-500">{template.description}</p>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="mt-3">
                  <textarea
                    className="h-20 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                    placeholder="Describe what this agent should do"
                    value={createDescribeInput}
                    onChange={(e) => setCreateDescribeInput(e.target.value)}
                  />
                </div>
              )}
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  disabled={!createDescribeInput.trim() || generateCreateAgent.isPending || providerIDs.length === 0}
                  onClick={() => generateCreateAgent.mutate()}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {createStartingPoint === 'template'
                    ? (generateCreateAgent.isPending ? 'Applying...' : 'Apply notes')
                    : (generateCreateAgent.isPending ? 'Generating...' : 'Generate')}
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <h4 className="text-sm font-semibold tracking-tight text-gray-900">Core settings</h4>
              <input className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" placeholder="Agent name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              <ProviderModelCombobox
                value={createProviderModelInput}
                options={providerModelSuggestions}
                placeholder="OpenAI/gpt-5.4 or Anthropic/claude-3-5-sonnet-latest"
                disabled={providerIDs.length === 0}
                onValueChange={(next) => {
                  setCreateProviderModelInput(next)
                  const parsed = parseProviderModelInput(next, providerIDs, form.provider || providerIDs[0] || '')
                  setForm((f) => ({ ...f, provider: parsed.provider, model: parsed.model }))
                }}
              />
            </div>

            <div className="mt-3 rounded-md border border-gray-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold tracking-tight text-gray-900">Agent config</h4>
                <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
                  <button
                    type="button"
                    className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${createConfigFormat === 'yaml' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    onClick={() => {
                      setIsEditingCreateConfig(false)
                      setCreateConfigFormat('yaml')
                    }}
                  >
                    YAML
                  </button>
                  <button
                    type="button"
                    className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${createConfigFormat === 'json' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    onClick={() => {
                      setIsEditingCreateConfig(false)
                      setCreateConfigFormat('json')
                    }}
                  >
                    JSON
                  </button>
                </div>
              </div>
              <textarea
                className="h-56 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs leading-relaxed text-gray-700 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                value={createConfigText}
                onFocus={() => setIsEditingCreateConfig(true)}
                onBlur={() => {
                  setIsEditingCreateConfig(false)
                  applyCreateConfigText(createConfigText, createConfigFormat)
                }}
                onChange={(e) => {
                  const next = e.target.value
                  setCreateConfigText(next)
                  applyCreateConfigText(next, createConfigFormat)
                }}
                spellCheck={false}
              />
              {createConfigError ? <p className="mt-2 text-xs text-red-600">{createConfigError}</p> : null}
            </div>

            <ToolSelectorAccordion
              title="Allowed tools"
              tools={availableTools}
              selected={form.allowed_tools}
              onChange={(next) => setForm((f) => ({ ...f, allowed_tools: next }))}
            />

            {providerIDs.length === 0 ? <p className="mt-3 text-xs text-gray-500">No providers are configured. Set provider API keys and restart.</p> : null}
            {generateCreateAgent.error ? <p className="mt-2 text-sm text-red-600">{String(generateCreateAgent.error)}</p> : null}
            {createAgent.error ? <p className="mt-2 text-sm text-red-600">{String(createAgent.error)}</p> : null}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="h-9 rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                onClick={() => setIsCreateOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-9 rounded-md bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
                disabled={providerIDs.length === 0 || !form.provider || !form.model || createAgent.isPending}
                onClick={() =>
                  createAgent.mutate({
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
                  })
                }
                type="button"
              >
                {createAgent.isPending ? 'Creating...' : 'Create agent'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ProviderModelCombobox({
  value,
  options,
  placeholder,
  disabled,
  onValueChange,
}: {
  value: string
  options: string[]
  placeholder: string
  disabled?: boolean
  onValueChange: (next: string) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const normalized = value.trim().toLowerCase()
  const filtered = useMemo(() => {
    const base = normalized
      ? options.filter((option) => option.toLowerCase().includes(normalized))
      : options
    return base.slice(0, 25)
  }, [options, normalized])

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(filtered.length - 1)
  }, [filtered.length, activeIndex])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const node = rootRef.current
      if (!node) return
      if (event.target instanceof Node && !node.contains(event.target)) setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <input
        className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 pr-9 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onFocus={() => {
          if (disabled) return
          setOpen(true)
        }}
        onClick={() => {
          if (disabled) return
          setOpen(true)
        }}
        onChange={(e) => {
          onValueChange(e.target.value)
          setOpen(true)
          setActiveIndex(-1)
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            setOpen(true)
            return
          }
          if (!open || filtered.length === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActiveIndex((idx) => Math.min(idx + 1, filtered.length - 1))
            return
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActiveIndex((idx) => Math.max(idx - 1, 0))
            return
          }
          if (e.key === 'Enter' && activeIndex >= 0 && activeIndex < filtered.length) {
            e.preventDefault()
            onValueChange(filtered[activeIndex])
            setOpen(false)
            return
          }
          if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      <button
        type="button"
        className="absolute inset-y-0 right-0 inline-flex w-9 items-center justify-center text-gray-400 transition-colors hover:text-gray-600 disabled:cursor-not-allowed disabled:text-gray-300"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle model suggestions"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-gray-500">No matching models</p>
          ) : (
            filtered.map((option, idx) => (
              <button
                key={option}
                type="button"
                className={`block w-full rounded px-2 py-1.5 text-left text-sm transition-colors ${idx === activeIndex ? 'bg-gray-100 text-gray-900' : 'text-gray-700 hover:bg-gray-50'}`}
                onMouseEnter={() => setActiveIndex(idx)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onValueChange(option)
                  setOpen(false)
                }}
              >
                {option}
              </button>
            ))
          )}
        </div>
      ) : null}
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

type AgentConfigPatch = {
  name?: string
  description?: string
  provider?: string
  model?: string
  system_prompt?: string
  starter_prompts_text?: string
  default_task?: string
  allowed_tools?: string[]
}

function parseAgentConfigText(text: string, format: 'yaml' | 'json'): { ok: true; patch: AgentConfigPatch } | { ok: false; error: string } {
  const raw = text.trim()
  if (!raw) return { ok: false, error: 'Agent config cannot be empty.' }
  const data = format === 'json' ? parseAgentConfigJSON(raw) : parseAgentConfigYAML(raw)
  if (data.ok === false) return { ok: false, error: data.error }
  const out: AgentConfigPatch = {}
  const value = data.value
  if (typeof value.name === 'string') out.name = value.name
  if (typeof value.description === 'string') out.description = value.description
  if (typeof value.system === 'string') out.system_prompt = value.system
  if (typeof value.default_task === 'string') out.default_task = value.default_task
  if (Array.isArray(value.starter_prompts)) out.starter_prompts_text = value.starter_prompts.map((v) => String(v)).join('\n')
  if (Array.isArray(value.tools)) {
    out.allowed_tools = value.tools
      .map((tool) => (tool && typeof tool === 'object' ? String((tool as Record<string, unknown>).type ?? '').trim() : ''))
      .filter(Boolean)
  }
  if (typeof value.model === 'string') {
    const parsedModel = parseModelFromConfig(value.model)
    out.provider = parsedModel.provider
    out.model = parsedModel.model
  }
  return { ok: true, patch: out }
}

function parseAgentConfigJSON(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'Agent config JSON must be an object.' }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `Invalid JSON: ${err.message}` : 'Invalid JSON.' }
  }
}

function parseAgentConfigYAML(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const lines = raw.split('\n')
    const out: Record<string, unknown> = {}
    let i = 0
    for (; i < lines.length; i++) {
      const line = lines[i]
      if (!line.trim() || line.trimStart().startsWith('#')) continue
      if (line.startsWith('  ')) continue
      const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
      if (!match) return { ok: false, error: `Invalid YAML near line ${i + 1}.` }
      const key = match[1]
      const inline = match[2]
      if (inline) {
        out[key] = parseYAMLScalar(inline)
        continue
      }
      const list: unknown[] = []
      let j = i + 1
      for (; j < lines.length; j++) {
        const child = lines[j]
        if (!child.trim()) continue
        if (!child.startsWith('  - ')) break
        const itemRaw = child.slice(4).trim()
        if (itemRaw.includes(':')) {
          const kv = itemRaw.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
          if (!kv) return { ok: false, error: `Invalid list item near line ${j + 1}.` }
          list.push({ [kv[1]]: parseYAMLScalar(kv[2]) })
        } else {
          list.push(parseYAMLScalar(itemRaw))
        }
      }
      out[key] = list
      i = j - 1
    }
    return { ok: true, value: out }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid YAML.' }
  }
}

function parseYAMLScalar(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === "''" || trimmed === '""') return ''
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1).replace(/''/g, "'")
  }
  return trimmed
}

function parseModelFromConfig(raw: string) {
  const normalized = raw.trim()
  if (!normalized) return { provider: 'openai', model: '' }
  const slash = normalized.indexOf('/')
  if (slash < 0) return { provider: 'openai', model: normalized }
  const providerPart = normalized.slice(0, slash).trim().toLowerCase()
  const modelPart = normalized.slice(slash + 1).trim()
  if (!providerPart) return { provider: 'openai', model: modelPart }
  if (providerPart === 'openai' || providerPart === 'anthropic') return { provider: providerPart, model: modelPart }
  return { provider: providerPart, model: modelPart }
}

function toSimpleYAML(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return value
      .map((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const entries = Object.entries(item as Record<string, unknown>)
          if (entries.length === 0) return `${pad}- {}`
          const [firstKey, firstVal] = entries[0]
          const firstLine = `${pad}- ${firstKey}: ${toSimpleYAMLScalar(firstVal)}`
          const restLines = entries
            .slice(1)
            .map(([k, v]) => `${'  '.repeat(indent + 1)}${k}: ${toSimpleYAMLScalar(v)}`)
            .join('\n')
          return restLines ? `${firstLine}\n${restLines}` : firstLine
        }
        return `${pad}- ${toSimpleYAMLScalar(item)}`
      })
      .join('\n')
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    return entries
      .map(([key, val]) => {
        if (Array.isArray(val)) {
          if (val.length === 0) return `${pad}${key}: []`
          return `${pad}${key}:\n${toSimpleYAML(val, indent + 1)}`
        }
        if (val && typeof val === 'object') {
          return `${pad}${key}:\n${toSimpleYAML(val, indent + 1)}`
        }
        return `${pad}${key}: ${toSimpleYAMLScalar(val)}`
      })
      .join('\n')
  }
  return `${pad}${toSimpleYAMLScalar(value)}`
}

function toSimpleYAMLScalar(value: unknown): string {
  if (value === null || value === undefined) return "''"
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const raw = String(value)
  if (!raw) return "''"
  if (/^[A-Za-z0-9._:/-]+$/.test(raw)) return raw
  return `'${raw.replace(/'/g, "''")}'`
}
