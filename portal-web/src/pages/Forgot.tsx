import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyRound, Mail } from 'lucide-react'
import { api } from '../lib/api'
import { Alert, Field, PasswordInput, Spinner, errMsg, useToast } from '../components/ui'
import { AuthShell, EMAIL_RE, checkPassword } from './AuthPages'

export default function Forgot() {
  const nav = useNavigate()
  const toast = useToast()
  const [step, setStep] = useState<1 | 2>(1)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [ttl, setTtl] = useState(0)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const u = username.trim().toLowerCase()

  const requestCode = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!u) return setErr('Vui lòng nhập tên đăng nhập')
    if (!EMAIL_RE.test(email.trim())) return setErr('Email không hợp lệ')
    setBusy(true)
    try {
      const r = await api.pub.post<{ ok: boolean; expires_in?: number }>('/v1/auth/forgot', { username: u, email: email.trim() })
      setTtl(r.expires_in ?? 0)
      setStep(2)
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const reset = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!/^\d{6}$/.test(code.trim())) return setErr('Mã xác nhận gồm 6 chữ số')
    const pe = checkPassword(pw, u)
    if (pe) return setErr(pe)
    if (pw !== pw2) return setErr('Mật khẩu nhập lại không khớp')
    setBusy(true)
    try {
      await api.pub.post('/v1/auth/reset', { username: u, code: code.trim(), new_password: pw })
      toast('ok', 'Đặt lại mật khẩu thành công. Hãy đăng nhập bằng mật khẩu mới.')
      nav('/dang-nhap', { replace: true })
    } catch (e) {
      setErr(errMsg(e))
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Quên Mật Khẩu"
      sub={step === 1 ? 'Bước 1/2 — Nhận mã xác nhận qua email' : 'Bước 2/2 — Nhập mã và mật khẩu mới'}
      footer={
        <Link to="/dang-nhap" className="font-semibold text-gold-300 hover:text-gold-200">
          ← Quay lại đăng nhập
        </Link>
      }
    >
      <div className="mb-5 flex items-center gap-2" aria-hidden>
        {[1, 2].map((s) => (
          <div key={s} className={`h-1 flex-1 rounded-full ${s <= step ? 'bg-gradient-to-r from-gold-600 to-gold-300' : 'bg-ink-700'}`} />
        ))}
      </div>
      {step === 1 ? (
        <form onSubmit={requestCode} className="space-y-4" noValidate>
          {err && <Alert>{err}</Alert>}
          <Field label="Tên đăng nhập" htmlFor="f-username">
            <input id="f-username" className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </Field>
          <Field label="Email đã đăng ký" htmlFor="f-email">
            <input id="f-email" type="email" className="input" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <button type="submit" className="btn-gold w-full py-3" disabled={busy}>
            {busy ? <Spinner className="text-ink-950" /> : <Mail className="h-4 w-4" aria-hidden />}
            Gửi mã xác nhận
          </button>
        </form>
      ) : (
        <form onSubmit={reset} className="space-y-4" noValidate>
          <Alert tone="info">
            Nếu tên đăng nhập và email khớp, mã xác nhận 6 số đã được gửi tới <b className="text-gold-100">{email.trim()}</b>
            {ttl > 0 && <> (hiệu lực {Math.round(ttl / 60)} phút)</>}. Hãy kiểm tra cả hộp thư rác.
          </Alert>
          {err && <Alert>{err}</Alert>}
          <Field label="Mã xác nhận" htmlFor="f-code">
            <input
              id="f-code"
              className="input text-center font-serif text-xl tracking-[0.5em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
          </Field>
          <Field label="Mật khẩu mới" htmlFor="f-pw" hint="6–64 ký tự, không chứa tên đăng nhập">
            <PasswordInput id="f-pw" autoComplete="new-password" maxLength={64} value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label="Nhập lại mật khẩu mới" htmlFor="f-pw2">
            <PasswordInput id="f-pw2" autoComplete="new-password" maxLength={64} value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
          <button type="submit" className="btn-seal w-full py-3" disabled={busy}>
            {busy ? <Spinner className="text-parch-50" /> : <KeyRound className="h-4 w-4" aria-hidden />}
            Đặt lại mật khẩu
          </button>
          <button
            type="button"
            className="w-full text-center text-sm text-gold-400 hover:text-gold-200"
            onClick={() => {
              setStep(1)
              setErr('')
              setCode('')
            }}
          >
            Chưa nhận được mã? Gửi lại
          </button>
        </form>
      )}
    </AuthShell>
  )
}
