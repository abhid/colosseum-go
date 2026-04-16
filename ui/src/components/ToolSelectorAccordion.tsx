import { useMemo, useState } from 'react'

export function ToolSelectorAccordion({
  title,
  tools,
  selected,
  onChange,
}: {
  title: string
  tools: Array<{ name: string; description: string; isBuiltin: boolean }>
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [filter, setFilter] = useState('')
  const needle = filter.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!needle) return tools
    return tools.filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(needle))
  }, [tools, needle])
  const grouped = useMemo(() => {
    const groups: Record<string, Array<{ name: string; description: string; isBuiltin: boolean }>> = {}
    for (const tool of filtered) {
      const key = tool.name.includes('.') ? tool.name.split('.')[0] : 'other'
      if (!groups[key]) groups[key] = []
      groups[key].push(tool)
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  return (
    <details className="mt-3 rounded-md border border-gray-200 bg-gray-50/50 p-2">
      <summary className="cursor-pointer select-none text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
        {title} ({selected.length} selected)
      </summary>
      <div className="mt-3 space-y-2">
        <input
          className="h-8 w-full rounded-md border border-gray-300 bg-white px-2.5 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          placeholder="Filter tools..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="max-h-52 space-y-2 overflow-auto rounded-md border border-gray-200 bg-white p-2 shadow-sm">
          {grouped.length === 0 ? <p className="text-xs text-gray-500">No tools match filter.</p> : null}
          {grouped.map(([group, items]) => (
            <div key={group} className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 pl-1">{group}</p>
              {items.map((tool) => {
                const checked = selected.includes(tool.name)
                return (
                  <label key={tool.name} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1.5 hover:bg-gray-50 transition-colors">
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) onChange([...selected, tool.name])
                        else onChange(selected.filter((v) => v !== tool.name))
                      }}
                    />
                    <span className="min-w-0 text-xs">
                      <span className="font-mono text-gray-700">{tool.name}</span>
                      <span className="ml-1 text-gray-500">{tool.description}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </details>
  )
}
