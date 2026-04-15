import { useQuery } from '@tanstack/react-query'
import { Card, EmptyState, SectionTitle } from '../components/Common'
import { api } from '../lib/api'

export function SettingsPage() {
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.listProviders })

  return (
    <div className="space-y-4">
      <SectionTitle title="Settings" subtitle="Provider and environment status." />
      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Providers</h3>
        <div className="space-y-3">
          {(providers.data ?? []).length === 0 ? <EmptyState title="No providers detected" body="Configure provider credentials and restart the server." /> : (providers.data ?? []).map((p) => (
            <div key={p.provider} className="rounded-lg border border-gray-200 p-4 text-sm transition-colors hover:border-gray-300">
              <p className="font-medium capitalize text-gray-900">{p.provider}</p>
              <p className="mt-1 text-gray-500">Tools: {p.supports_tools ? 'Supported' : 'No'} • Streaming: {p.supports_streaming ? 'Supported' : 'No'}</p>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <h3 className="mb-2 text-sm font-semibold tracking-tight text-gray-900">Secrets</h3>
        <p className="text-sm text-gray-600">Configure provider keys with environment variables: <code className="font-mono rounded bg-gray-100 px-1 py-0.5 text-xs">OPENAI_API_KEY</code> and <code className="font-mono rounded bg-gray-100 px-1 py-0.5 text-xs">ANTHROPIC_API_KEY</code>.</p>
      </Card>
    </div>
  )
}
