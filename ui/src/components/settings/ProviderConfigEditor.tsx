import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconPlugConnected, IconTrash } from '@tabler/icons-react'
import clsx from 'clsx'

import { Button } from '../ui/Button'
import { ErrorBanner } from '../Common'
import { FOCUS_RING } from '../../lib/tokens'
import { api } from '../../lib/api'
import { queryKeys } from '../../lib/queryKeys'
import type { ProviderConfig, ProviderConfigTestResult, ProviderInfo } from '../../lib/types'

const INPUT_CLASSES = `h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm transition-colors focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 ${FOCUS_RING}`
const EYEBROW = 'text-[11px] font-semibold uppercase tracking-wide text-gray-500'
const DEFAULT_CONFIG = `{
  "api_key": "",
  "base_url": ""
}`

type Mode = 'create' | 'edit'

export function ProviderConfigEditor({
  mode,
  existing,
  availableProviders,
  onClose,
}: {
  mode: Mode
  existing?: ProviderConfig
  availableProviders: ProviderInfo[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [provider, setProvider] = useState<string>(existing?.provider ?? availableProviders[0]?.provider ?? '')
  const [name, setName] = useState<string>(existing?.name ?? '')
  const [configText, setConfigText] = useState<string>(() =>
    existing ? prettifyJSON(existing.config_json) : DEFAULT_CONFIG,
  )
  const [testResult, setTestResult] = useState<ProviderConfigTestResult | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const parseError = useMemo(() => {
    if (!configText.trim()) return ''
    try {
      JSON.parse(configText)
      return ''
    } catch (err) {
      return err instanceof Error ? err.message : 'Invalid JSON'
    }
  }, [configText])

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        provider: provider.trim(),
        name: name.trim(),
        config: configText.trim() ? JSON.parse(configText) : {},
      }
      if (mode === 'create') return api.createProviderConfig(payload)
      return api.updateProviderConfig(existing!.id, payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.providerConfigs })
      onClose()
    },
  })

  const test = useMutation({
    mutationFn: () => api.testProviderConfig(existing!.id),
    onSuccess: (out) => setTestResult(out),
  })

  const canSave = !parseError && provider.trim().length > 0 && name.trim().length > 0 && !save.isPending

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && canSave) {
        e.preventDefault()
        save.mutate()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canSave, onClose, save])

  return (
    <form
      ref={formRef}
      className="space-y-3 rounded-lg border border-gray-300 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSave) save.mutate()
      }}
    >
      <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
        <div>
          <label htmlFor="pc-provider" className={`mb-1 block ${EYEBROW}`}>
            Provider
          </label>
          <select
            id="pc-provider"
            className={INPUT_CLASSES}
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            disabled={mode === 'edit'}
          >
            {availableProviders.length === 0 ? <option value="">(none detected)</option> : null}
            {availableProviders.map((p) => (
              <option key={p.provider} value={p.provider}>
                {p.provider}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pc-name" className={`mb-1 block ${EYEBROW}`}>
            Name
          </label>
          <input
            id="pc-name"
            className={INPUT_CLASSES}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. anthropic-prod"
          />
        </div>
      </div>
      <div>
        <label htmlFor="pc-config" className={`mb-1 block ${EYEBROW}`}>
          Config (JSON)
        </label>
        <textarea
          id="pc-config"
          spellCheck={false}
          className={clsx(
            'h-36 w-full rounded-md border bg-white px-3 py-2 font-mono text-xs leading-relaxed transition-colors focus:outline-none focus:ring-1',
            FOCUS_RING,
            parseError
              ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:border-gray-900 focus:ring-gray-900',
          )}
          value={configText}
          onChange={(e) => setConfigText(e.target.value)}
        />
        {parseError ? (
          <p className="mt-1 text-xs text-red-600">{parseError}</p>
        ) : (
          <p className="mt-1 text-[11px] text-gray-500">
            Supported keys: <code className="font-mono">api_key</code>, <code className="font-mono">base_url</code>.
            Empty values fall through to environment variables.
          </p>
        )}
      </div>
      <ErrorBanner
        title={mode === 'create' ? "Couldn't create configuration" : "Couldn't save configuration"}
        message={save.error ? (save.error as Error).message : undefined}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {mode === 'edit' ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => test.mutate()}
                disabled={test.isPending}
                leadingIcon={<IconPlugConnected className="h-3.5 w-3.5" />}
              >
                {test.isPending ? 'Testing…' : 'Test connection'}
              </Button>
              <TestResultChip result={testResult} pending={test.isPending} error={test.error as Error | null} />
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!canSave}>
            {save.isPending ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </div>
      </div>
    </form>
  )
}

function TestResultChip({
  result,
  pending,
  error,
}: {
  result: ProviderConfigTestResult | null
  pending: boolean
  error: Error | null
}) {
  if (pending) return null
  if (error) {
    return (
      <span
        className="max-w-[260px] truncate rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700"
        title={error.message}
      >
        failed · {error.message}
      </span>
    )
  }
  if (!result) return null
  const cls = result.ok
    ? 'border-green-200 bg-green-50 text-green-700'
    : 'border-red-200 bg-red-50 text-red-700'
  return (
    <span
      className={clsx('max-w-[260px] truncate rounded-full border px-2 py-0.5 text-[11px] font-medium', cls)}
      title={result.message}
    >
      {result.ok ? `ok · ${result.latency_ms}ms` : `failed · ${result.message}`}
    </span>
  )
}

export function DeleteConfigButton({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const qc = useQueryClient()
  const del = useMutation({
    mutationFn: () => api.deleteProviderConfig(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.providerConfigs })
      onDeleted()
    },
  })
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={del.isPending}
      onClick={() => {
        if (!window.confirm('Delete this provider configuration?')) return
        del.mutate()
      }}
      leadingIcon={<IconTrash className="h-3.5 w-3.5" />}
    >
      {del.isPending ? 'Deleting…' : 'Delete'}
    </Button>
  )
}

function prettifyJSON(raw: string): string {
  if (!raw) return DEFAULT_CONFIG
  try {
    const parsed = JSON.parse(raw)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}
