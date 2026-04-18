import type { PlanningMode } from '../../lib/types'
import { FOCUS_RING } from '../../lib/tokens'
import clsx from 'clsx'

const MODES: Array<{ id: PlanningMode; label: string; description: string }> = [
  { id: 'off', label: 'Off', description: 'No planning nudge. The agent plans however it wants.' },
  { id: 'suggest', label: 'Suggest', description: 'Primer reminds the agent that a plan is encouraged for multi-step work.' },
  { id: 'required', label: 'Required', description: 'Primer instructs the agent to create a plan before its first non-read tool call.' },
]

export function PlanningModeField({
  value,
  onChange,
}: {
  value: PlanningMode
  onChange: (next: PlanningMode) => void
}) {
  return (
    <div role="radiogroup" aria-label="Planning mode" className="grid gap-2 md:grid-cols-3">
      {MODES.map((mode) => {
        const active = value === mode.id
        return (
          <button
            key={mode.id}
            role="radio"
            type="button"
            aria-checked={active}
            onClick={() => onChange(mode.id)}
            className={clsx(
              'rounded-md border p-3 text-left transition-colors',
              FOCUS_RING,
              active
                ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900'
                : 'border-gray-200 bg-white hover:border-gray-300',
            )}
          >
            <span className="block text-sm font-semibold text-gray-900">{mode.label}</span>
            <span className="mt-1 block text-xs leading-snug text-gray-500">{mode.description}</span>
          </button>
        )
      })}
    </div>
  )
}
