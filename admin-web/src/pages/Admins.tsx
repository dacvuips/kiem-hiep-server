import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus, ShieldOff, UserCog } from 'lucide-react'
import { api, type Admin, type Role } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtAgo, ROLE_DESC, ROLE_LABEL } from '../lib/format'
import { Badge, Button, Dialog, Empty, ErrorBox, Field, Loading, PageHeader, useToast } from '../components/ui'

const ROLES: Role[] = ['viewer', 'support', 'gm', 'super']

type Pending =
  | { kind: 'create' }
  | { kind: 'edit'; admin: Admin }
  | { kind: 'reset-2fa' | 'reset-password'; admin: Admin }

export default function AdminsPage() {
  const { me } = useAuth()
  const q = useQuery({ queryKey: ['admins'], queryFn: () => api.get<{ items: Admin[] }>('/admins') })
  const [pending, setPending] = useState<Pending | null>(null)
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null)

  return (
    <>
      <PageHeader
        title="Quản lý admin"
        desc="Tạo tài khoản admin và phân quyền. Admin mới nhận mật khẩu tạm, phải đổi mật khẩu và bật 2FA ở lần đăng nhập đầu."
        actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setPending({ kind: 'create' })}>Thêm admin</Button>}
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <div className="card overflow-hidden">
          {q.data!.items.length === 0 ? (
            <Empty icon={<UserCog className="h-8 w-8" />} title="Chưa có admin" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-line bg-subtle/50">
                  <tr>
                    <th className="th">Admin</th>
                    <th className="th">Vai trò</th>
                    <th className="th">Bảo mật</th>
                    <th className="th hidden md:table-cell">Đăng nhập gần nhất</th>
                    <th className="th text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {q.data!.items.map((a) => (
                    <tr key={a.id} className={a.disabled ? 'opacity-60' : 'hover:bg-subtle/60'}>
                      <td className="td">
                        <div className="font-medium">
                          {a.display_name || a.username}
                          {a.id === me?.admin.id && <span className="ml-2 text-xs font-normal text-muted">(bạn)</span>}
                        </div>
                        <div className="text-xs text-muted">{a.username}</div>
                      </td>
                      <td className="td">
                        <Badge tone={a.role === 'super' ? 'gold' : a.role === 'gm' ? 'danger' : a.role === 'support' ? 'info' : 'neutral'}>{ROLE_LABEL[a.role]}</Badge>
                      </td>
                      <td className="td">
                        <div className="flex flex-wrap gap-1">
                          {a.disabled && <Badge tone="danger">Vô hiệu</Badge>}
                          {a.totp_enabled ? <Badge tone="ok">2FA</Badge> : <Badge tone="warn">Chưa bật 2FA</Badge>}
                          {a.must_change_password && <Badge tone="warn">Mật khẩu tạm</Badge>}
                        </div>
                      </td>
                      <td className="td hidden md:table-cell">
                        <div>{fmtAgo(a.last_login_at)}</div>
                        <div className="text-xs text-muted tabular">{a.last_login_ip || '—'}</div>
                      </td>
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setPending({ kind: 'edit', admin: a })}>Sửa</Button>
                          <Button size="sm" variant="ghost" icon={<ShieldOff className="h-3.5 w-3.5" />} onClick={() => setPending({ kind: 'reset-2fa', admin: a })}>2FA</Button>
                          <Button size="sm" variant="ghost" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setPending({ kind: 'reset-password', admin: a })}>Mật khẩu</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {pending && <AdminDialog pending={pending} onClose={() => setPending(null)} onSecret={setSecret} />}
      <Dialog
        open={!!secret}
        onClose={() => setSecret(null)}
        title={secret?.title ?? ''}
        desc="Chỉ hiện 1 lần. Gửi cho admin qua kênh an toàn; họ phải đổi mật khẩu và bật 2FA khi đăng nhập."
        footer={<Button variant="primary" onClick={() => setSecret(null)}>Đã ghi lại</Button>}
      >
        <code className="block select-all rounded-lg border border-line bg-subtle px-3 py-2.5 font-mono text-base font-semibold">{secret?.value}</code>
      </Dialog>
    </>
  )
}

function AdminDialog({ pending, onClose, onSecret }: {
  pending: Pending
  onClose: () => void
  onSecret: (s: { title: string; value: string }) => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const admin = pending.kind === 'create' ? null : pending.admin
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState(admin?.display_name ?? '')
  const [role, setRole] = useState<Role>(admin?.role ?? 'support')
  const [disabled, setDisabled] = useState(admin?.disabled ?? false)
  const [reason, setReason] = useState('')

  const m = useMutation({
    mutationFn: async () => {
      if (pending.kind === 'create') return api.post<{ temp_password: string }>('/admins', { username, display_name: displayName, role, reason })
      if (pending.kind === 'edit') return api.post<{ temp_password?: string }>(`/admins/${admin!.id}/update`, { display_name: displayName, role, disabled, reason })
      return api.post<{ temp_password?: string }>(`/admins/${admin!.id}/${pending.kind}`, { reason })
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['admins'] })
      onClose()
      if (r.temp_password) onSecret({ title: pending.kind === 'create' ? `Mật khẩu tạm cho ${username}` : `Mật khẩu tạm mới cho ${admin!.username}`, value: r.temp_password })
      else toast('Đã lưu')
    },
  })

  const titles = {
    create: 'Thêm admin',
    edit: `Sửa ${admin?.username}`,
    'reset-2fa': `Đặt lại 2FA cho ${admin?.username}`,
    'reset-password': `Đặt lại mật khẩu cho ${admin?.username}`,
  }
  const descs = {
    create: undefined,
    edit: undefined,
    'reset-2fa': 'Dùng khi admin mất điện thoại. Họ sẽ bị đăng xuất và phải quét mã QR mới ở lần đăng nhập sau.',
    'reset-password': 'Tạo mật khẩu tạm mới, đăng xuất mọi phiên của admin này.',
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={titles[pending.kind]}
      desc={descs[pending.kind]}
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button variant="primary" loading={m.isPending} disabled={reason.trim().length < 5 || (pending.kind === 'create' && username.length < 3)} onClick={() => m.mutate()}>
            Xác nhận
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {pending.kind === 'create' && (
          <Field label="Tên đăng nhập" hint="3–20 ký tự: chữ thường không dấu, số, dấu _">
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoFocus />
          </Field>
        )}
        {(pending.kind === 'create' || pending.kind === 'edit') && (
          <>
            <Field label="Tên hiển thị">
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>
            <Field label="Vai trò">
              <div className="space-y-2">
                {ROLES.map((r) => (
                  <label key={r} className={'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition ' + (role === r ? 'border-accent bg-accent/5' : 'border-line hover:bg-subtle')}>
                    <input type="radio" name="role" className="mt-0.5 accent-[rgb(var(--accent))]" checked={role === r} onChange={() => setRole(r)} />
                    <span>
                      <span className="block text-sm font-medium">{ROLE_LABEL[r]}</span>
                      <span className="block text-xs text-muted">{ROLE_DESC[r]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>
          </>
        )}
        {pending.kind === 'edit' && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--danger))]" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} />
            Vô hiệu hóa tài khoản admin này
          </label>
        )}
        <Field label="Lý do" hint="Bắt buộc, ghi vào nhật ký.">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {m.error && <ErrorBox error={m.error} />}
      </div>
    </Dialog>
  )
}
