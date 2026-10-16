import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { UserPlus } from 'lucide-react'
import { webRegister } from '../lib/api'
import { safeNext, useAuth } from '../lib/auth'
import { Alert, Field, PasswordInput, Spinner, errMsg, useToast } from '../components/ui'
import { AuthShell, EMAIL_RE, USERNAME_RE, checkPassword } from './AuthPages'

export default function Register() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'), '/tai-khoan')
  const { status } = useAuth()
  const nav = useNavigate()
  const toast = useToast()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [agree, setAgree] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (status === 'in' && !busy) return <Navigate to={next} replace />

  const u = username.trim().toLowerCase()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!USERNAME_RE.test(u)) return setErr('Tên đăng nhập gồm 3–20 ký tự: chữ thường không dấu (a–z), số hoặc dấu gạch dưới')
    if (!EMAIL_RE.test(email.trim())) return setErr('Email không hợp lệ')
    const pe = checkPassword(password, u)
    if (pe) return setErr(pe)
    if (password !== password2) return setErr('Mật khẩu nhập lại không khớp')
    if (!agree) return setErr('Bạn cần đồng ý với Điều khoản sử dụng')
    setBusy(true)
    try {
      await webRegister(u, email.trim(), password)
      toast('ok', 'Đăng ký thành công! Chào mừng đại hiệp gia nhập giang hồ.')
      nav(next, { replace: true })
    } catch (e) {
      setErr(errMsg(e))
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Đăng Ký"
      sub="Một tài khoản dùng chung cho game và trang web"
      footer={
        <>
          Đã có tài khoản?{' '}
          <Link to="/dang-nhap" className="font-semibold text-gold-300 hover:text-gold-200">
            Đăng nhập
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {err && <Alert>{err}</Alert>}
        <Field label="Tên đăng nhập" htmlFor="r-username" hint="3–20 ký tự: a–z, 0–9 hoặc dấu gạch dưới (_)">
          <input
            id="r-username"
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={20}
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            autoFocus
          />
        </Field>
        <Field label="Email" htmlFor="r-email" hint="Dùng để lấy lại mật khẩu — hãy nhập email bạn đang dùng">
          <input id="r-email" type="email" className="input" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Mật khẩu" htmlFor="r-password" hint="6–64 ký tự, không chứa tên đăng nhập">
          <PasswordInput id="r-password" autoComplete="new-password" maxLength={64} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Nhập lại mật khẩu" htmlFor="r-password2">
          <PasswordInput id="r-password2" autoComplete="new-password" maxLength={64} value={password2} onChange={(e) => setPassword2(e.target.value)} />
        </Field>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-parch-200/80">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#c19443]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            Tôi đã đọc và đồng ý với{' '}
            <Link to="/dieu-khoan" className="text-gold-300 underline-offset-2 hover:underline" target="_blank">
              Điều khoản sử dụng
            </Link>
          </span>
        </label>
        <button type="submit" className="btn-seal w-full py-3" disabled={busy}>
          {busy ? <Spinner className="text-parch-50" /> : <UserPlus className="h-4 w-4" aria-hidden />}
          Tạo tài khoản
        </button>
      </form>
    </AuthShell>
  )
}
