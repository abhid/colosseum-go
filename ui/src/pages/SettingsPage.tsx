import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'

import { api } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'
import { SectionNav } from '../components/ui/SectionNav'
import type { SectionEntry } from '../components/ui/SectionNav'
import { ProvidersStatusSection } from '../components/settings/ProvidersStatusSection'
import { ProviderConfigsSection } from '../components/settings/ProviderConfigsSection'
import { ManagedResourcesSection } from '../components/settings/ManagedResourcesSection'
import { AboutSection } from '../components/settings/AboutSection'

const SECTIONS: SectionEntry[] = [
  { id: 'providers', label: 'Providers' },
  { id: 'configs', label: 'Configurations' },
  { id: 'resources', label: 'Resources' },
  { id: 'about', label: 'About' },
]

export function SettingsPage() {
  const providers = useQuery({ queryKey: queryKeys.providers, queryFn: api.listProviders })
  const contentRef = useRef<HTMLDivElement>(null)

  return (
    <div className="-mx-8 -mb-6 flex h-[calc(100vh-3.5rem)] flex-col border-l border-gray-200 bg-gray-50">
      <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-6 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-gray-900">Settings</h2>
          <p className="text-xs text-gray-500">Providers, configurations, and managed resources.</p>
        </div>
      </div>

      <div className={clsx('grid min-h-0 flex-1 grid-cols-[180px_minmax(0,1fr)]')}>
        <aside className="min-h-0 overflow-auto border-r border-gray-200 bg-gray-50 px-3 py-5">
          <SectionNav sections={SECTIONS} containerRef={contentRef} />
        </aside>

        <div ref={contentRef} className="min-h-0 overflow-auto px-6 py-5">
          <div className="mx-auto max-w-3xl space-y-8">
            <ProvidersStatusSection query={providers} />
            <ProviderConfigsSection availableProviders={providers.data ?? []} />
            <ManagedResourcesSection />
            <AboutSection />
          </div>
        </div>
      </div>
    </div>
  )
}
