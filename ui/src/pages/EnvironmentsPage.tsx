import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { IconHelpCircle } from '@tabler/icons-react'
import { Card, EmptyState, LoadingState, QueryErrorState, SectionTitle } from '../components/Common'
import { api } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

export function EnvironmentsPage() {
  const qc = useQueryClient()
  const environments = useQuery({ queryKey: queryKeys.environments, queryFn: api.listEnvironments })
  const [name, setName] = useState('default-linux')
  const [description, setDescription] = useState('Default isolated execution environment')
  const [config, setConfig] = useState('{"packages":["git","node","python3"],"network":"restricted"}')

  const parsedConfig = useMemo(() => {
    try {
      return { value: JSON.parse(config) as Record<string, unknown>, error: '' }
    } catch (err) {
      return { value: null, error: err instanceof Error ? err.message : 'Invalid JSON' }
    }
  }, [config])

  const createEnvironment = useMutation({
    mutationFn: () => {
      if (!parsedConfig.value) throw new Error(`Config must be valid JSON: ${parsedConfig.error}`)
      return api.createEnvironment({ name, description, config: parsedConfig.value, enabled: true })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.environments }),
  })
  const deleteEnvironment = useMutation({
    mutationFn: (id: string) => api.deleteEnvironment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.environments }),
  })

  return (
    <div className="space-y-4">
      <SectionTitle title="Environments" subtitle="Manage runtime profiles used by runs." />
      <Card>
        <div className="mb-4 flex items-center gap-2">
          <h3 className="text-sm font-semibold tracking-tight text-gray-900">Create Environment</h3>
          <div className="group relative">
            <button
              type="button"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300"
              aria-label="Environment config help"
            >
              <IconHelpCircle className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute left-0 top-7 z-10 hidden w-[360px] rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700 shadow-lg group-hover:block group-focus-within:block">
              <p className="font-semibold text-gray-900">Config JSON options</p>
              <p className="mt-1 text-gray-600">
                Runs currently inject only <span className="font-mono text-[11px]">env_vars</span> from this config.
              </p>
              <pre className="mt-2 overflow-x-auto rounded bg-gray-900 p-2 font-mono text-[11px] text-gray-100">{`{
  "env_vars": {
    "NODE_ENV": "production",
    "API_BASE_URL": "https://api.example.com"
  }
}`}</pre>
              <p className="mt-2 text-gray-600">
                Other keys can be stored for future use, but are not injected into runtime yet.
              </p>
            </div>
          </div>
        </div>
        <input
          className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Environment name"
        />
        <input
          className="mt-3 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
        />
        <textarea
          className="mt-3 h-24 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
          value={config}
          onChange={(e) => setConfig(e.target.value)}
        />
        {parsedConfig.error ? <p className="mt-2 text-xs text-red-600">Config JSON error: {parsedConfig.error}</p> : null}
        <button
          className="mt-4 h-9 rounded-md bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
          disabled={createEnvironment.isPending || Boolean(parsedConfig.error)}
          onClick={() => createEnvironment.mutate()}
        >
          {createEnvironment.isPending ? 'Creating...' : 'Create Environment'}
        </button>
        {createEnvironment.error ? <p className="mt-2 text-sm text-red-600">{String(createEnvironment.error)}</p> : null}
      </Card>

      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Existing Environments</h3>
        {environments.isLoading ? <LoadingState label="Loading environments..." /> : null}
        <QueryErrorState title="Failed to load environments" query={environments} />
        {!environments.isLoading && !environments.isError && (environments.data ?? []).length === 0 ? <EmptyState title="No environments" body="Add reusable runtime environment profiles." /> : null}
        <div className="space-y-2">
          {(environments.data ?? []).map((env) => (
            <div key={String(env.id)} className="flex items-center justify-between rounded border border-gray-200 p-2 text-sm">
              <div>
                <p className="font-medium text-gray-900">{String(env.name)}</p>
                <p className="text-xs text-gray-500">{String(env.description || '')}</p>
              </div>
              <button
                className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                disabled={deleteEnvironment.isPending}
                onClick={() => deleteEnvironment.mutate(String(env.id))}
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
