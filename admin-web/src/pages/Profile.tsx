import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtDateTime, ROLE_DESC, ROLE_LABEL } from '../lib/format'
import { Badge, Button, Card, ErrorBox, Field, PageHeader, useToast } from '../components/ui'

export default function ProfilePage() {
  const { me, refresh } = useAuth()
  const toast = useToast()
  const [oldPw, setOldPw] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const m = useMutation({
    mutationFn: () => {
      if (pw !== pw2) throw new Error('Nhập lại mật khẩu không khớp')
      return api.post('/me/password', { old_password: oldPw, new_password: pw })
    },
    onSuccess: () => {
      setOldPw('')
      setPw('')
      setPw2('')
      toast('Đã đổi mật khẩu. Các phiên khác đã bị đăng xuất.')
      refresh()
    },
  })
  const a = me!.admin
  const submit = (e: FormEvent) => {
    e.preventDefault()
    m.mutate()
  }
  return (
    <>
      <PageHeader title="Hồ sơ của bạn" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Tài khoản admin" className="h-fit">
          <dl className="space-y-3 text-sm">
            <div><dt className="text-xs text-muted">Tên đăng nhập</dt><dd className="font-medium">{a.username}</dd></div>
            <div>
              <dt className="text-xs text-muted">Vai trò</dt>
              <dd className="mt-0.5 flex items-center gap-2"><Badge tone="gold">{ROLE_LABEL[a.role]}</Badge><span className="text-xs text-muted">{ROLE_DESC[a.role]}</span></dd>
            </div>
            <div><dt className="text-xs text-muted">Xác thực 2 lớp</dt><dd><Badge tone="ok">Đang bật</Badge></dd></div>
            <div><dt className="text-xs text-muted">Đăng nhập gần nhất</dt><dd>{fmtDateTime(a.last_login_at)} <span className="text-muted tabular">· {a.last_login_ip}</span></dd></div>
          </dl>
          <p className="mt-4 text-xs text-muted">Mất điện thoại xác thực? Nhờ Super Admin đặt lại 2FA cho bạn.</p>
        </Card>
        <Card title="Đổi mật khẩu">
          <form onSubmit={submit} className="space-y-4">
            <Field label="Mật khẩu hiện tại">
              <input className="input" type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} required />
            </Field>
            <Field label="Mật khẩu mới" hint="6–128 ký tự, không chứa tên đăng nhập.">
              <input className="input" type="password" autoComplete="new-password" minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} required />
            </Field>
            <Field label="Nhập lại mật khẩu mới">
              <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
            </Field>
            {m.error && <ErrorBox error={m.error} />}
            <Button variant="primary" type="submit" loading={m.isPending}>Đổi mật khẩu</Button>
          </form>
        </Card>
      </div>
    </>
  )
}
