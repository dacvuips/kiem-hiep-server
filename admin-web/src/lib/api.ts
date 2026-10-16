// Gọi API admin (cùng nguồn, cookie HttpOnly). Mọi yêu cầu kèm header X-Admin-Request để server chống CSRF.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch('/admin/api' + path, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Admin-Request': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'network', 'Không kết nối được máy chủ')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(res.status, data?.code ?? 'error', data?.message ?? `Lỗi máy chủ (${res.status})`)
  }
  return data as T
}

export const api = {
  get: <T,>(p: string) => request<T>('GET', p),
  post: <T,>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  put: <T,>(p: string, b: unknown) => request<T>('PUT', p, b),
}

// ---- kiểu dữ liệu

export type Role = 'super' | 'gm' | 'support' | 'viewer'
export interface Admin {
  id: number
  username: string
  display_name: string
  role: Role
  disabled: boolean
  totp_enabled: boolean
  must_change_password: boolean
  created_at: string
  last_login_at: string | null
  last_login_ip: string
}
export interface Me {
  admin: Admin
  scope: 'full' | 'enroll'
  permissions: string[]
}

export interface DayCount {
  day: string
  count: number
}
export interface ServerStat {
  id: number
  name: string
  region: string
  status: string
  is_new: boolean
  host: string
  port: number
  ws_url: string
  sort_order: number
  opened_at: string
  characters: number
}
export interface ProcessInfo {
  key: string
  server_id: number
  kind: 'world' | 'battle' | 'arena' | 'field'
  index: number
  host: string
  port: number
  build: { commit?: string; dirty?: boolean; built_at?: string } | null
  online: number
  rooms: number
  monsters: number
  tick_avg_ms: number
  tick_max_ms: number
  send_kbs: number
  uptime_sec: number
  draining: boolean
  drain_left: number
  alive: boolean
  age_sec: number
  pending?: { id: number; action: string; seconds: number; message: string; by: string }
}
export interface GameSettings {
  values: Record<string, number>
  defs: Record<string, { default: number; min: number; max: number; label: string }>
}
export interface AuditItem {
  id: number
  admin_id: number | null
  admin: string
  action: string
  target_type: string
  target_id: string
  target: string
  reason: string
  detail: Record<string, unknown>
  ip: string
  created_at: string
}
export interface Stats {
  accounts: number
  new_today: number
  new_7d: number
  banned: number
  muted: number
  characters: number
  active_today: number
  active_7d: number
  online: number | null
  registrations: DayCount[]
  active_daily: DayCount[]
  servers: ServerStat[]
  recent_audit: AuditItem[]
}
export interface Account {
  id: number
  username: string
  email: string
  status: 'active' | 'banned'
  banned_until: string | null
  ban_reason: string
  muted_until: string | null
  google_linked: boolean
  created_at: string
  created_ip: string
  last_login_at: string | null
  last_login_ip: string
  characters: number
}
export interface Page<T> {
  items: T[]
  total: number
  page: number
  size: number
}
export interface CharacterRow {
  id: number
  server_id: number
  server: string
  slot: number
  name: string
  gender: number
  sect_id: string
  level: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  online: boolean
}
// Nhân vật đầy đủ để sửa: data = PlayerProfile.to_dict() của game.
export interface CharacterFull {
  id: number
  server_id: number
  slot: number
  name: string
  gender: number
  sect_id: string
  level: number
  version: number
  updated_at: string
  data: Record<string, unknown>
  account_id: number
  username: string
  server: string
  deleted_at: string | null
  online: boolean
  reload_pending: boolean
}
export interface LoginRow {
  ok: boolean
  method: string
  ip: string
  user_agent: string
  created_at: string
}
export interface SessionRow {
  id: number
  created_at: string
  last_used_at: string
  expires_at: string
  ip: string
  user_agent: string
}
export interface AccountDetail {
  account: Account
  characters: CharacterRow[]
  logins: LoginRow[]
  sessions: SessionRow[]
  audit: AuditItem[]
}

// ---- nạp thẻ / ví Xu

export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'failed'
export interface TopupOrder {
  id: number
  code: string
  account_id: number
  username: string
  amount_vnd: number
  xu: number
  provider: string
  status: OrderStatus
  note: string
  created_at: string
  paid_at: string | null
}
export interface OrdersPage {
  orders: TopupOrder[]
  total: number
  page: number
  size: number
  summary: { revenue_vnd: number; revenue_today_vnd: number; paid_orders: number }
}
export interface ShopSettings {
  xu_per_10k: number
  jade_per_xu: number
  sandbox: boolean
  provider: string
}
export interface LedgerRow {
  delta: number
  balance_after: number
  kind: 'topup' | 'transfer' | 'admin'
  ref: string
  note: string
  admin_id: number | null
  created_at: string
}
export interface GrantRow {
  id: number
  character_id: number
  character: string
  jade: number
  xu: number
  status: 'pending' | 'applied'
  created_at: string
  applied_at: string | null
}
export interface Wallet {
  xu: number
  total_topup_vnd: number
  ledger: LedgerRow[]
  grants: GrantRow[]
}
