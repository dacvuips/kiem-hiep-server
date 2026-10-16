import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, useLocation } from 'react-router-dom'
import { api, onSessionChange, refreshSession, webLogout, type Account, type Wallet } from './api'
import { Spinner } from '../components/ui'

type Status = 'loading' | 'in' | 'out'
interface AuthCtx {
  status: Status
  account: Account | null
  logout: () => Promise<void>
}

const Ctx = createContext<AuthCtx>({ status: 'loading', account: null, logout: async () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const qc = useQueryClient()

  useEffect(() => {
    onSessionChange((s) => {
      setAccount(s?.account ?? null)
      setStatus(s ? 'in' : 'out')
      if (!s) qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'shop-config' })
    })
    // Khôi phục phiên từ cookie khi mở trang.
    refreshSession().catch(() => {
      setStatus((st) => (st === 'loading' ? 'out' : st))
    })
  }, [qc])

  const logout = async () => {
    await webLogout().catch(() => {})
  }

  return <Ctx.Provider value={{ status, account, logout }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)

/** Ví Xu của tài khoản (dùng chung cho thanh trên cùng, trang Nạp thẻ, Tài khoản). */
export function useWallet() {
  const { status } = useAuth()
  return useQuery({
    queryKey: ['wallet'],
    queryFn: () => api.get<Wallet>('/v1/shop/wallet'),
    enabled: status === 'in',
  })
}

/** Trang cần đăng nhập: chưa đăng nhập thì chuyển tới /dang-nhap?next=... rồi quay lại. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const loc = useLocation()
  if (status === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner label="Đang tải phiên đăng nhập…" />
      </div>
    )
  }
  if (status === 'out') {
    const next = loc.pathname + loc.search
    return <Navigate to={`/dang-nhap?next=${encodeURIComponent(next)}`} replace />
  }
  return <>{children}</>
}

/** Đường dẫn "next" an toàn: chỉ cho phép đường dẫn nội bộ. */
export function safeNext(v: string | null, fallback = '/'): string {
  if (!v || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return fallback
  return v
}
