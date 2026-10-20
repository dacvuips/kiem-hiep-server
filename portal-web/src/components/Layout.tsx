import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Coins, LogOut, Menu, Swords, User, X } from 'lucide-react'
import { useAuth, useWallet } from '../lib/auth'
import { fmtXu } from '../lib/format'

const NAV = [
  { to: '/', label: 'Trang chủ', end: true },
  { to: '/nap-the', label: 'Nạp thẻ' },
  { to: '/tai-khoan', label: 'Tài khoản' },
  { to: '/#mon-phai', label: 'Môn phái', hash: true },
  { to: '/#tai-game', label: 'Hướng dẫn tải game', hash: true },
]

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="group flex items-center gap-3" aria-label="Kiếm Hiệp — Trang chủ">
      <img
        src="/img/logo.png"
        alt="Kiếm Hiệp"
        className="h-10 w-auto object-contain transition-transform duration-300 group-hover:scale-105 sm:h-12"
      />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="title-gold text-lg sm:text-xl">Kiếm Hiệp</span>
          <span className="mt-1 hidden text-[10px] uppercase tracking-[0.22em] text-gold-500/80 sm:block">JX1 Idle Origin</span>
        </span>
      )}
    </Link>
  )
}

function Header() {
  const { status, account, logout } = useAuth()
  const wallet = useWallet()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const loc = useLocation()
  const nav = useNavigate()

  useEffect(() => setOpen(false), [loc.pathname, loc.hash])
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const doLogout = async () => {
    await logout()
    nav('/')
  }

  const linkCls = (active: boolean) =>
    clsx(
      'relative px-3 py-2 font-serif text-[15px] transition-colors',
      active ? 'text-gold-200' : 'text-parch-200/80 hover:text-gold-200',
      active && 'after:absolute after:inset-x-3 after:-bottom-0.5 after:h-px after:bg-gradient-to-r after:from-transparent after:via-gold-400 after:to-transparent',
    )

  const authBlock = (mobile: boolean) =>
    status === 'in' && account ? (
      <div className={clsx('flex items-center gap-2', mobile && 'flex-wrap')}>
        <Link to="/tai-khoan" className="flex items-center gap-1.5 rounded-sm border border-gold-700/60 bg-ink-900/70 px-2.5 py-1.5 text-sm text-parch-100 hover:border-gold-500">
          <User className="h-4 w-4 text-gold-400" aria-hidden />
          <span className="max-w-[9rem] truncate">{account.username}</span>
        </Link>
        <Link to="/nap-the" className="flex items-center gap-1.5 rounded-sm border border-gold-600/60 bg-gold-500/10 px-2.5 py-1.5 text-sm font-semibold text-gold-200 hover:border-gold-400" title="Số dư ví Xu">
          <Coins className="h-4 w-4 text-gold-400" aria-hidden />
          <span className="tabular">{wallet.data ? fmtXu(wallet.data.xu) : '… Xu'}</span>
        </Link>
        <button onClick={doLogout} className="btn-ghost btn-sm" title="Đăng xuất">
          <LogOut className="h-4 w-4" aria-hidden />
          <span>Đăng xuất</span>
        </button>
      </div>
    ) : status === 'out' ? (
      <div className="flex items-center gap-2">
        <Link to="/dang-nhap" className="btn-ghost btn-sm">
          Đăng nhập
        </Link>
        <Link to="/dang-ky" className="btn-seal btn-sm">
          Đăng ký
        </Link>
      </div>
    ) : (
      <div className="h-8 w-40 animate-pulse rounded-sm bg-ink-800/80" />
    )

  return (
    <header
      className={clsx(
        'sticky top-0 z-40 border-b transition-colors duration-300',
        scrolled || open ? 'border-gold-700/50 bg-ink-950/95 backdrop-blur' : 'border-transparent bg-ink-950/60 backdrop-blur-sm',
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
        <Logo />
        <nav className="hidden items-center lg:flex" aria-label="Điều hướng chính">
          {NAV.map((n) =>
            n.hash ? (
              <Link key={n.to} to={n.to} className={linkCls(loc.pathname === '/' && loc.hash === n.to.slice(1))}>
                {n.label}
              </Link>
            ) : (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => linkCls(isActive && !(n.end && loc.hash))}>
                {n.label}
              </NavLink>
            ),
          )}
        </nav>
        <div className="hidden lg:block">{authBlock(false)}</div>
        <button
          className="flex h-10 w-10 items-center justify-center rounded-sm border border-gold-700/60 text-gold-300 lg:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Đóng menu' : 'Mở menu'}
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-gold-700/40 bg-ink-950/98 lg:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col px-4 py-2" aria-label="Điều hướng (di động)">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} className="border-b border-gold-700/20 py-3 font-serif text-parch-100 last:border-0 hover:text-gold-200">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="mx-auto max-w-7xl px-4 pb-4">{authBlock(true)}</div>
        </div>
      )}
    </header>
  )
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-gold-700/40 bg-ink-950">
      <div className="divider-gold" />
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-3 max-w-sm text-sm text-parch-300/60">Võ lâm truyền kỳ — kiếm hiệp 2D. Thập đại môn phái, ngũ hành tương sinh tương khắc, tung hoành giang hồ cùng bằng hữu.</p>
        </div>
        <div>
          <h3 className="mb-3 font-serif text-sm font-semibold uppercase tracking-wider text-gold-300">Tài khoản</h3>
          <ul className="space-y-2 text-sm text-parch-200/70">
            <li><Link className="hover:text-gold-200" to="/dang-ky">Đăng ký</Link></li>
            <li><Link className="hover:text-gold-200" to="/nap-the">Nạp thẻ</Link></li>
            <li><Link className="hover:text-gold-200" to="/quen-mat-khau">Quên mật khẩu</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="mb-3 font-serif text-sm font-semibold uppercase tracking-wider text-gold-300">Thông tin</h3>
          <ul className="space-y-2 text-sm text-parch-200/70">
            <li><Link className="hover:text-gold-200" to="/dieu-khoan">Điều khoản</Link></li>
            <li><Link className="hover:text-gold-200" to="/ho-tro">Hỗ trợ</Link></li>
            <li><Link className="hover:text-gold-200" to="/#tai-game">Tải game</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-gold-700/20 py-4 text-center text-xs text-parch-300/50">© {new Date().getFullYear()} Kiếm Hiệp. Mọi quyền được bảo lưu.</div>
    </footer>
  )
}

/** Cuộn về đầu trang khi đổi trang; có #neo thì cuộn tới phần đó. */
function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      const id = decodeURIComponent(hash.slice(1))
      // Phần đích có thể chưa hiện (đang tải dữ liệu) -> thử lại vài lần.
      let tries = 0
      let t = 0
      const go = () => {
        const el = document.getElementById(id)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        else if (tries++ < 20) t = window.setTimeout(go, 100)
      }
      t = window.setTimeout(go, 30)
      return () => clearTimeout(t)
    }
    window.scrollTo(0, 0)
  }, [pathname, hash])
  return null
}

export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollManager />
      <a href="#noi-dung" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:bg-ink-900 focus:p-2">
        Bỏ qua tới nội dung
      </a>
      <Header />
      <main id="noi-dung" className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
