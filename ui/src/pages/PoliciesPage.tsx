import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Card, EmptyState, ErrorBanner, LoadingState, QueryErrorState, SectionTitle } from '../components/Common'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../lib/tokens'
import { api } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

const INPUT_CLASSES = `h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm transition-colors focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 ${FOCUS_RING}`
const TEXTAREA_CLASSES = `w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm transition-colors focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 ${FOCUS_RING}`

export function PoliciesPage() {
  const qc = useQueryClient()
  const policies = useQuery({ queryKey: queryKeys.policies, queryFn: api.listPolicies })
  const [name, setName] = useState('Default Safety')
  const [definition, setDefinition] = useState('{"deny_commands":["rm -rf /"]}')

  const parsedDefinition = useMemo(() => {
    try {
      return { value: JSON.parse(definition) as Record<string, unknown>, error: '' }
    } catch (err) {
      return { value: null, error: err instanceof Error ? err.message : 'Invalid JSON' }
    }
  }, [definition])

  const createPolicy = useMutation({
    mutationFn: () => {
      if (!parsedDefinition.value) throw new Error(`Definition must be valid JSON: ${parsedDefinition.error}`)
      return api.createPolicy({ name, definition: parsedDefinition.value, enabled: true })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.policies }),
  })
  const deletePolicy = useMutation({
    mutationFn: (id: string) => api.deletePolicy(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.policies }),
  })

  return (
    <div className="space-y-4">
      <SectionTitle title="Policies" subtitle="Define governance and safety rules for runs." />
      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Create Policy</h3>
        <label htmlFor="policy-name" className="sr-only">Policy name</label>
        <input
          id="policy-name"
          className={INPUT_CLASSES}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Policy name"
        />
        <label htmlFor="policy-definition" className="sr-only">Definition JSON</label>
        <textarea
          id="policy-definition"
          className={`${TEXTAREA_CLASSES} mt-3 h-24 font-mono text-xs`}
          value={definition}
          onChange={(e) => setDefinition(e.target.value)}
        />
        {parsedDefinition.error ? <p className="mt-2 text-xs text-red-600" role="alert">Definition JSON error: {parsedDefinition.error}</p> : null}
        <div className="mt-4">
          <Button
            disabled={createPolicy.isPending || Boolean(parsedDefinition.error)}
            onClick={() => createPolicy.mutate()}
          >
            {createPolicy.isPending ? 'Creating…' : 'Create Policy'}
          </Button>
        </div>
        <ErrorBanner className="mt-2" title="Couldn't create policy" message={createPolicy.error ? (createPolicy.error as Error).message : undefined} />
      </Card>

      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Existing Policies</h3>
        {policies.isLoading ? <LoadingState label="Loading policies…" /> : null}
        <QueryErrorState title="Failed to load policies" query={policies} />
        {!policies.isLoading && !policies.isError && (policies.data ?? []).length === 0 ? <EmptyState title="No policies" body="Create policy rules for governance." /> : null}
        <div className="space-y-2">
          {(policies.data ?? []).map((policy) => (
            <div key={String(policy.id)} className="flex items-center justify-between rounded-md border border-gray-200 p-3 text-sm">
              <span className="font-medium text-gray-900">{String(policy.name)}</span>
              <Button
                size="sm"
                variant="danger"
                disabled={deletePolicy.isPending}
                onClick={() => deletePolicy.mutate(String(policy.id))}
              >
                Delete
              </Button>
            </div>
          ))}
        </div>
        <ErrorBanner className="mt-2" title="Couldn't delete policy" message={deletePolicy.error ? (deletePolicy.error as Error).message : undefined} />
      </Card>
    </div>
  )
}
