import type { ReactNode } from 'react'

/** Khung chung cho Đăng nhập / Đăng ký / Quên mật khẩu. */
export function AuthShell({ title, sub, children, footer }: { title: string; sub?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth-bg -mt-16 flex min-h-[calc(100vh-1px)] items-center justify-center px-4 pb-16 pt-28">
      <div className="frame w-full max-w-md animate-rise p-6 sm:p-8">
        <div className="mb-6 text-center">
          <h1 className="title-gold text-3xl">{title}</h1>
          {sub && <p className="mt-2 text-sm text-parch-200/70">{sub}</p>}
          <div className="divider-gold mt-5" />
        </div>
        {children}
        {footer && <div className="mt-6 border-t border-gold-700/30 pt-5 text-center text-sm text-parch-200/70">{footer}</div>}
      </div>
    </div>
  )
}

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Kiểm tra mật khẩu mới giống server (6–64 ký tự, không chứa tên đăng nhập). */
export function checkPassword(p: string, username: string): string | null {
  const n = [...p].length
  if (n < 6 || n > 64) return 'Mật khẩu phải dài 6–64 ký tự'
  if (username && p.toLowerCase().includes(username.toLowerCase())) return 'Mật khẩu không được chứa tên đăng nhập'
  return null
}
