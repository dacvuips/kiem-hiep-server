import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { KeyRound, LockKeyhole, ShieldCheck, Smartphone } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Button, ErrorBox, Field } from '../components/ui'
import { Logo } from '../components/Layout'

// Đăng nhập web Admin, tự dẫn qua đủ bước: mật khẩu (+ mã 2FA) -> thiết lập 2FA lần đầu -> đổi mật khẩu tạm.
export default function LoginPage() {
  const { me } = useAuth()
  let step: ReactNode
  if (!me) step = <Credentials />
  else if (!me.admin.totp_enabled || me.scope !== 'full') step = <Enroll2FA />
  else step = <ChangeTempPassword />
  return (
    <div className="flex min-h-full items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="card p-6 sm:p-8">{step}</div>
        <p className="mt-6 text-center text-xs text-muted">
          Khu vực quản trị — mọi thao tác đều được ghi nhật ký.
        </p>
      </div>
    </div>
  )
}

function StepTitle({ icon, title, desc }: { icon: ReactNode; title: string; desc: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">{icon}</div>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted">{desc}</p>
    </div>
  )
}

function Credentials() {
  const { refresh } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [needCode, setNeedCode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/login', { username, password, code: needCode ? code : '' })
      await refresh()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'totp_required') {
        setNeedCode(true)
      } else {
        setError(err)
        if (err instanceof ApiError && err.code === 'totp_wrong') setCode('')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <StepTitle
        icon={needCode ? <Smartphone className="h-5 w-5" /> : <LockKeyhole className="h-5 w-5" />}
        title={needCode ? 'Xác thực 2 lớp' : 'Đăng nhập quản trị'}
        desc={needCode ? 'Nhập mã 6 số trong ứng dụng xác thực trên điện thoại.' : 'Dùng tài khoản admin được cấp.'}
      />
      {!needCode ? (
        <>
          <Field label="Tên đăng nhập">
            <input className="input" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required />
          </Field>
          <Field label="Mật khẩu">
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
        </>
      ) : (
        <Field label="Mã xác thực">
          <OtpInput value={code} onChange={setCode} />
        </Field>
      )}
      {error != null && <ErrorBox error={error} />}
      <Button variant="primary" className="w-full" loading={busy} type="submit" disabled={needCode && code.length !== 6}>
        {needCode ? 'Xác nhận' : 'Đăng nhập'}
      </Button>
      {needCode && (
        <button type="button" className="w-full text-center text-sm text-muted hover:text-fg" onClick={() => { setNeedCode(false); setCode('') }}>
          Quay lại
        </button>
      )}
    </form>
  )
}

function OtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      className="input h-12 text-center text-xl font-semibold tracking-[0.5em] tabular"
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus
      maxLength={6}
      placeholder="••••••"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
    />
  )
}

function Enroll2FA() {
  const { refresh, setMe } = useAuth()
  const [secret, setSecret] = useState('')
  const [qr, setQr] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let alive = true
    api
      .post<{ secret: string; otpauth_url: string }>('/2fa/setup')
      .then(async (r) => {
        if (!alive) return
        setSecret(r.secret)
        setQr(await QRCode.toDataURL(r.otpauth_url, { margin: 1, width: 200, errorCorrectionLevel: 'M' }))
      })
      .catch(setError)
    return () => {
      alive = false
    }
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/2fa/enable', { code })
      await refresh()
    } catch (err) {
      setError(err)
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    await api.post('/logout').catch(() => {})
    setMe(null)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <StepTitle
        icon={<ShieldCheck className="h-5 w-5" />}
        title="Bật xác thực 2 lớp"
        desc="Bắt buộc với mọi tài khoản admin. Quét mã bằng Google Authenticator, Microsoft Authenticator hoặc Authy."
      />
      <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-subtle/60 p-4">
        {qr ? <img src={qr} alt="Mã QR thiết lập 2FA" className="h-[180px] w-[180px] rounded-md bg-white p-1" /> : <div className="h-[180px] w-[180px] animate-pulse rounded-md bg-line" />}
        {secret && (
          <div className="text-center">
            <div className="text-xs text-muted">Không quét được? Nhập khóa này:</div>
            <code className="mt-1 block select-all break-all font-mono text-xs">{secret.match(/.{1,4}/g)?.join(' ')}</code>
          </div>
        )}
      </div>
      <Field label="Mã 6 số trong ứng dụng">
        <OtpInput value={code} onChange={setCode} />
      </Field>
      {error != null && <ErrorBox error={error} />}
      <Button variant="primary" className="w-full" loading={busy} type="submit" disabled={code.length !== 6}>
        Bật 2FA
      </Button>
      <button type="button" onClick={cancel} className="w-full text-center text-sm text-muted hover:text-fg">
        Đăng xuất
      </button>
    </form>
  )
}

function ChangeTempPassword() {
  const { refresh } = useAuth()
  const [oldPw, setOldPw] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (pw !== pw2) {
      setError(new Error('Nhập lại mật khẩu không khớp'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.post('/me/password', { old_password: oldPw, new_password: pw })
      await refresh()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <StepTitle icon={<KeyRound className="h-5 w-5" />} title="Đặt mật khẩu mới" desc="Bạn đang dùng mật khẩu tạm. Hãy đặt mật khẩu riêng (ít nhất 6 ký tự)." />
      <Field label="Mật khẩu tạm">
        <input className="input" type="password" autoComplete="current-password" autoFocus value={oldPw} onChange={(e) => setOldPw(e.target.value)} required />
      </Field>
      <Field label="Mật khẩu mới" hint="6–128 ký tự, không chứa tên đăng nhập. Nên dùng cụm từ dài dễ nhớ.">
        <input className="input" type="password" autoComplete="new-password" minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} required />
      </Field>
      <Field label="Nhập lại mật khẩu mới">
        <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
      </Field>
      {error != null && <ErrorBox error={error} />}
      <Button variant="primary" className="w-full" loading={busy} type="submit">
        Lưu và tiếp tục
      </Button>
    </form>
  )
}
