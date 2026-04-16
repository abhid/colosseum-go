import { useEffect, useMemo, useRef, useState } from 'react'
import { IconChevronDown } from '@tabler/icons-react'

export function ProviderModelCombobox({
  value,
  options,
  placeholder,
  disabled,
  onValueChange,
}: {
  value: string
  options: string[]
  placeholder: string
  disabled?: boolean
  onValueChange: (next: string) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const normalized = value.trim().toLowerCase()
  const filtered = useMemo(() => {
    const base = normalized
      ? options.filter((option) => option.toLowerCase().includes(normalized))
      : options
    return base.slice(0, 25)
  }, [options, normalized])

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(filtered.length - 1)
  }, [filtered.length, activeIndex])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const node = rootRef.current
      if (!node) return
      if (event.target instanceof Node && !node.contains(event.target)) setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <input
        className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 pr-9 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onFocus={() => {
          if (disabled) return
          setOpen(true)
        }}
        onClick={() => {
          if (disabled) return
          setOpen(true)
        }}
        onChange={(e) => {
          onValueChange(e.target.value)
          setOpen(true)
          setActiveIndex(-1)
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            setOpen(true)
            return
          }
          if (!open || filtered.length === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActiveIndex((idx) => Math.min(idx + 1, filtered.length - 1))
            return
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActiveIndex((idx) => Math.max(idx - 1, 0))
            return
          }
          if (e.key === 'Enter' && activeIndex >= 0 && activeIndex < filtered.length) {
            e.preventDefault()
            onValueChange(filtered[activeIndex])
            setOpen(false)
            return
          }
          if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      <button
        type="button"
        className="absolute inset-y-0 right-0 inline-flex w-9 items-center justify-center text-gray-400 transition-colors hover:text-gray-600 disabled:cursor-not-allowed disabled:text-gray-300"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle model suggestions"
      >
        <IconChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-gray-500">No matching models</p>
          ) : (
            filtered.map((option, idx) => (
              <button
                key={option}
                type="button"
                className={`block w-full rounded px-2 py-1.5 text-left text-sm transition-colors ${idx === activeIndex ? 'bg-gray-100 text-gray-900' : 'text-gray-700 hover:bg-gray-50'}`}
                onMouseEnter={() => setActiveIndex(idx)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onValueChange(option)
                  setOpen(false)
                }}
              >
                {option}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
