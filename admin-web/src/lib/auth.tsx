import { createContext, useContext, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type Me } from './api'

// Phiên admin hiện tại (đọc /me). Cookie HttpOnly nên JS không tự biết đã đăng nhập — luôn hỏi server.
interface AuthState {
  me: Me | null
  loading: boolean
  can: (perm: string) => boolean
  refresh: () => Promise<unknown>
  setMe: (m: Me | null) => void
}

const Ctx = createContext<AuthState>(null!)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/me')
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null
        throw e
      }
    },
    staleTime: 60_000,
    retry: false,
  })
  const me = q.data ?? null
  const value: AuthState = {
    me,
    loading: q.isLoading,
    can: (perm) => !!me?.permissions.includes(perm),
    refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
    setMe: (m) => qc.setQueryData<Me | null>(['me'], m),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Admin đã qua đủ bước (2FA + đổi mật khẩu tạm) để vào các trang chính. */
export const isReady = (me: Me | null) => !!me && me.scope === 'full' && me.admin.totp_enabled && !me.admin.must_change_password
