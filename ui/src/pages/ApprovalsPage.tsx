import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Card, EmptyState, ErrorBanner, LoadingState, QueryErrorState, SectionTitle, StatusBadge } from '../components/Common'
import { Button } from '../components/ui/Button'
import { useNavigate } from 'react-router-dom'
import { queryKeys } from '../lib/queryKeys'

export function ApprovalsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const runs = useQuery({ queryKey: queryKeys.runs, queryFn: api.listRuns, refetchInterval: 2000 })
  const waiting = (runs.data ?? []).filter((r) => r.status === 'interrupted')
  const approve = useMutation({
    mutationFn: (id: string) => api.approveRun(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.runs })
    },
  })

  return (
    <div className="space-y-4">
      <SectionTitle title="Approvals" subtitle="Review runs waiting for operator action." />
      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Pending Approval Queue</h3>
        {runs.isLoading ? <LoadingState label="Loading approvals…" /> : null}
        <QueryErrorState title="Failed to load approvals" query={runs} />
        {!runs.isLoading && !runs.isError && waiting.length === 0 ? <EmptyState title="No pending approvals" body="Interrupted runs requiring approval appear here." /> : (
          <div className="space-y-3">
            {waiting.map((r) => (
              <div key={r.id} className="rounded-lg border border-gray-200 p-4 transition-colors hover:border-gray-300">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{r.task}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{r.provider}/{r.model}</p>
                    <p className="mt-1 text-[11px] text-gray-500">{new Date(r.created_at).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    <Button size="sm" onClick={() => approve.mutate(r.id)} disabled={approve.isPending}>Approve</Button>
                    <Button size="sm" variant="secondary" onClick={() => navigate(`/runs/${r.id}`)}>Open</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <ErrorBanner className="mt-2" title="Couldn't approve run" message={approve.error ? (approve.error as Error).message : undefined} />
      </Card>
    </div>
  )
}
