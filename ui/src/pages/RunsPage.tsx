import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { Card, EmptyState, SectionTitle, StatusBadge } from '../components/Common'

export function RunsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [form, setForm] = useState({ agent_id: '', task: '' })

  const agents = useQuery({ queryKey: ['agents'], queryFn: api.listAgents })
  const runs = useQuery({ queryKey: ['runs'], queryFn: api.listRuns, refetchInterval: 2000 })

  const createRun = useMutation({
    mutationFn: api.createRun,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      navigate(`/runs/${res.id}`)
    },
  })

  const sortedRuns = useMemo(() => (runs.data ?? []).slice().sort((a, b) => (a.created_at > b.created_at ? -1 : 1)), [runs.data])

  return (
    <div className="space-y-4">
      <SectionTitle title="Runs" subtitle="Submit and monitor long-running agent tasks." />
      <Card>
        <h3 className="mb-3 text-sm font-semibold tracking-tight">Create Run</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <select className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm" value={form.agent_id} onChange={(e) => setForm((f) => ({ ...f, agent_id: e.target.value }))}>
            <option value="">Select agent</option>
            {(agents.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.provider}:{a.model})</option>
            ))}
          </select>
          <button
            className="h-9 rounded-md bg-indigo-600 px-3 text-sm font-medium text-white disabled:opacity-50"
            disabled={createRun.isPending}
            onClick={() => createRun.mutate({ agent_id: form.agent_id, task: form.task })}
          >
            {createRun.isPending ? 'Creating...' : 'Start Run'}
          </button>
        </div>
        <textarea className="mt-3 min-h-[96px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Task" value={form.task} onChange={(e) => setForm((f) => ({ ...f, task: e.target.value }))} />
        {createRun.error ? <p className="mt-2 text-sm text-rose-700">{String(createRun.error)}</p> : null}
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold tracking-tight">Recent Runs</h3>
        {runs.isLoading ? <p className="text-sm text-slate-600">Loading runs...</p> : null}
        {sortedRuns.length === 0 ? <EmptyState title="No runs yet" body="Create your first run to start execution." /> : null}
        {sortedRuns.length > 0 ? (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/80">
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2">Status</th><th className="py-2">Task</th><th className="py-2">Provider</th><th className="py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {sortedRuns.map((run) => (
                  <tr key={run.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50/80" onClick={() => navigate(`/runs/${run.id}`)}>
                    <td className="px-2 py-2"><StatusBadge status={run.status} /></td>
                    <td className="px-2 py-2 text-slate-700">{run.task.slice(0, 110)}</td>
                    <td className="px-2 py-2 text-slate-600">{run.provider}:{run.model}</td>
                    <td className="px-2 py-2 text-slate-600">{new Date(run.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  )
}
