import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Ban, Copy, KeyRound, LogOut, Mail, MessageSquareOff, Pencil, RotateCcw, ShieldCheck, Unlock, Volume2,
} from 'lucide-react'
import { api, type AccountDetail } from '../lib/api'
import { useAuth } from '../lib/auth'
import { actionLabel, deviceLabel, fmtAgo, fmtDateTime, isFuture, SECT_LABEL } from '../lib/format'
import { AccountStatus } from '../components/AccountsTable'
import { Badge, Button, Card, Dialog, Empty, ErrorBox, Field, Loading, ReasonField, Tabs, useToast } from '../components/ui'
import WalletSection from '../components/WalletSection'

type Action = 'ban' | 'unban' | 'mute' | 'unmute' | 'logout-all' | 'reset-password' | 'email'

const ACTIONS: Record<Action, { title: string; desc: string; button: string; danger?: boolean; hours?: 'ban' | 'mute'; email?: boolean; perm: string }> = {
  ban: { title: 'Khóa tài khoản', desc: 'Người chơi bị đăng xuất ngay và không đăng nhập được tới khi hết hạn.', button: 'Khóa', danger: true, hours: 'ban', perm: 'punish' },
  unban: { title: 'Mở khóa tài khoản', desc: 'Người chơi đăng nhập lại được ngay.', button: 'Mở khóa', perm: 'punish' },
  mute: { title: 'Cấm chat', desc: 'Người chơi vẫn chơi được nhưng không gửi được tin nhắn.', button: 'Cấm chat', hours: 'mute', perm: 'punish' },
  unmute: { title: 'Bỏ cấm chat', desc: 'Người chơi chat lại được ngay.', button: 'Bỏ cấm chat', perm: 'punish' },
  'logout-all': { title: 'Đăng xuất mọi thiết bị', desc: 'Mọi phiên đăng nhập của tài khoản bị hủy ngay, kể cả đang chơi.', button: 'Đăng xuất tất cả', perm: 'support' },
  'reset-password': { title: 'Đặt lại mật khẩu', desc: 'Tạo mật khẩu tạm mới và đăng xuất mọi thiết bị. Mật khẩu tạm chỉ hiện 1 lần — đọc cho chủ tài khoản sau khi đã xác minh danh tính.', button: 'Đặt lại', danger: true, perm: 'support' },
  email: { title: 'Đổi email', desc: 'Email dùng để lấy lại mật khẩu. Chỉ đổi khi đã xác minh chủ tài khoản.', button: 'Lưu email', email: true, perm: 'support' },
}

const BAN_HOURS = [
  { v: 1, l: '1 giờ' }, { v: 24, l: '1 ngày' }, { v: 72, l: '3 ngày' }, { v: 168, l: '7 ngày' }, { v: 720, l: '30 ngày' }, { v: 0, l: 'Vĩnh viễn' },
]
const MUTE_HOURS = [
  { v: 1, l: '1 giờ' }, { v: 6, l: '6 giờ' }, { v: 24, l: '1 ngày' }, { v: 72, l: '3 ngày' }, { v: 168, l: '7 ngày' }, { v: 720, l: '30 ngày' },
]

type TabKey = 'characters' | 'logins' | 'sessions' | 'audit'

