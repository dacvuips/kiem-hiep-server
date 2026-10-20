import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { useQueryClient } from '@tanstack/react-query'
import {
  CreditCard, Gavel, LayoutDashboard, LogOut, Menu, Moon, ScrollText, Server, ShieldCheck, Sun, UserCog, Users, X,
} from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { ROLE_LABEL } from '../lib/format'
import { applyTheme, currentTheme } from '../lib/theme'

const NAV = [
  { to: '/', label: 'Tổng quan', icon: LayoutDashboard, end: true },
  { to: '/accounts', label: 'Tài khoản', icon: Users },
  { to: '/punishments', label: 'Xử phạt', icon: Gavel },
  { to: '/servers', label: 'Máy chủ', icon: Server },
  { to: '/shop', label: 'Nạp thẻ', icon: CreditCard },
  { to: '/audit', label: 'Nhật ký', icon: ScrollText },
  { to: '/admins', label: 'Quản lý admin', icon: UserCog, perm: 'admins.manage' },
]

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/logo.png" alt="Kiếm Hiệp" className="h-9 w-auto object-contain" />
      <div className="leading-tight">
        <div className="text-sm font-semibold">Kiếm Hiệp</div>
        <div className="text-xs text-muted">Quản trị</div>
      </div>
    </div>
  )
}

export default function Layout() {
  const { me, can, setMe } = useAuth()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState(currentTheme())

  const logout = async () => {
    await api.post('/logout').catch(() => {})
    qc.clear()
    setMe(null)
    nav('/')
  }
  const toggleTheme = () => {
    const t = theme === 'dark' ? 'light' : 'dark'
    applyTheme(t)
    setTheme(t)
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5">
        <Logo />
        <button className="rounded-md p-1 text-muted lg:hidden" onClick={() => setOpen(false)} aria-label="Đóng menu">
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV.filter((n) => !n.perm || can(n.perm)).map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-subtle hover:text-fg',
              )
            }
          >
            <n.icon className="h-[18px] w-[18px]" />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-line p-3">
        <NavLink
          to="/profile"
          onClick={() => setOpen(false)}
          className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-subtle"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gold/15 text-sm font-semibold text-gold">
            {(me?.admin.display_name || me?.admin.username || '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium">{me?.admin.display_name || me?.admin.username}</div>
            <div className="flex items-center gap-1 text-xs text-muted">
              <ShieldCheck className="h-3 w-3" />
              {ROLE_LABEL[me?.admin.role ?? 'viewer']}
            </div>
          </div>
        </NavLink>
        <div className="mt-2 flex gap-1">
          <button onClick={toggleTheme} className="flex flex-1 items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs text-muted hover:bg-subtle hover:text-fg">
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === 'dark' ? 'Sáng' : 'Tối'}
          </button>
          <button onClick={logout} className="flex flex-1 items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs text-muted hover:bg-subtle hover:text-danger">
            <LogOut className="h-4 w-4" />
            Đăng xuất
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-surface shadow-xl">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-muted hover:bg-subtle" aria-label="Mở menu">
            <Menu className="h-5 w-5" />
          </button>
          <Logo />
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
