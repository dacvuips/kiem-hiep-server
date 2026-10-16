import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { webLogin } from '../lib/api'
import { safeNext, useAuth } from '../lib/auth'
import { Alert, Field, PasswordInput, Spinner, errMsg } from '../components/ui'
import { AuthShell } from './AuthPages'

export default function Login() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'), '/tai-khoan')
  const { status } = useAuth()
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (status === 'in' && !busy) return <Navigate to={next} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!username.trim() || !password) {
      setErr('Vui lòng nhập tên đăng nhập và mật khẩu')
      return
    }
    setBusy(true)
    try {
      await webLogin(username.trim().toLowerCase(), password)
      nav(next, { replace: true })
    } catch (e) {
      setErr(errMsg(e))
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Đăng Nhập"
      sub="Đăng nhập để nạp thẻ và quản lý tài khoản"
      footer={
        <>
          Chưa có tài khoản?{' '}
          <Link to={`/dang-ky${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-gold-300 hover:text-gold-200">
            Đăng ký ngay
          </Link>
        </>
      }
    >
      {status === 'loading' ? (
        <div className="py-8 text-center">
          <Spinner label="Đang kiểm tra phiên…" />
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {err && <Alert>{err}</Alert>}
          <Field label="Tên đăng nhập" htmlFor="username">
            <input id="username" className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </Field>
          <Field label="Mật khẩu" htmlFor="password">
            <PasswordInput id="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Link to="/quen-mat-khau" className="text-sm text-gold-400 hover:text-gold-200">
              Quên mật khẩu?
            </Link>
          </div>
          <button type="submit" className="btn-gold w-full py-3" disabled={busy}>
            {busy ? <Spinner className="text-ink-950" /> : <LogIn className="h-4 w-4" aria-hidden />}
            Đăng nhập
          </button>
        </form>
      )}
    </AuthShell>
  )
}
