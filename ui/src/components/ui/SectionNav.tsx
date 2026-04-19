import { useEffect, useState } from 'react'
import clsx from 'clsx'

import { FOCUS_RING } from '../../lib/tokens'

export type SectionEntry = { id: string; label: string }

export function SectionNav({
  sections,
  containerRef,
}: {
  sections: SectionEntry[]
  containerRef: React.RefObject<HTMLElement | null>
}) {
  const [active, setActive] = useState(sections[0]?.id ?? '')

  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const targets = sections
      .map((s) => root.querySelector<HTMLElement>(`[data-section="${s.id}"]`))
      .filter((node): node is HTMLElement => Boolean(node))
    if (targets.length === 0) return
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (a.target.getBoundingClientRect().top - b.target.getBoundingClientRect().top))
        if (visible.length > 0) {
          const id = (visible[0].target as HTMLElement).dataset.section
          if (id) setActive(id)
        }
      },
      { rootMargin: '-96px 0px -60% 0px', threshold: 0 },
    )
    for (const t of targets) io.observe(t)
    return () => io.disconnect()
  }, [sections, containerRef])

  const handleJump = (id: string) => {
    const root = containerRef.current
    if (!root) return
    const target = root.querySelector<HTMLElement>(`[data-section="${id}"]`)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActive(id)
  }

  return (
    <nav aria-label="Sections" className="space-y-1 pr-1">
      {sections.map((section) => {
        const isActive = section.id === active
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => handleJump(section.id)}
            className={clsx(
              'flex w-full items-center rounded-md px-3 py-1.5 text-left text-sm transition-colors',
              FOCUS_RING,
              isActive
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            )}
          >
            {section.label}
          </button>
        )
      })}
    </nav>
  )
}
