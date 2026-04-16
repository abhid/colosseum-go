import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconPencil, IconSparkles, IconTrash } from '@tabler/icons-react'
import { api } from '../lib/api'
import { Card, EmptyState, LoadingState, QueryErrorState, SectionTitle } from '../components/Common'
import { queryKeys } from '../lib/queryKeys'
import { ProviderModelCombobox } from '../components/ProviderModelCombobox'
import { ToolSelectorAccordion } from '../components/ToolSelectorAccordion'
import {
  parseAgentConfigText,
  parseStarterPrompts,
  toSimpleYAML,
  pickPreferredOpenAIModel,
  formatProviderModel,
  parseProviderModelInput,
} from '../lib/agentConfig'

export function AgentsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const agents = useQuery({ queryKey: queryKeys.agents, queryFn: api.listAgents })
  const toolsQ = useQuery({ queryKey: queryKeys.tools, queryFn: api.listTools })
  const providersQ = useQuery({ queryKey: queryKeys.providers, queryFn: api.listProviders })
  const availableTools = useMemo(
    () =>
      (toolsQ.data ?? [])
        .filter((t) => t.enabled)
        .map((t) => ({ name: t.name, description: t.description, isBuiltin: t.is_builtin })),
    [toolsQ.data],
  )
  const providerIDs = useMemo(() => (providersQ.data ?? []).map((p) => p.provider), [providersQ.data])
  const openAIModelsQ = useQuery({
    queryKey: queryKeys.openAIModels,
    queryFn: api.listOpenAIModels,
    enabled: providerIDs.includes('openai'),
  })
  const openAIModels = useMemo(() => openAIModelsQ.data ?? [], [openAIModelsQ.data])
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
      qc.invalidateQueries({ queryKey: queryKeys.agents })
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
      qc.invalidateQueries({ queryKey: queryKeys.agents })
    },
  })
  const deleteAgent = useMutation({
    mutationFn: (payload: { id: string; force?: boolean }) => api.deleteAgent(payload.id, payload.force ?? false),
    onSuccess: () => {
      setDeleteError('')
      if (editId) setEditId('')
      qc.invalidateQueries({ queryKey: queryKeys.agents })
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
        <QueryErrorState title="Failed to load agents" query={agents} />
        <QueryErrorState title="Failed to load tools" query={toolsQ} />
        <QueryErrorState title="Failed to load providers" query={providersQ} />
        {agents.isLoading ? <LoadingState label="Loading agents..." /> : null}
        {deleteError ? (
          <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{deleteError}</p>
        ) : null}
        {!agents.isLoading && !agents.isError && (agents.data ?? []).length === 0 ? <EmptyState title="No agents" body="Create an agent profile to start runs." /> : (
          <div className="space-y-3">
            {(agents.data ?? []).map((a) => (
              <div key={a.id} className="group cursor-pointer rounded-lg border border-gray-200 p-4 transition-colors hover:border-gray-300" onClick={() => navigate(`/agents/${a.id}`)}>
                {editId === a.id ? (
                  <div className="space-y-3">
                    <div className="grid gap-2">
                      <input className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                      <input className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900" value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
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
                      <textarea className="h-24 w-full rounded-md border border-gray-300 bg-white px-3 py-2 pr-28 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900" value={editForm.system_prompt} onChange={(e) => setEditForm((f) => ({ ...f, system_prompt: e.target.value }))} />
                      <button
                        className="absolute bottom-3 right-3 inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-100 disabled:opacity-50"
                        disabled={!editForm.provider || enhanceEditPrompt.isPending}
                        onClick={() => enhanceEditPrompt.mutate()}
                        type="button"
                      >
                        <IconSparkles className="h-3.5 w-3.5" />
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
                      className="h-20 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                      placeholder="Starter prompts (one per line)"
                      value={editForm.starter_prompts_text}
                      onChange={(e) => setEditForm((f) => ({ ...f, starter_prompts_text: e.target.value }))}
                    />
                    <textarea
                      className="h-20 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
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
                          <IconPencil className="h-3.5 w-3.5" />
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
                                  `Agent "${a.name}" has runs.\n\nForce delete will permanently remove all run history for this agent.\n\nContinue?`,
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
                          <IconTrash className="h-3.5 w-3.5" />
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
                    className="h-20 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
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
                  <IconSparkles className="h-3.5 w-3.5" />
                  {createStartingPoint === 'template'
                    ? (generateCreateAgent.isPending ? 'Applying...' : 'Apply notes')
                    : (generateCreateAgent.isPending ? 'Generating...' : 'Generate')}
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <h4 className="text-sm font-semibold tracking-tight text-gray-900">Core settings</h4>
              <input className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900" placeholder="Agent name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
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
                className="h-56 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs leading-relaxed text-gray-700 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
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

