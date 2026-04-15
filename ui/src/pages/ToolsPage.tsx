import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Card, EmptyState, SectionTitle } from '../components/Common'
import type { ToolDef } from '../lib/types'

const defaultSchema = '{"type":"object","properties":{}}'

export function ToolsPage() {
  const qc = useQueryClient()
  const toolsQuery = useQuery({ queryKey: ['tools'], queryFn: api.listTools, refetchInterval: 3000 })
  const [workspacePath, setWorkspacePath] = useState('')
  const [testInput, setTestInput] = useState('{}')
  const [testOutput, setTestOutput] = useState('')
  const [editingId, setEditingId] = useState('')
  const [form, setForm] = useState({ name: '', description: '', kind: 'shell_command', input_schema: defaultSchema, config_json: '{"command_template":"echo hello","timeout_seconds":120}', enabled: true })

  const createTool = useMutation({
    mutationFn: () => api.createTool({
      name: form.name,
      description: form.description,
      kind: form.kind,
      input_schema: JSON.parse(form.input_schema),
      config_json: JSON.parse(form.config_json),
      enabled: form.enabled,
    }),
    onSuccess: () => {
      setForm({ name: '', description: '', kind: 'shell_command', input_schema: defaultSchema, config_json: '{"command_template":"echo hello","timeout_seconds":120}', enabled: true })
      qc.invalidateQueries({ queryKey: ['tools'] })
    },
  })

  const updateTool = useMutation({
    mutationFn: (id: string) => api.updateTool(id, {
      name: form.name,
      description: form.description,
      kind: form.kind,
      input_schema: JSON.parse(form.input_schema),
      config_json: JSON.parse(form.config_json),
      enabled: form.enabled,
    }),
    onSuccess: () => {
      setEditingId('')
      qc.invalidateQueries({ queryKey: ['tools'] })
    },
  })

  const deleteTool = useMutation({
    mutationFn: (id: string) => api.deleteTool(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools'] }),
  })

  const testTool = useMutation({
    mutationFn: (id: string) => api.testTool(id, { workspace_path: workspacePath, input: JSON.parse(testInput) }),
    onSuccess: (res) => setTestOutput(JSON.stringify(res, null, 2)),
    onError: (err) => setTestOutput(String(err)),
  })

  const defs = useMemo(() => (toolsQuery.data ?? []) as ToolDef[], [toolsQuery.data])

  return (
    <div className="space-y-4">
      <SectionTitle title="Tools Console" subtitle="Create, edit, test, and govern built-in and custom tools." />

      <Card>
        <h3 className="mb-3 text-sm font-semibold tracking-tight">{editingId ? 'Edit Tool' : 'Create Custom Tool'}</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <input className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm" placeholder="Tool name (e.g. repo.scan)" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <input className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm" placeholder="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          <select className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
            <option value="shell_command">shell_command</option>
            <option value="builtin">builtin</option>
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} /> Enabled
          </label>
        </div>
        <textarea className="mt-3 h-28 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs" value={form.input_schema} onChange={(e) => setForm((f) => ({ ...f, input_schema: e.target.value }))} />
        <textarea className="mt-3 h-28 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs" value={form.config_json} onChange={(e) => setForm((f) => ({ ...f, config_json: e.target.value }))} />
        <div className="mt-3 flex gap-2">
          <button className="h-9 rounded-md bg-indigo-600 px-3 text-sm font-medium text-white" onClick={() => (editingId ? updateTool.mutate(editingId) : createTool.mutate())}>{editingId ? 'Save Tool' : 'Create Tool'}</button>
          {editingId ? <button className="h-9 rounded-md border border-slate-300 px-3 text-sm" onClick={() => setEditingId('')}>Cancel</button> : null}
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold tracking-tight">Registered Tools</h3>
        {defs.length === 0 ? <EmptyState title="No tools" body="Create your first custom tool." /> : (
          <div className="space-y-2">
            {defs.map((t) => (
              <div key={t.id} className="rounded border border-slate-200 p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold">{t.name}</p>
                    <p className="text-xs text-slate-600">{t.kind} | {t.is_builtin ? 'builtin' : 'custom'} | {t.enabled ? 'enabled' : 'disabled'}</p>
                    <p className="mt-1 text-sm text-slate-700">{t.description}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      onClick={() => {
                        setEditingId(t.id)
                        setForm({
                          name: t.name,
                          description: t.description,
                          kind: t.kind,
                          input_schema: JSON.stringify(t.input_schema ?? {}, null, 2),
                          config_json: JSON.stringify(t.config_json ?? {}, null, 2),
                          enabled: t.enabled,
                        })
                      }}
                    >
                      Edit
                    </button>
                    {!t.is_builtin ? <button className="rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-700" onClick={() => deleteTool.mutate(t.id)}>Delete</button> : null}
                    <button className="rounded-md border border-slate-300 px-2 py-1 text-xs" onClick={() => testTool.mutate(t.id)}>Test</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold tracking-tight">Tool Test Runner</h3>
        <input className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" placeholder="Workspace path" value={workspacePath} onChange={(e) => setWorkspacePath(e.target.value)} />
        <textarea className="mt-3 h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs" value={testInput} onChange={(e) => setTestInput(e.target.value)} />
        <pre className="mt-3 max-h-72 overflow-auto rounded bg-slate-900 p-3 font-mono text-xs text-slate-100">{testOutput || 'Run a test to inspect output...'}</pre>
      </Card>
    </div>
  )
}
