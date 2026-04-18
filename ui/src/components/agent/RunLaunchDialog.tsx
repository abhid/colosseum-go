import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import clsx from 'clsx'

import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { ErrorBanner } from '../Common'
import { FOCUS_RING } from '../../lib/tokens'
import { api } from '../../lib/api'

const INPUT_CLASSES = `h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm transition-colors focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 ${FOCUS_RING}`
const TEXTAREA_CLASSES = `w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm transition-colors focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 ${FOCUS_RING}`
const EYEBROW = 'text-[11px] font-semibold uppercase tracking-wide text-gray-500'

export function RunLaunchDialog({
  open,
  onClose,
  agentID,
  agentName,
  defaults,
  onLaunched,
}: {
  open: boolean
  onClose: () => void
  agentID: string
  agentName: string
  defaults: {
    default_task: string
    default_max_steps: number
    default_workspace_path: string
    starter_prompts: string[]
  }
  onLaunched: (runID: string) => void
}) {
  const [task, setTask] = useState('')
  const [maxSteps, setMaxSteps] = useState<number>(defaults.default_max_steps || 30)
  const [workspace, setWorkspace] = useState('')

  useEffect(() => {
    if (!open) return
    setTask(defaults.default_task || defaults.starter_prompts[0] || '')
    setMaxSteps(defaults.default_max_steps || 30)
    setWorkspace(defaults.default_workspace_path || '')
  }, [open, defaults.default_task, defaults.default_max_steps, defaults.default_workspace_path, defaults.starter_prompts])

  const launch = useMutation({
    mutationFn: () =>
      api.createRun({
        agent_id: agentID,
        task: task.trim() || defaults.default_task,
        max_steps: maxSteps,
        workspace_path: workspace,
      }),
    onSuccess: (out) => onLaunched(out.id),
  })

  const canSubmit = (task.trim() || defaults.default_task).length > 0 && !launch.isPending

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Start a run · ${agentName}`}
      eyebrow="New run"
      widthClass="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={launch.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => launch.mutate()}
          >
            {launch.isPending ? 'Starting…' : 'Start run'}
          </Button>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit) launch.mutate()
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSubmit) {
            e.preventDefault()
            launch.mutate()
          }
        }}
      >
        {defaults.starter_prompts.length > 0 ? (
          <div>
            <p className={`mb-1 ${EYEBROW}`}>Starters</p>
            <div className="flex flex-wrap gap-1.5">
              {defaults.starter_prompts.slice(0, 8).map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setTask(prompt)}
                  className={clsx(
                    'rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[12px] text-gray-700 transition-colors hover:bg-gray-100',
                    FOCUS_RING,
                  )}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div>
          <label htmlFor="run-task" className={`mb-1 block ${EYEBROW}`}>
            Task
          </label>
          <textarea
            id="run-task"
            className={`${TEXTAREA_CLASSES} h-28`}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder={defaults.default_task || 'Describe what the agent should do…'}
          />
        </div>
        <details className="group rounded-md border border-gray-200 bg-gray-50 p-3">
          <summary className={clsx('cursor-pointer select-none text-sm font-medium text-gray-700', FOCUS_RING)}>
            Overrides
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="run-max-steps" className={`mb-1 block ${EYEBROW}`}>
                Max steps
              </label>
              <input
                id="run-max-steps"
                type="number"
                min={1}
                className={INPUT_CLASSES}
                value={maxSteps}
                onChange={(e) => setMaxSteps(Number(e.target.value || 30))}
              />
            </div>
            <div>
              <label htmlFor="run-workspace" className={`mb-1 block ${EYEBROW}`}>
                Workspace path
              </label>
              <input
                id="run-workspace"
                className={INPUT_CLASSES}
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
                placeholder="leave empty for default"
              />
            </div>
          </div>
        </details>
        <ErrorBanner title="Couldn't start run" message={launch.error ? (launch.error as Error).message : undefined} />
        <p className="text-[11px] text-gray-500">Tip: ⌘ Enter launches the run.</p>
      </form>
    </Modal>
  )
}
