// Gọi API account server (cùng nguồn). Access token CHỈ giữ trong bộ nhớ (biến module) — không localStorage/sessionStorage.
// Refresh token nằm trong cookie HttpOnly (đường dẫn /v1/web) do server đặt; mọi yêu cầu kèm X-Web-Request để chống CSRF.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

export interface Account {
  id: number
  username: string
  email: string
  has_password?: boolean
  google_linked?: boolean
}
export interface Session {
  access_token: string
  expires_in: number
  account: Account
}

let accessToken: string | null = null
let sessionListener: ((s: Session | null) => void) | null = null
let refreshing: Promise<Session | null> | null = null

/** AuthProvider đăng ký để biết khi phiên đổi (đăng nhập, làm mới, hết hạn). */
export function onSessionChange(fn: (s: Session | null) => void) {
  sessionListener = fn
}
export function applySession(s: Session | null) {
  accessToken = s?.access_token ?? null
  sessionListener?.(s)
}
export const hasToken = () => accessToken !== null

async function raw<T>(method: string, path: string, body?: unknown, token?: string | null): Promise<T> {
  const headers: Record<string, string> = { 'X-Web-Request': '1' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = 'Bearer ' + token
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'network', 'Không kết nối được máy chủ, vui lòng thử lại')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(res.status, data?.code ?? 'error', data?.message ?? `Lỗi máy chủ (${res.status})`)
  }
  return data as T
}

/** Làm mới phiên bằng cookie. Gộp các lần gọi đồng thời (cookie bị xoay vòng nên chỉ được gọi 1 lần). */
export function refreshSession(): Promise<Session | null> {
  if (!refreshing) {
    refreshing = raw<Session>('POST', '/v1/web/refresh', {})
      .then((s) => {
        applySession(s)
        return s
      })
      .catch((e) => {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          applySession(null)
          return null
        }
        throw e
      })
      .finally(() => {
        refreshing = null
      })
  }
  return refreshing
}

/** Gọi API cần đăng nhập: gặp 401 thì làm mới phiên rồi thử lại đúng 1 lần. */
async function authed<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!accessToken) {
    const s = await refreshSession()
    if (!s) throw new ApiError(401, 'unauthorized', 'Bạn cần đăng nhập')
  }
  try {
    return await raw<T>(method, path, body, accessToken)
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      const s = await refreshSession()
      if (!s) throw new ApiError(401, 'unauthorized', 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại')
      return raw<T>(method, path, body, accessToken)
    }
    throw e
  }
}

export const api = {
  /** Không cần đăng nhập */
  pub: {
    get: <T,>(p: string) => raw<T>('GET', p),
    post: <T,>(p: string, b: unknown = {}) => raw<T>('POST', p, b),
  },
  get: <T,>(p: string) => authed<T>('GET', p),
  post: <T,>(p: string, b: unknown = {}) => authed<T>('POST', p, b),
}

// ---------------------------------------------------------------- phiên web

export async function webLogin(username: string, password: string) {
  const s = await raw<Session>('POST', '/v1/web/login', { username, password })
  applySession(s)
  return s
}
export async function webRegister(username: string, email: string, password: string) {
  const s = await raw<Session>('POST', '/v1/web/register', { username, email, password })
  applySession(s)
  return s
}
export async function webLogout() {
  try {
    await raw('POST', '/v1/web/logout', {})
  } finally {
    applySession(null)
  }
}
export async function webChangePassword(old_password: string, new_password: string) {
  const s = await authed<Session>('POST', '/v1/web/password', { old_password, new_password })
  applySession(s)
  return s
}

// ---------------------------------------------------------------- kiểu dữ liệu

export interface GameServer {
  id: number
  name: string
  region: string
  status: string
  is_new: boolean
  characters: number
}
export interface Character {
  id: number
  server_id: number
  slot: number
  name: string
  gender: number
  sect_id: string
  level: number
  updated_at: string
}
export interface LoginRow {
  ok: boolean
  method: string
  ip: string
  user_agent: string
  created_at: string
}
export interface ShopConfig {
  packs: { amount_vnd: number; xu: number }[]
  xu_per_10k: number
  jade_per_xu: number
  provider: string
  sandbox: boolean
}
export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'failed'
export interface Order {
  id: number
  code: string
  account_id: number
  username?: string
  amount_vnd: number
  xu: number
  provider: string
  status: OrderStatus
  note: string
  created_at: string
  paid_at: string | null
}
export interface LedgerRow {
  delta: number
  balance_after: number
  kind: 'topup' | 'transfer' | 'admin' | string
  ref: string
  note: string
  created_at: string
}
export interface Wallet {
  xu: number
  total_topup_vnd: number
  ledger: LedgerRow[]
  orders: Order[]
}
export interface TransferResult {
  xu: number
  jade: number
  character: string
}
