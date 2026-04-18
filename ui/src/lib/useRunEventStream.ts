import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { api } from './api'
import { queryKeys } from './queryKeys'
import type { RunTelemetry } from './types'

const TERMINAL_RUN_STATUS = new Set(['completed', 'failed', 'cancelled'])

export type RunEventStreamOptions = {
  enabled?: boolean
  refetchInterval?: number
  /**
   * When true, open an EventSource so that live tool/model events invalidate
   * the cache immediately. Leave false for historical runs to avoid spinning
   * up N SSE connections (one per past assistant message) in long chats.
   */
  subscribeSSE?: boolean
}

export type RunEventStreamResult = {
  telemetry: RunTelemetry | undefined
  isLoading: boolean
  isError: boolean
}

/**
 * Owns a single EventSource per runID and keeps queryKeys.telemetry(runID) fresh.
 * All observability components (inline timelines, LLM snapshot drawers, etc.)
 * should go through this hook so we do not open multiple SSE connections per run.
 */
export function useRunEventStream(runID: string, opts: RunEventStreamOptions = {}): RunEventStreamResult {
  const enabled = Boolean(runID) && opts.enabled !== false
  const subscribeSSE = enabled && opts.subscribeSSE === true
  const qc = useQueryClient()
  const telemetryQ = useQuery({
    queryKey: queryKeys.telemetry(runID),
    queryFn: () => api.getRunTelemetry(runID),
    enabled,
    refetchInterval: opts.refetchInterval ?? (subscribeSSE ? 1800 : false),
  })

  useEffect(() => {
    if (!subscribeSSE) return
    const es = new EventSource(`/api/stream/runs/${runID}`)
    const listener = () => {
      qc.invalidateQueries({ queryKey: queryKeys.telemetry(runID) })
      qc.invalidateQueries({ queryKey: queryKeys.run(runID) })
      qc.invalidateQueries({ queryKey: queryKeys.artifacts(runID) })
    }
    es.addEventListener('run_event', listener as EventListener)
    return () => {
      es.removeEventListener('run_event', listener as EventListener)
      es.close()
    }
  }, [subscribeSSE, runID, qc])

  return { telemetry: telemetryQ.data, isLoading: telemetryQ.isLoading, isError: telemetryQ.isError }
}

export function isTerminalRunStatus(status: string | undefined): boolean {
  return TERMINAL_RUN_STATUS.has(String(status || '').toLowerCase())
}
