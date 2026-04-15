import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Card, EmptyState, SectionTitle, StatusBadge } from '../components/Common'
import { useNavigate } from 'react-router-dom'

export function ApprovalsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const runs = useQuery({ queryKey: ['runs'], queryFn: api.listRuns, refetchInterval: 2000 })
  const waiting = (runs.data ?? []).filter((r) => r.status === 'interrupted')
  const approve = useMutation({
    mutationFn: (id: string) => api.approveRun(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] })
    },
  })

  return (
    <div className="space-y-4">
      <SectionTitle title="Approvals" subtitle="Review runs waiting for operator action." />
      <Card>
        <h3 className="mb-3 text-sm font-semibold tracking-tight">Pending Approval Queue</h3>
        {waiting.length === 0 ? <EmptyState title="No pending approvals" body="Interrupted runs requiring approval appear here." /> : (
          <div className="space-y-2">
            {waiting.map((r) => (
              <div key={r.id} className="rounded border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{r.task}</p>
                    <p className="text-xs text-slate-600">{r.provider}:{r.model}</p>
                    <p className="text-[11px] text-slate-500">{new Date(r.created_at).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    <button onClick={() => approve.mutate(r.id)} className="h-8 rounded-md bg-indigo-600 px-3 text-xs font-medium text-white disabled:opacity-50" disabled={approve.isPending}>Approve</button>
                    <button onClick={() => navigate(`/runs/${r.id}`)} className="h-8 rounded-md border border-slate-300 px-3 text-xs font-medium hover:bg-slate-50">Open</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
