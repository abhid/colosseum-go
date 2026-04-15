import { Link, NavLink } from 'react-router-dom'
import { IconRobot, IconPlayerPlay, IconScale, IconShieldCheck, IconTool, IconCloud, IconLock } from '@tabler/icons-react'
import type { PropsWithChildren } from 'react'
import colosseumLogo from '../assets/colosseum-logo.png'

const nav = [
  { to: '/sessions', label: 'Sessions', icon: IconPlayerPlay },
  { to: '/agents', label: 'Agents', icon: IconRobot },
  { to: '/tools', label: 'Tools', icon: IconTool },
  { to: '/environments', label: 'Environments', icon: IconCloud },
  { to: '/credential-vaults', label: 'Credential Vaults', icon: IconLock },
  { to: '/policies', label: 'Policies', icon: IconShieldCheck },
  { to: '/approvals', label: 'Approvals', icon: IconShieldCheck },
  { to: '/settings', label: 'Settings', icon: IconScale },
]

export function Layout({ children }: PropsWithChildren) {
  return (
    <div className="min-h-screen bg-[#fafafa] text-sm font-sans text-gray-900">
      <div className="mx-auto grid min-h-screen max-w-[1500px] grid-cols-[240px_minmax(0,1fr)]">
        <aside className="border-r border-gray-200 bg-[#fafafa] px-4 py-6">
          <Link to="/sessions" className="mb-8 flex items-center gap-2 text-lg font-semibold tracking-tight text-gray-900">
            <img src={colosseumLogo} alt="Colosseum logo" className="h-8 w-8 rounded object-contain" />
            colosseum
          </Link>
          <nav className="space-y-1">
            {nav.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-gray-200 text-gray-900' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              )
            })}
          </nav>
        </aside>
        <main className="min-w-0 overflow-x-hidden px-8 py-6">{children}</main>
      </div>
    </div>
  )
}
