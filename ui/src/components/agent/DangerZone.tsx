import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { IconTrash } from '@tabler/icons-react'

import { Button } from '../ui/Button'
import { ErrorBanner } from '../Common'
import { api } from '../../lib/api'
import { queryKeys } from '../../lib/queryKeys'

export function DangerZone({ agentID, agentName }: { agentID: string; agentName: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  const deleteAgent = useMutation({
    mutationFn: (force: boolean) => api.deleteAgent(agentID, force),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agents })
      navigate('/agents')
    },
  })

  const onDelete = async () => {
    const ok = window.confirm(`Delete agent "${agentName}"?\n\nThis cannot be undone.`)
    if (!ok) return
    setError('')
    try {
      await deleteAgent.mutateAsync(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete agent'
      if (message.includes('agent has runs') || message.includes('agent has sessions')) {
        const force = window.confirm(
          `Agent "${agentName}" has runs.\n\nForce delete will permanently remove all run history for this agent.\n\nContinue?`,
        )
        if (!force) {
          setError(message)
          return
        }
        try {
          await deleteAgent.mutateAsync(true)
        } catch (forceErr) {
          setError(forceErr instanceof Error ? forceErr.message : 'Failed to force delete agent')
        }
        return
      }
      setError(message)
    }
  }

  return (
    <section data-section="danger" id="section-danger" className="scroll-mt-24 space-y-3">
      <div>
        <h3 className="text-sm font-semibold tracking-tight text-red-700">Danger zone</h3>
        <p className="mt-0.5 text-xs text-gray-500">Permanent actions live here. They cannot be undone.</p>
      </div>
      <div className="space-y-3 rounded-lg border border-red-200 bg-red-50/50 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-900">Delete this agent</p>
            <p className="text-xs text-gray-600">
              Removes the agent. Existing runs require a separate force-confirmation.
            </p>
          </div>
          <Button variant="danger" disabled={deleteAgent.isPending} onClick={onDelete}>
            <IconTrash className="mr-1 h-3.5 w-3.5" />
            {deleteAgent.isPending ? 'Deleting…' : 'Delete agent'}
          </Button>
        </div>
        <ErrorBanner title="Couldn't delete agent" message={error} />
      </div>
    </section>
  )
}
