import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Card, EmptyState, LoadingState, QueryErrorState, SectionTitle } from '../components/Common'
import { api } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

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
      <SectionTitle title="Policies" subtitle="Define governance and safety rules for sessions." />
      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Create Policy</h3>
        <input
          className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Policy name"
        />
        <textarea
          className="mt-3 h-24 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
          value={definition}
          onChange={(e) => setDefinition(e.target.value)}
        />
        {parsedDefinition.error ? <p className="mt-2 text-xs text-red-600">Definition JSON error: {parsedDefinition.error}</p> : null}
        <button
          className="mt-4 h-9 rounded-md bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
          disabled={createPolicy.isPending || Boolean(parsedDefinition.error)}
          onClick={() => createPolicy.mutate()}
        >
          {createPolicy.isPending ? 'Creating...' : 'Create Policy'}
        </button>
        {createPolicy.error ? <p className="mt-2 text-sm text-red-600">{String(createPolicy.error)}</p> : null}
      </Card>

      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Existing Policies</h3>
        {policies.isLoading ? <LoadingState label="Loading policies..." /> : null}
        <QueryErrorState title="Failed to load policies" query={policies} />
        {!policies.isLoading && !policies.isError && (policies.data ?? []).length === 0 ? <EmptyState title="No policies" body="Create policy rules for governance." /> : null}
        <div className="space-y-2">
          {(policies.data ?? []).map((policy) => (
            <div key={String(policy.id)} className="flex items-center justify-between rounded border border-gray-200 p-2 text-sm">
              <span>{String(policy.name)}</span>
              <button
                className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                disabled={deletePolicy.isPending}
                onClick={() => deletePolicy.mutate(String(policy.id))}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
