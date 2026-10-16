const nf = new Intl.NumberFormat('vi-VN')
const dtf = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' })

export const fmtNum = (n: number) => nf.format(n)
/** 10000 -> "10.000đ" */
export const fmtVnd = (n: number) => nf.format(n) + 'đ'
/** 100 -> "100 Xu" */
export const fmtXu = (n: number) => nf.format(n) + ' Xu'
export const fmtJade = (n: number) => nf.format(n) + ' Nguyên bảo'
export const fmtDateTime = (s?: string | null) => (s ? dtf.format(new Date(s)) : '—')

export const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Chờ thanh toán', cls: 'border-gold-500/60 text-gold-300 bg-gold-500/10' },
  paid: { label: 'Thành công', cls: 'border-emerald-500/60 text-emerald-300 bg-emerald-500/10' },
  cancelled: { label: 'Đã huỷ', cls: 'border-parch-300/30 text-parch-300/70 bg-white/5' },
  failed: { label: 'Thất bại', cls: 'border-seal-400/60 text-seal-400 bg-seal-500/10' },
}
export const LEDGER_KIND: Record<string, string> = {
  topup: 'Nạp thẻ',
  transfer: 'Đổi sang nhân vật',
  admin: 'Admin điều chỉnh',
}
export const LOGIN_METHOD: Record<string, string> = {
  password: 'Mật khẩu',
  register: 'Đăng ký',
  google: 'Google',
  refresh: 'Làm mới phiên',
}
export const REGION_LABEL: Record<string, string> = { north: 'Miền Bắc', central: 'Miền Trung', south: 'Miền Nam' }
export const SERVER_STATUS: Record<string, string> = { normal: 'Bình thường', crowded: 'Đông', maintenance: 'Bảo trì' }

/** Mô tả thiết bị ngắn gọn từ User-Agent (game Godot gửi "GodotEngine/..."). */
export function deviceLabel(ua: string): string {
  if (!ua) return 'Không rõ'
  if (/Godot/i.test(ua)) return /Android/i.test(ua) ? 'Game · Android' : /iOS/i.test(ua) ? 'Game · iOS' : 'Game · PC'
  if (/Android/i.test(ua)) return 'Trình duyệt · Android'
  if (/iPhone|iPad/i.test(ua)) return 'Trình duyệt · iOS'
  return 'Trình duyệt · PC'
}
