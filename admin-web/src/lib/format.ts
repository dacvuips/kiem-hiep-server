const dtf = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' })
const df = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })
const nf = new Intl.NumberFormat('vi-VN')
const rtf = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' })

export const fmtDateTime = (s?: string | null) => (s ? dtf.format(new Date(s)) : '—')
export const fmtDay = (s: string) => df.format(new Date(s + 'T00:00:00+07:00'))
export const fmtNum = (n: number) => nf.format(n)
export const fmtVnd = (n: number) => nf.format(n) + 'đ'

export function fmtAgo(s?: string | null): string {
  if (!s) return 'Chưa có'
  const sec = (new Date(s).getTime() - Date.now()) / 1000
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  for (const [u, n] of units) if (Math.abs(sec) >= n) return rtf.format(Math.round(sec / n), u)
  return 'vừa xong'
}

export const isFuture = (s?: string | null) => !!s && new Date(s).getTime() > Date.now()

export const ROLE_LABEL: Record<string, string> = { super: 'Super Admin', gm: 'Game Master', support: 'Hỗ trợ', viewer: 'Chỉ xem' }
export const ROLE_DESC: Record<string, string> = {
  super: 'Toàn quyền, kể cả máy chủ và quản lý admin',
  gm: 'Xử phạt (khóa, cấm chat), khôi phục nhân vật + quyền Hỗ trợ',
  support: 'Đặt lại mật khẩu, đổi email, đăng xuất mọi thiết bị',
  viewer: 'Chỉ xem số liệu và thông tin',
}
export const REGION_LABEL: Record<string, string> = { north: 'Miền Bắc', central: 'Miền Trung', south: 'Miền Nam' }
export const SERVER_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' }> = {
  normal: { label: 'Bình thường', tone: 'ok' },
  crowded: { label: 'Đông', tone: 'warn' },
  maintenance: { label: 'Bảo trì', tone: 'danger' },
}
export const SECT_LABEL: Record<string, string> = {
  thieu_lam: 'Thiếu Lâm',
  thien_vuong_bang: 'Thiên Vương Bang',
  duong_mon: 'Đường Môn',
  ngu_doc_giao: 'Ngũ Độc Giáo',
  nga_mi: 'Nga Mi',
  thuy_yen_mon: 'Thúy Yên Môn',
  cai_bang: 'Cái Bang',
  thien_nhan_giao: 'Thiên Nhẫn Giáo',
  vo_dang: 'Võ Đang',
  con_lon: 'Côn Lôn',
}

// Nhãn thao tác trong nhật ký.
export const ACTION_LABEL: Record<string, string> = {
  'admin.login': 'Đăng nhập',
  'admin.login_failed': 'Đăng nhập sai mật khẩu',
  'admin.totp_failed': 'Sai mã 2FA',
  'admin.2fa_enabled': 'Bật 2FA',
  'admin.password_changed': 'Đổi mật khẩu admin',
  'admin.create': 'Tạo admin',
  'admin.update': 'Sửa admin',
  'admin.reset-2fa': 'Đặt lại 2FA admin',
  'admin.reset-password': 'Đặt lại mật khẩu admin',
  'admin.cli_reset': 'Đặt lại admin (lệnh máy chủ)',
  'account.ban': 'Khóa tài khoản',
  'account.unban': 'Mở khóa tài khoản',
  'account.mute': 'Cấm chat',
  'account.unmute': 'Bỏ cấm chat',
  'account.logout-all': 'Đăng xuất mọi thiết bị',
  'account.reset-password': 'Đặt lại mật khẩu',
  'account.email': 'Đổi email',
  'character.restore': 'Khôi phục nhân vật',
  'character.edit': 'Sửa nhân vật',
  'character.kick': 'Đá nhân vật khỏi game',
  'server.create': 'Tạo máy chủ',
  'server.update': 'Sửa máy chủ',
  'shop.order.approve': 'Duyệt đơn nạp',
  'shop.order.cancel': 'Huỷ đơn nạp',
  'shop.wallet.adjust': 'Cộng / trừ Xu',
  'shop.settings': 'Đổi tỉ lệ quy đổi',
  'process.restart': 'Khởi động lại game server',
  'game.settings': 'Đổi thông số game',
}
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a

// Mô tả thiết bị ngắn gọn từ User-Agent (Godot gửi "GodotEngine/...").
export function deviceLabel(ua: string): string {
  if (!ua) return 'Không rõ'
  if (/Godot/i.test(ua)) return /Android/i.test(ua) ? 'Game · Android' : /iOS/i.test(ua) ? 'Game · iOS' : 'Game · PC'
  if (/curl/i.test(ua)) return 'curl'
  if (/Android/i.test(ua)) return 'Trình duyệt · Android'
  if (/iPhone|iPad/i.test(ua)) return 'Trình duyệt · iOS'
  return 'Trình duyệt · PC'
}

// Nạp thẻ.
export const ORDER_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' }> = {
  pending: { label: 'Chờ thanh toán', tone: 'warn' },
  paid: { label: 'Đã thanh toán', tone: 'ok' },
  cancelled: { label: 'Đã huỷ', tone: 'neutral' },
  failed: { label: 'Thất bại', tone: 'danger' },
}
export const LEDGER_KIND: Record<string, string> = { topup: 'Nạp thẻ', transfer: 'Đổi sang nhân vật', admin: 'Admin điều chỉnh' }
