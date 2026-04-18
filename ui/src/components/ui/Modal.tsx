import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { IconX } from '@tabler/icons-react'
import clsx from 'clsx'

import { FOCUS_RING } from '../../lib/tokens'

type Props = {
  open: boolean
  onClose: () => void
  title?: ReactNode
  eyebrow?: string
  widthClass?: string
  padded?: boolean
  hideChrome?: boolean
  children: ReactNode
  footer?: ReactNode
  labelledById?: string
}

const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  widthClass = 'max-w-2xl',
  padded = true,
  hideChrome = false,
  children,
  footer,
  labelledById = 'modal-title',
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ;(first ?? panel).focus()
    }
    return () => {
      previouslyFocused.current?.focus?.()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((n) => !n.hasAttribute('disabled'))
      if (nodes.length === 0) {
        e.preventDefault()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  const onBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 transition-opacity duration-150"
      onMouseDown={onBackdropMouseDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledById}
        tabIndex={-1}
        className={clsx(
          'flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-xl bg-white shadow-xl outline-none',
          widthClass,
        )}
      >
        {!hideChrome ? (
          <div className="flex items-start justify-between border-b border-gray-200 px-5 py-3">
            <div className="min-w-0">
              {eyebrow ? (
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{eyebrow}</p>
              ) : null}
              {title ? (
                <h2 id={labelledById} className="truncate text-lg font-semibold tracking-tight text-gray-900">
                  {title}
                </h2>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className={clsx(
                'rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600',
                FOCUS_RING,
              )}
            >
              <IconX size={18} />
            </button>
          </div>
        ) : null}
        <div className={clsx('min-h-0 flex-1 overflow-y-auto', padded ? 'px-5 py-4' : '')}>{children}</div>
        {footer ? <div className="border-t border-gray-200 bg-gray-50 px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  )
}
