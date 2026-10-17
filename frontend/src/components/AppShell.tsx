import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Activity,
  Bell,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  HardHat,
  LayoutDashboard,
  Map,
  Menu,
  MapPin,
  Search,
  ShieldAlert,
  Siren,
  Users,
  Video,
  X,
} from 'lucide-react'
import { useAppActions } from '../context'
import type { AuthUser } from '../services/api'
import { roleCanAccessPath } from '../permissions'

const navGroups = [
  {
    label: 'PUBLIC INFORMATION',
    items: [
      { label: 'Road defects', to: '/public', icon: MapPin },
    ],
  },
  {
    label: 'CITY OPERATIONS',
    items: [
      { label: 'Overview', to: '/', icon: LayoutDashboard, end: true },
      { label: 'Road monitoring', to: '/roads', icon: Video },
      { label: 'Defect map', to: '/map', icon: Map },
      { label: 'Repair tracking', to: '/repairs', icon: HardHat },
    ],
  },
  {
    label: 'TRAFFIC & SAFETY',
    items: [
      { label: 'Traffic incidents', to: '/traffic', icon: Siren },
      { label: 'Incident review', to: '/traffic/review', icon: ClipboardCheck },
      { label: 'Police alerts', to: '/alerts', icon: ShieldAlert },
    ],
  },
  {
    label: 'MANAGEMENT',
    items: [
      { label: 'Analytics', to: '/analytics', icon: Activity },
      { label: 'User management', to: '/users', icon: Users },
    ],
  },
]

const routeNames: Record<string, string> = {
  '/public': 'Public road defects',
  '/': 'Overview',
  '/roads': 'Road monitoring',
  '/map': 'Defect map',
  '/repairs': 'Repair tracking',
  '/traffic': 'Traffic incidents',
  '/traffic/review': 'Incident review',
  '/alerts': 'Police alerts',
  '/analytics': 'Analytics',
  '/users': 'User management',
}

export function AppShell({
  user,
  onLogout,
  loggingOut,
}: {
  user: AuthUser
  onLogout: () => void | Promise<void>
  loggingOut: boolean
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const { notify } = useAppActions()
  const resident = user.role === 'Public User'
  const activeTitle = location.pathname.startsWith('/defects/')
    ? 'Defect details'
    : location.pathname.startsWith('/repairs/')
      ? 'Repair task'
      : location.pathname.startsWith('/traffic/review')
        ? 'Incident review'
        : Object.entries(routeNames)
          .sort(([left], [right]) => right.length - left.length)
          .find(([path]) => path === '/' ? location.pathname === '/' : location.pathname.startsWith(path))?.[1]
        ?? 'City operations'

  const sidebar = (
    <>
      <div className="sidebar-brand">
        <span className="sidebar-mark"><Activity size={21} strokeWidth={2.5} /></span>
        <span><strong>CityLens</strong><small>AI · CITY OPERATIONS</small></span>
      </div>
      <div className="workspace-select">
        <span className="workspace-icon">MC</span>
        <span><strong>Metro City</strong><small>Municipal workspace</small></span>
        <ChevronDown size={15} className="workspace-chevron" />
      </div>
      <nav aria-label="Primary navigation" className="sidebar-nav">
        {navGroups.map((group) => (
          <div className="nav-group" key={group.label}>
            <p className="nav-group-label">{group.label}</p>
            {group.items.filter(({ to }) => roleCanAccessPath(user.role, to)).map(({ label, to, icon: Icon, end }) => (
              <NavLink
                className={({ isActive }) => `nav-link${isActive ? ' nav-link-active' : ''}`}
                end={end}
                key={to}
                onClick={() => setMobileOpen(false)}
                to={to}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-connection"><span className="connection-dot connection-dot-authenticated" /><span>Authenticated session</span></div>
        <p>CityLens AI <span>v0.1</span></p>
      </div>
    </>
  )

  return (
    <div className="app-shell">
      {mobileOpen && <button aria-label="Close navigation" className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />}
      <aside className={`app-sidebar${mobileOpen ? ' app-sidebar-open' : ''}`}>
        <button aria-label="Close navigation" className="mobile-sidebar-close" onClick={() => setMobileOpen(false)} type="button"><X size={19} /></button>
        {sidebar}
      </aside>
      <div className="app-main">
        <header className="topbar">
          <button aria-label="Open navigation" className="mobile-menu-button" onClick={() => setMobileOpen(true)} type="button"><Menu size={21} /></button>
          <div className="breadcrumbs"><span>CityLens AI</span><span className="breadcrumb-divider">/</span><strong>{activeTitle}</strong></div>
          <div className="topbar-actions">
            {!resident && <label className="global-search">
              <Search size={16} />
              <input aria-label="Search CityLens" onKeyDown={(event) => {
                if (event.key === 'Enter' && event.currentTarget.value.trim()) notify('Global search will be available when the API is connected.')
              }} placeholder="Search reports..." />
            </label>}
            {!resident && <button aria-label="Notifications" className="icon-button notification-button" onClick={() => notify('You are all caught up in this demo workspace.')} type="button">
              <Bell size={18} /><span />
            </button>}
            <div className="topbar-divider" />
            <button aria-label="Sign out" className="account-menu" disabled={loggingOut} onClick={() => void onLogout()} title="Sign out" type="button">
              <span className="account-avatar">{user.display_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span>
              <span className="account-copy"><strong>{user.display_name}</strong><small>{loggingOut ? 'Signing out…' : user.role}</small></span>
              <ChevronDown size={15} />
            </button>
          </div>
        </header>
        <main className="page-content"><Outlet /></main>
        <footer className="app-footer"><span>CityLens AI <span className="footer-dot">·</span> {resident ? 'Public information' : 'Municipal operations workspace'}</span><span>{resident ? 'READ-ONLY ACCESS' : 'DEVELOPMENT DEMO'} <ClipboardList size={13} /></span></footer>
      </div>
    </div>
  )
}