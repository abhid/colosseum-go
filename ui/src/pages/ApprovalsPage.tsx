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
      <SectionTitle title="Approvals" subtitle="Review sessions waiting for operator action." />
      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Pending Approval Queue</h3>
        {waiting.length === 0 ? <EmptyState title="No pending approvals" body="Interrupted sessions requiring approval appear here." /> : (
          <div className="space-y-3">
            {waiting.map((r) => (
              <div key={r.id} className="rounded-lg border border-gray-200 p-4 transition-colors hover:border-gray-300">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{r.task}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{r.provider}/{r.model}</p>
                    <p className="mt-1 text-[11px] text-gray-400">{new Date(r.created_at).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    <button onClick={() => approve.mutate(r.id)} className="h-8 rounded-md bg-gray-900 px-3 text-xs font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50" disabled={approve.isPending}>Approve</button>
                    <button onClick={() => navigate(`/sessions/${r.id}`)} className="h-8 rounded-md border border-gray-300 px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50">Open</button>
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
