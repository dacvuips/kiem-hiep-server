// Giao diện sáng/tối: mặc định theo hệ điều hành, người dùng đổi thì nhớ trong máy (chỉ là tiện ích, lỗi thì bỏ qua).
const KEY = 'kh-admin-theme'
export type Theme = 'light' | 'dark'

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

export function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function applyTheme(t: Theme, remember = true) {
  document.documentElement.classList.toggle('dark', t === 'dark')
  if (remember) {
    try {
      localStorage.setItem(KEY, t)
    } catch {
      /* chế độ riêng tư: không nhớ được, không sao */
    }
  }
}

export function initTheme() {
  const t = stored() ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  applyTheme(t, false)
}
