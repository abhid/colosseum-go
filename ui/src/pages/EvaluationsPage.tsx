import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Card, EmptyState, SectionTitle, StatusBadge } from '../components/Common'

export function EvaluationsPage() {
  const qc = useQueryClient()
  const suitesQ = useQuery({ queryKey: ['eval-suites'], queryFn: () => api.listEvalSuites(), refetchInterval: 3000 })
  const runsQ = useQuery({ queryKey: ['eval-runs'], queryFn: () => api.listEvalRuns(), refetchInterval: 3000 })
  const agentsQ = useQuery({ queryKey: ['agents'], queryFn: () => api.listAgents() })

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [agentID, setAgentID] = useState('')
  const [casesJSON, setCasesJSON] = useState('[\n  {\n    "name": "returns public ip",\n    "task": "Get external IP and return city.",\n    "assertion": { "contains_all": ["ip", "city"] }\n  }\n]')
  const [selectedSuiteID, setSelectedSuiteID] = useState('')
  const [selectedEvalRunID, setSelectedEvalRunID] = useState('')

  const suiteDetailQ = useQuery({
    queryKey: ['eval-suite', selectedSuiteID],
    queryFn: () => api.getEvalSuite(selectedSuiteID),
    enabled: Boolean(selectedSuiteID),
    refetchInterval: 3000,
  })
  const evalRunDetailQ = useQuery({
    queryKey: ['eval-run', selectedEvalRunID],
    queryFn: () => api.getEvalRun(selectedEvalRunID),
    enabled: Boolean(selectedEvalRunID),
    refetchInterval: 3000,
  })
  const regressionQ = useQuery({
    queryKey: ['eval-regression', selectedSuiteID],
    queryFn: () => api.getEvalRegression(selectedSuiteID),
    enabled: Boolean(selectedSuiteID),
    refetchInterval: 5000,
  })

  const createSuite = useMutation({
    mutationFn: async () => {
      const parsed = JSON.parse(casesJSON)
      return api.createEvalSuite({ name, description, agent_id: agentID, cases: parsed })
    },
    onSuccess: () => {
      setName('')
      setDescription('')
      setCasesJSON('[]')
      qc.invalidateQueries({ queryKey: ['eval-suites'] })
    },
  })

  const queueRun = useMutation({
    mutationFn: (suiteID: string) => api.queueEvalRun(suiteID, {}),
    onSuccess: (out) => {
      setSelectedEvalRunID(out.id)
      qc.invalidateQueries({ queryKey: ['eval-runs'] })
      qc.invalidateQueries({ queryKey: ['eval-suite', selectedSuiteID] })
    },
  })

  const latestPassRate = useMemo(() => {
    const raw = evalRunDetailQ.data?.run?.summary_json || ''
    try {
      const parsed = JSON.parse(raw) as { pass_rate?: number }
      if (typeof parsed.pass_rate !== 'number') return '-'
      return `${Math.round(parsed.pass_rate * 100)}%`
    } catch {
      return '-'
    }
  }, [evalRunDetailQ.data?.run?.summary_json])

  return (
    <div className="space-y-4">
      <SectionTitle title="Evaluations" subtitle="Harness, regressions, and deterministic quality gates" />

      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Create Eval Suite</h3>
        <div className="grid gap-3 xl:grid-cols-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Suite name" className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" />
          <select value={agentID} onChange={(e) => setAgentID(e.target.value)} className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400">
            <option value="">Select agent</option>
            {(agentsQ.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" className="mt-3 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" />
        <textarea value={casesJSON} onChange={(e) => setCasesJSON(e.target.value)} className="mt-3 h-40 w-full rounded-md border border-gray-300 bg-white p-3 font-mono text-xs focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" />
        <div className="mt-4 flex justify-end">
          <button disabled={!name || !agentID || createSuite.isPending} onClick={() => createSuite.mutate()} className="h-9 rounded-md bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50">Create suite</button>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Suites</h3>
          {(suitesQ.data ?? []).length === 0 ? <EmptyState title="No suites yet" body="Create a suite to start regression testing." /> : (
            <div className="max-h-[420px] space-y-3 overflow-auto pr-1">
              {(suitesQ.data ?? []).map((s) => (
                <button key={s.id} onClick={() => setSelectedSuiteID(s.id)} className={`w-full rounded-lg border p-3 text-left transition-colors ${selectedSuiteID === s.id ? 'border-gray-400 bg-gray-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">{s.name}</p>
                    {s.latest_status ? <StatusBadge status={s.latest_status} /> : null}
                  </div>
                  <p className="mt-1 text-xs text-gray-600">{s.description}</p>
                  <p className="mt-2 text-[11px] text-gray-500">{s.case_count || 0} cases</p>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Eval Runs</h3>
          {(runsQ.data ?? []).length === 0 ? <EmptyState title="No eval runs yet" body="Queue a run for any suite." /> : (
            <div className="max-h-[420px] space-y-3 overflow-auto pr-1">
              {(runsQ.data ?? []).map((r) => (
                <button key={r.id} onClick={() => setSelectedEvalRunID(r.id)} className={`w-full rounded-lg border p-3 text-left transition-colors ${selectedEvalRunID === r.id ? 'border-gray-400 bg-gray-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">{r.suite_name || r.suite_id}</p>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="mt-2 text-[11px] text-gray-500">{r.passed_cases}/{r.total_cases} passed</p>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold tracking-tight text-gray-900">Suite Detail</h3>
            <button disabled={!selectedSuiteID || queueRun.isPending} onClick={() => selectedSuiteID && queueRun.mutate(selectedSuiteID)} className="h-8 rounded-md border border-gray-300 px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50">Run suite</button>
          </div>
          {!suiteDetailQ.data ? <EmptyState title="Select a suite" body="Choose a suite to view cases and recent runs." /> : (
            <div className="space-y-3">
              {(suiteDetailQ.data.cases ?? []).map((c) => (
                <div key={String(c.id)} className="rounded-lg border border-gray-200 p-3">
                  <p className="text-sm font-medium text-gray-900">{String(c.name)}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-gray-600">{String(c.task)}</p>
                  <pre className="mt-3 overflow-auto rounded bg-gray-900 p-3 font-mono text-[11px] text-gray-100">{String(c.assertion_json || '{}')}</pre>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Regression + Run Report</h3>
          {!evalRunDetailQ.data ? <EmptyState title="Select an eval run" body="Select a run to inspect case-level outcomes." /> : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={evalRunDetailQ.data.run.status} />
                <span className="text-xs font-medium text-gray-600">Pass rate: {latestPassRate}</span>
                <span className="text-xs font-medium text-gray-600">Cases: {evalRunDetailQ.data.run.total_cases}</span>
              </div>
              <div className="max-h-52 space-y-3 overflow-auto pr-1">
                {(evalRunDetailQ.data.cases ?? []).map((c) => (
                  <div key={String(c.id)} className="rounded-lg border border-gray-200 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-900">{String(c.case_id)}</span>
                      <StatusBadge status={String(c.status)} />
                    </div>
                    <p className="mt-1 text-gray-600">score {Math.round(Number(c.score || 0) * 100)}% • {Number(c.latency_ms || 0)}ms</p>
                    <p className="mt-2 line-clamp-2 text-gray-700">{String(c.result_excerpt || '')}</p>
                  </div>
                ))}
              </div>
              <pre className="max-h-44 overflow-auto rounded bg-gray-900 p-3 font-mono text-[11px] text-gray-100">{JSON.stringify(regressionQ.data ?? { ready: false }, null, 2)}</pre>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