export default function AccountDetailPage() {
  const { id } = useParams()
  const { can } = useAuth()
  const [tab, setTab] = useState<TabKey>('characters')
  const [action, setAction] = useState<Action | null>(null)
  const [tempPw, setTempPw] = useState('')
  const q = useQuery({ queryKey: ['account', id], queryFn: () => api.get<AccountDetail>(`/accounts/${id}`) })

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const d = q.data!
  const a = d.account
  const banned = a.status === 'banned'
  const muted = isFuture(a.muted_until)

  const btn = (act: Action, icon: ReactNode, variant: 'secondary' | 'danger' = 'secondary') =>
    can(ACTIONS[act].perm) && (
      <Button size="sm" variant={variant} icon={icon} onClick={() => setAction(act)}>{ACTIONS[act].title}</Button>
    )

  return (
    <>
      <Link to="/accounts" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Tài khoản
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">{a.username}</h1>
            <AccountStatus a={a} />
            {a.google_linked && <Badge tone="info">Google</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">#{a.id} · {a.email}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {banned ? btn('unban', <Unlock className="h-3.5 w-3.5" />) : btn('ban', <Ban className="h-3.5 w-3.5" />, 'danger')}
          {muted ? btn('unmute', <Volume2 className="h-3.5 w-3.5" />) : btn('mute', <MessageSquareOff className="h-3.5 w-3.5" />)}
          {btn('logout-all', <LogOut className="h-3.5 w-3.5" />)}
          {btn('reset-password', <KeyRound className="h-3.5 w-3.5" />)}
          {btn('email', <Mail className="h-3.5 w-3.5" />)}
        </div>
      </div>

      {banned && (
        <div className="mb-6 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm">
          <span className="font-medium text-danger">{a.banned_until ? `Bị khóa đến ${fmtDateTime(a.banned_until)}` : 'Bị khóa vĩnh viễn'}</span>
          {a.ban_reason && <span className="text-muted"> — {a.ban_reason}</span>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Thông tin" className="h-fit">
          <dl className="space-y-3 text-sm">
            <Info label="Ngày tạo" value={fmtDateTime(a.created_at)} sub={a.created_ip && `IP ${a.created_ip}`} />
            <Info label="Đăng nhập gần nhất" value={a.last_login_at ? fmtDateTime(a.last_login_at) : 'Chưa có'} sub={a.last_login_ip && `IP ${a.last_login_ip}`} />
            <Info label="Cấm chat" value={muted ? `Đến ${fmtDateTime(a.muted_until)}` : 'Không'} />
            <Info label="Nhân vật" value={`${a.characters} đang dùng`} />
            <Info label="Phiên đang mở" value={`${d.sessions.length} thiết bị`} />
          </dl>
        </Card>

        <div className="card overflow-hidden lg:col-span-2">
          <div className="px-4 pt-1">
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: 'characters', label: 'Nhân vật', count: d.characters.length },
                { value: 'logins', label: 'Đăng nhập', count: d.logins.length },
                { value: 'sessions', label: 'Phiên', count: d.sessions.length },
                { value: 'audit', label: 'Nhật ký xử lý', count: d.audit.length },
              ]}
            />
          </div>
          {tab === 'characters' && <Characters d={d} canRestore={can('punish')} canEdit={can('characters.write')} />}
          {tab === 'logins' && (
            <SimpleTable
              empty="Chưa có lượt đăng nhập"
              head={['Thời gian', 'Kết quả', 'IP', 'Thiết bị']}
              rows={d.logins.map((l) => [
                fmtDateTime(l.created_at),
                l.ok ? <Badge tone="ok">{l.method === 'register' ? 'Tạo tài khoản' : 'Thành công'}</Badge> : <Badge tone="danger">Sai mật khẩu</Badge>,
                <span className="tabular">{l.ip}</span>,
                <span title={l.user_agent}>{deviceLabel(l.user_agent)}</span>,
              ])}
            />
          )}
          {tab === 'sessions' && (
            <SimpleTable
              empty="Không có phiên nào đang mở"
              head={['Bắt đầu', 'Dùng gần nhất', 'IP', 'Thiết bị']}
              rows={d.sessions.map((s) => [fmtDateTime(s.created_at), fmtAgo(s.last_used_at), <span className="tabular">{s.ip}</span>, deviceLabel(s.user_agent)])}
            />
          )}
          {tab === 'audit' && (
            <SimpleTable
              empty="Chưa có thao tác admin nào"
              head={['Thời gian', 'Thao tác', 'Admin', 'Lý do']}
              rows={d.audit.map((x) => [fmtDateTime(x.created_at), actionLabel(x.action), x.admin || 'Hệ thống', <span className="text-muted">{x.reason || '—'}</span>])}
            />
          )}
        </div>
      </div>

      <WalletSection accountId={a.id} />

      {action && (
        <ActionDialog
          action={action}
          accountId={a.id}
          email={a.email}
          onClose={() => setAction(null)}
          onTempPassword={setTempPw}
        />
      )}
      <Dialog
        open={!!tempPw}
        onClose={() => setTempPw('')}
        title="Mật khẩu tạm"
        desc="Chỉ hiện 1 lần. Đọc cho chủ tài khoản và nhắc họ đổi mật khẩu ngay sau khi đăng nhập."
        footer={<Button variant="primary" onClick={() => setTempPw('')}>Đã ghi lại</Button>}
      >
        <CopyBox value={tempPw} />
      </Dialog>
    </>
  )
}

function Info({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
      {sub && <dd className="text-xs text-muted tabular">{sub}</dd>}
    </div>
  )
}

function SimpleTable({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <Empty title={empty} />
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="border-b border-line bg-subtle/50">
          <tr>{head.map((h) => <th key={h} className="th">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className="td">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Characters({ d, canRestore, canEdit }: { d: AccountDetail; canRestore: boolean; canEdit: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [restoreId, setRestoreId] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const m = useMutation({
    mutationFn: () => api.post(`/characters/${restoreId}/restore`, { reason }),
    onSuccess: () => {
      toast('Đã khôi phục nhân vật')
      setRestoreId(null)
      setReason('')
      qc.invalidateQueries({ queryKey: ['account'] })
    },
  })
  return (
    <>
      <SimpleTable
        empty="Tài khoản chưa có nhân vật"
        head={['Nhân vật', 'Máy chủ', 'Cấp', 'Môn phái', 'Cập nhật', '']}
        rows={d.characters.map((c) => [
          <div>
            <Link to={`/characters/${c.id}`} className="font-medium text-accent hover:underline">{c.name}</Link>
            {c.online && <span className="ml-2"><Badge tone="ok" dot>Online</Badge></span>}
            <div className="text-xs text-muted">Ô {c.slot + 1} · {c.gender === 1 ? 'Nữ' : 'Nam'}</div>
          </div>,
          c.server,
          <span className="tabular">{c.level}</span>,
          SECT_LABEL[c.sect_id] ?? (c.sect_id || '—'),
          fmtAgo(c.updated_at),
          c.deleted_at ? (
            <div className="flex items-center justify-end gap-2">
              <Badge tone="neutral">Đã xóa</Badge>
              {canRestore && (
                <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setRestoreId(c.id)}>Khôi phục</Button>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <Badge tone="ok">Đang dùng</Badge>
              <Link to={`/characters/${c.id}`}>
                <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />}>{canEdit ? 'Xem / sửa' : 'Xem'}</Button>
              </Link>
            </div>
          ),
        ])}
      />
      <Dialog
        open={restoreId !== null}
        onClose={() => setRestoreId(null)}
        title="Khôi phục nhân vật"
        desc="Chỉ khôi phục được khi tên và ô nhân vật chưa bị dùng."
        footer={
          <>
            <Button onClick={() => setRestoreId(null)}>Hủy</Button>
            <Button variant="primary" loading={m.isPending} disabled={reason.trim().length < 5} onClick={() => m.mutate()}>Khôi phục</Button>
          </>
        }
      >
        <ReasonField value={reason} onChange={setReason} />
        {m.error && <div className="mt-3"><ErrorBox error={m.error} /></div>}
      </Dialog>
    </>
  )
}

function CopyBox({ value }: { value: string }) {
  const toast = useToast()
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-subtle px-3 py-2.5">
      <code className="flex-1 select-all font-mono text-base font-semibold tracking-wide">{value}</code>
      <Button
        size="sm"
        variant="ghost"
        icon={<Copy className="h-3.5 w-3.5" />}
        onClick={() => navigator.clipboard.writeText(value).then(() => toast('Đã sao chép'), () => toast('Không sao chép được', 'danger'))}
      >
        Sao chép
      </Button>
    </div>
  )
}

function ActionDialog({ action, accountId, email, onClose, onTempPassword }: {
  action: Action
  accountId: number
  email: string
  onClose: () => void
  onTempPassword: (p: string) => void
}) {
  const cfg = ACTIONS[action]
  const qc = useQueryClient()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [hours, setHours] = useState(cfg.hours === 'ban' ? 24 : 24)
  const [newEmail, setNewEmail] = useState(email)
  const m = useMutation({
    mutationFn: () => api.post<{ ok: boolean; temp_password?: string }>(`/accounts/${accountId}/${action}`, { reason, hours, email: newEmail }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['account', String(accountId)] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      onClose()
      if (r.temp_password) onTempPassword(r.temp_password)
      else toast(`${cfg.title}: thành công`)
    },
  })
  const options = cfg.hours === 'ban' ? BAN_HOURS : MUTE_HOURS
  return (
    <Dialog
      open
      onClose={onClose}
      title={cfg.title}
      desc={cfg.desc}
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button
            variant={cfg.danger ? 'danger' : 'primary'}
            loading={m.isPending}
            disabled={reason.trim().length < 5}
            icon={<ShieldCheck className="h-4 w-4" />}
            onClick={() => m.mutate()}
          >
            {cfg.button}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {cfg.hours && (
          <Field label="Thời hạn">
            <div className="grid grid-cols-3 gap-2">
              {options.map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setHours(o.v)}
                  className={
                    'rounded-lg border px-2 py-2 text-sm transition ' +
                    (hours === o.v ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-line hover:bg-subtle')
                  }
                >
                  {o.l}
                </button>
              ))}
            </div>
          </Field>
        )}
        {cfg.email && (
          <Field label="Email mới">
            <input className="input" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </Field>
        )}
        <ReasonField value={reason} onChange={setReason} />
        {m.error && <ErrorBox error={m.error} />}
      </div>
    </Dialog>
  )
}
