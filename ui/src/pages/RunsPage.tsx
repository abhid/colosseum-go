import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { Card, EmptyState, LoadingState, QueryErrorState, SectionTitle, StatusBadge } from '../components/Common'
import { queryKeys } from '../lib/queryKeys'

export function RunsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [form, setForm] = useState({
    title: '',
    agent_id: '',
    task: '',
    environment_id: '',
    credential_vault_id: '',
  })
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])

  const agents = useQuery({ queryKey: queryKeys.agents, queryFn: api.listAgents })
  const environments = useQuery({ queryKey: queryKeys.environments, queryFn: api.listEnvironments })
  const vaults = useQuery({ queryKey: queryKeys.credentialVaults, queryFn: api.listCredentialVaults })
  const runs = useQuery({ queryKey: queryKeys.runs, queryFn: api.listRuns, refetchInterval: 2000 })

  const createRun = useMutation({
    mutationFn: async () => {
      const task = form.task.trim() || form.title.trim()
      if (!form.agent_id) throw new Error('Select an agent')
      if (!task) throw new Error('Title or task is required')
      const created = await api.createRun({
        agent_id: form.agent_id,
        task,
        environment_id: form.environment_id || undefined,
        credential_vault_id: form.credential_vault_id || undefined,
      })
      if (selectedFiles.length > 0) {
        await api.uploadSessionFiles(created.id, selectedFiles)
      }
      return created
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: queryKeys.runs })
      setIsCreateOpen(false)
      setSelectedFiles([])
      setForm({ title: '', agent_id: '', task: '', environment_id: '', credential_vault_id: '' })
      navigate(`/sessions/${res.id}`)
    },
  })

  const sortedRuns = useMemo(() => (runs.data ?? []).slice().sort((a, b) => (a.created_at > b.created_at ? -1 : 1)), [runs.data])
  const selectedAgent = useMemo(() => (agents.data ?? []).find((a) => a.id === form.agent_id), [agents.data, form.agent_id])

  useEffect(() => {
    if (!isCreateOpen) return
    if (form.agent_id) return
    const firstAgentID = (agents.data ?? [])[0]?.id
    if (!firstAgentID) return
    setForm((current) => ({ ...current, agent_id: firstAgentID }))
  }, [isCreateOpen, form.agent_id, agents.data])

  useEffect(() => {
    if (!selectedAgent) return
    setForm((current) => ({
      ...current,
      task: current.task || selectedAgent.default_task || '',
    }))
  }, [selectedAgent])

  return (
    <div className="space-y-4">
      <SectionTitle title="Sessions" subtitle="Start and monitor long-lived agent sessions." />
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-gray-900">Create Session</h3>
            <p className="mt-1 text-xs text-gray-500">Spin up a long-lived instance of your agent in its environment.</p>
          </div>
          <button
            className="h-9 rounded-md bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-800"
            onClick={() => setIsCreateOpen(true)}
          >
            New Session
          </button>
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Recent Sessions</h3>
        {runs.isLoading ? <LoadingState label="Loading sessions..." /> : null}
        <QueryErrorState title="Failed to load sessions" query={runs} />
        {!runs.isLoading && !runs.isError && sortedRuns.length === 0 ? <EmptyState title="No sessions yet" body="Create your first session to start execution." /> : null}
        {sortedRuns.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50">
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Task</th><th className="px-4 py-3 font-medium">Provider</th><th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {sortedRuns.map((run) => (
                  <tr key={run.id} className="cursor-pointer border-b border-gray-100 transition-colors hover:bg-gray-50/80 last:border-0" onClick={() => navigate(`/sessions/${run.id}`)}>
                    <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
                    <td className="px-4 py-3 text-gray-700 font-medium">{run.task.slice(0, 110)}</td>
                    <td className="px-4 py-3 text-gray-500">{run.provider}/{run.model}</td>
                    <td className="px-4 py-3 text-gray-500">{new Date(run.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {isCreateOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-brightness-75">
          <div role="dialog" aria-modal="true" className="w-full max-w-3xl rounded-2xl border border-gray-200 bg-white p-5 shadow-xl md:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-gray-900">Create session</h3>
                <p className="mt-1 text-sm text-gray-500">Set up an instance of your agent in its environment.</p>
              </div>
              <button
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                onClick={() => setIsCreateOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <input
                className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                placeholder="Title (optional)"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
              <select
                className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                value={form.agent_id}
                onChange={(e) => {
                  const nextAgentID = e.target.value
                  const nextAgent = (agents.data ?? []).find((a) => a.id === nextAgentID)
                  setForm((f) => ({
                    ...f,
                    agent_id: nextAgentID,
                    task: f.task || nextAgent?.default_task || '',
                  }))
                }}
              >
                <option value="">Select agent</option>
                {(agents.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.provider}/{a.model})</option>
                ))}
              </select>
            </div>

            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-medium uppercase tracking-wide text-gray-500">Environment</label>
                  <Link to="/environments" className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700">Manage environments</Link>
                </div>
                <select
                  className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                  value={form.environment_id}
                  onChange={(e) => setForm((f) => ({ ...f, environment_id: e.target.value }))}
                >
                  <option value="">default</option>
                  {(environments.data ?? []).map((env) => (
                    <option key={String(env.id)} value={String(env.id)}>{String(env.name || env.id)}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-medium uppercase tracking-wide text-gray-500">Credential vault</label>
                  <Link to="/credential-vaults" className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700">Manage vaults</Link>
                </div>
                <select
                  className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                  value={form.credential_vault_id}
                  onChange={(e) => setForm((f) => ({ ...f, credential_vault_id: e.target.value }))}
                >
                  <option value="">none</option>
                  {(vaults.data ?? []).map((vault) => (
                    <option key={String(vault.id)} value={String(vault.id)}>{String(vault.name || vault.id)}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-gray-500">
                  Vault-bound secrets are exposed to the session as environment variables.
                </p>
              </div>
            </div>

            <textarea
              className="mt-3 min-h-[120px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
              placeholder="Task"
              value={form.task}
              onChange={(e) => setForm((f) => ({ ...f, task: e.target.value }))}
            />
            {selectedAgent && selectedAgent.starter_prompts.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedAgent.starter_prompts.slice(0, 6).map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] text-gray-600 transition-colors hover:bg-gray-100"
                    onClick={() => setForm((f) => ({ ...f, task: prompt }))}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-3 rounded-md border border-dashed border-gray-300 bg-gray-50 p-3">
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-gray-500">Upload files (optional)</label>
              <input
                type="file"
                multiple
                className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-gray-700 hover:file:bg-gray-50"
                onChange={(e) => setSelectedFiles(Array.from(e.target.files ?? []))}
              />
              {selectedFiles.length > 0 ? (
                <p className="mt-2 text-xs text-gray-500">{selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'} selected</p>
              ) : null}
            </div>

            {createRun.error ? <p className="mt-3 text-sm text-red-600">{String(createRun.error)}</p> : null}

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
                disabled={createRun.isPending}
                onClick={() => createRun.mutate()}
                type="button"
              >
                {createRun.isPending ? 'Creating...' : 'Create session'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
