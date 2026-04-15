import { Link, NavLink } from 'react-router-dom'
import { Bot, PlayCircle, Scale, ShieldCheck, Wrench, Network, FlaskConical } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import colosseumLogo from '../assets/colosseum-logo.png'

const nav = [
  { to: '/', label: 'Runs', icon: PlayCircle },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/tools', label: 'Tools', icon: Wrench },
  { to: '/evaluations', label: 'Evaluations', icon: FlaskConical },
  { to: '/ecosystem', label: 'Ecosystem', icon: Network },
  { to: '/approvals', label: 'Approvals', icon: ShieldCheck },
  { to: '/settings', label: 'Settings', icon: Scale },
]

export function Layout({ children }: PropsWithChildren) {
  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-900">
      <div className="mx-auto grid min-h-screen max-w-[1500px] grid-cols-[240px_minmax(0,1fr)]">
        <aside className="border-r border-slate-200 bg-white px-4 py-6">
          <Link to="/" className="mb-8 flex items-center gap-2 text-lg font-semibold">
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
                    `flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100'}`
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              )
            })}
          </nav>
        </aside>
        <main className="min-w-0 overflow-x-hidden px-6 py-5">{children}</main>
      </div>
    </div>
  )
}
