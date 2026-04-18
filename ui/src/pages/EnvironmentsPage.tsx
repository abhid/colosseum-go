import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { IconHelpCircle } from '@tabler/icons-react'
import { Card, EmptyState, ErrorBanner, LoadingState, QueryErrorState, SectionTitle } from '../components/Common'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../lib/tokens'
import { api } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

const INPUT_CLASSES = `h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm transition-colors focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 ${FOCUS_RING}`
const TEXTAREA_CLASSES = `w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm transition-colors focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 ${FOCUS_RING}`

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
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 ${FOCUS_RING}`}
              aria-label="Environment config help"
            >
              <IconHelpCircle className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute left-0 top-7 z-10 hidden w-[360px] rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700 shadow-lg group-hover:block group-focus-within:block">
              <p className="font-semibold text-gray-900">Config JSON options</p>
              <p className="mt-1 text-gray-600">
                Runs currently inject only <span className="font-mono text-[11px]">env_vars</span> from this config.
              </p>
              <pre className="mt-2 overflow-x-auto rounded-md bg-gray-900 p-2 font-mono text-[11px] text-gray-100">{`{
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
        <label htmlFor="env-name" className="sr-only">Environment name</label>
        <input
          id="env-name"
          className={INPUT_CLASSES}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Environment name"
        />
        <label htmlFor="env-desc" className="sr-only">Description</label>
        <input
          id="env-desc"
          className={`${INPUT_CLASSES} mt-3`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
        />
        <label htmlFor="env-config" className="sr-only">Config JSON</label>
        <textarea
          id="env-config"
          className={`${TEXTAREA_CLASSES} mt-3 h-24 font-mono text-xs`}
          value={config}
          onChange={(e) => setConfig(e.target.value)}
        />
        {parsedConfig.error ? <p className="mt-2 text-xs text-red-600" role="alert">Config JSON error: {parsedConfig.error}</p> : null}
        <div className="mt-4">
          <Button
            disabled={createEnvironment.isPending || Boolean(parsedConfig.error)}
            onClick={() => createEnvironment.mutate()}
          >
            {createEnvironment.isPending ? 'Creating…' : 'Create Environment'}
          </Button>
        </div>
        <ErrorBanner className="mt-2" title="Couldn't create environment" message={createEnvironment.error ? (createEnvironment.error as Error).message : undefined} />
      </Card>

      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Existing Environments</h3>
        {environments.isLoading ? <LoadingState label="Loading environments…" /> : null}
        <QueryErrorState title="Failed to load environments" query={environments} />
        {!environments.isLoading && !environments.isError && (environments.data ?? []).length === 0 ? <EmptyState title="No environments" body="Add reusable runtime environment profiles." /> : null}
        <div className="space-y-2">
          {(environments.data ?? []).map((env) => (
            <div key={String(env.id)} className="flex items-center justify-between rounded-md border border-gray-200 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{String(env.name)}</p>
                <p className="text-xs text-gray-500">{String(env.description || '')}</p>
              </div>
              <Button
                size="sm"
                variant="danger"
                disabled={deleteEnvironment.isPending}
                onClick={() => deleteEnvironment.mutate(String(env.id))}
              >
                Delete
              </Button>
            </div>
          ))}
        </div>
        <ErrorBanner className="mt-2" title="Couldn't delete environment" message={deleteEnvironment.error ? (deleteEnvironment.error as Error).message : undefined} />
      </Card>
    </div>
  )
}
