import clsx from 'clsx'

import { FOCUS_RING } from '../../lib/tokens'
import type { AgentFormState } from '../../lib/agentForm'
import { validateContractPayload } from '../../lib/agentForm'

const TYPES: Array<{ id: AgentFormState['output_contract_type']; label: string; hint: string }> = [
  { id: 'none', label: 'None', hint: 'Agent output is free-form text.' },
  { id: 'json_schema', label: 'JSON schema', hint: 'Validate final output against a JSON schema.' },
  { id: 'regex', label: 'Regex', hint: 'Validate final output against a regular expression.' },
]

export function OutputContractField({
  type,
  payload,
  onChange,
}: {
  type: AgentFormState['output_contract_type']
  payload: string
  onChange: (next: { type: AgentFormState['output_contract_type']; payload: string }) => void
}) {
  const error = validateContractPayload(type, payload)
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Output contract type" className="grid gap-2 md:grid-cols-3">
        {TYPES.map((t) => {
          const active = type === t.id
          return (
            <button
              key={t.id}
              role="radio"
              type="button"
              aria-checked={active}
              onClick={() => onChange({ type: t.id, payload })}
              className={clsx(
                'rounded-md border p-3 text-left transition-colors',
                FOCUS_RING,
                active
                  ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900'
                  : 'border-gray-200 bg-white hover:border-gray-300',
              )}
            >
              <span className="block text-sm font-semibold text-gray-900">{t.label}</span>
              <span className="mt-1 block text-xs leading-snug text-gray-500">{t.hint}</span>
            </button>
          )
        })}
      </div>
      {type !== 'none' ? (
        <div>
          <label htmlFor="contract-payload" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {type === 'json_schema' ? 'JSON schema' : 'Regex pattern'}
          </label>
          <textarea
            id="contract-payload"
            spellCheck={false}
            className={clsx(
              'w-full rounded-md border bg-white px-3 py-2 font-mono text-xs leading-relaxed transition-colors focus:outline-none focus:ring-1',
              FOCUS_RING,
              error
                ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                : 'border-gray-300 focus:border-gray-900 focus:ring-gray-900',
              type === 'json_schema' ? 'h-40' : 'h-20',
            )}
            placeholder={
              type === 'json_schema'
                ? '{ "type": "object", "required": ["summary"], "properties": { "summary": { "type": "string" } } }'
                : '^SUMMARY:.+'
            }
            value={payload}
            onChange={(e) => onChange({ type, payload: e.target.value })}
          />
          {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
