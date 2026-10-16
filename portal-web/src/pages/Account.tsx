import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { History, KeyRound, LogIn, ScrollText, Server, User, Users } from 'lucide-react'
import { api, webChangePassword, type Account, type Character, type GameServer, type LoginRow } from '../lib/api'
import { useAuth, useWallet } from '../lib/auth'
import { deviceLabel, fmtDateTime, fmtVnd, fmtXu, LEDGER_KIND, LOGIN_METHOD, ORDER_STATUS, REGION_LABEL, SERVER_STATUS } from '../lib/format'
import { sectName } from '../lib/sects'
import { Alert, Field, PageBanner, PasswordInput, Spinner, errMsg, useToast } from '../components/ui'
import { checkPassword } from './AuthPages'

const TABS = [
  { id: 'thong-tin', label: 'Thông tin', icon: User },
  { id: 'mat-khau', label: 'Đổi mật khẩu', icon: KeyRound },
  { id: 'nhan-vat', label: 'Nhân vật', icon: Users },
  { id: 'lich-su-nap', label: 'Lịch sử nạp', icon: History },
  { id: 'dang-nhap', label: 'Lịch sử đăng nhập', icon: LogIn },
] as const
type TabId = (typeof TABS)[number]['id']

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="frame p-5 sm:p-6">
      <h2 className="title-gold mb-5 text-2xl">{title}</h2>
      {children}
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-sm border border-dashed border-gold-700/50 px-4 py-8 text-center text-sm text-parch-300/60">{children}</p>
}

function InfoTab() {
  const { account } = useAuth()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Account>('/v1/account/me') })
  const wallet = useWallet()
  const a = me.data ?? account
  return (
    <Panel title="Thông tin tài khoản">
      {me.isError && <Alert className="mb-4">{errMsg(me.error)}</Alert>}
      <dl className="grid gap-4 sm:grid-cols-2">
        {[
          ['Tên đăng nhập', a?.username],
          ['Email', a?.email || 'Chưa có'],
          ['Số dư ví', wallet.data ? fmtXu(wallet.data.xu) : '…'],
          ['Tổng đã nạp', wallet.data ? fmtVnd(wallet.data.total_topup_vnd) : '…'],
        ].map(([k, v]) => (
          <div key={k} className="rounded-sm border border-gold-700/40 bg-ink-950/50 px-4 py-3">
            <dt className="text-xs uppercase tracking-wider text-parch-300/60">{k}</dt>
            <dd className="mt-1 break-all font-serif text-lg text-parch-50">{v}</dd>
          </div>
        ))}
      </dl>
      {me.data?.google_linked && <p className="mt-4 text-sm text-parch-200/70">Tài khoản đã liên kết Google.</p>}
      <div className="mt-6 flex flex-wrap gap-3">
        <Link to="/nap-the" className="btn-seal">
          Nạp thẻ
        </Link>
        <Link to="/tai-khoan?tab=mat-khau" className="btn-ghost">
          Đổi mật khẩu
        </Link>
      </div>
    </Panel>
  )
}

function PasswordTab() {
  const { account } = useAuth()
  const toast = useToast()
  const [oldPw, setOldPw] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!oldPw) return setErr('Vui lòng nhập mật khẩu hiện tại')
    const pe = checkPassword(pw, account?.username ?? '')
    if (pe) return setErr(pe)
    if (pw !== pw2) return setErr('Mật khẩu nhập lại không khớp')
    if (pw === oldPw) return setErr('Mật khẩu mới phải khác mật khẩu hiện tại')
    setBusy(true)
    try {
      await webChangePassword(oldPw, pw)
      setOldPw('')
      setPw('')
      setPw2('')
      toast('ok', 'Đổi mật khẩu thành công. Các thiết bị khác cần đăng nhập lại.')
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Đổi mật khẩu">
      <form onSubmit={submit} className="max-w-md space-y-4" noValidate>
        {err && <Alert>{err}</Alert>}
        <Field label="Mật khẩu hiện tại" htmlFor="a-old">
          <PasswordInput id="a-old" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
        </Field>
        <Field label="Mật khẩu mới" htmlFor="a-new" hint="6–64 ký tự, không chứa tên đăng nhập">
          <PasswordInput id="a-new" autoComplete="new-password" maxLength={64} value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Nhập lại mật khẩu mới" htmlFor="a-new2">
          <PasswordInput id="a-new2" autoComplete="new-password" maxLength={64} value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </Field>
        <button type="submit" className="btn-gold" disabled={busy}>
          {busy ? <Spinner className="text-ink-950" /> : <KeyRound className="h-4 w-4" aria-hidden />} Cập nhật mật khẩu
        </button>
        <p className="text-xs text-parch-300/60">
          Quên mật khẩu hiện tại?{' '}
          <Link to="/quen-mat-khau" className="text-gold-400 hover:text-gold-200">
            Lấy lại qua email
          </Link>
        </p>
      </form>
    </Panel>
  )
}

function CharactersTab() {
  const servers = useQuery({ queryKey: ['servers'], queryFn: () => api.get<{ servers: GameServer[] }>('/v1/servers') })
  const list = servers.data?.servers ?? []
  const chars = useQueries({
    queries: list.map((s) => ({
      queryKey: ['characters', s.id],
      queryFn: () => api.get<{ characters: Character[] }>(`/v1/characters?server_id=${s.id}`),
      enabled: s.characters > 0,
    })),
  })
  return (
    <Panel title="Nhân vật">
      {servers.isLoading ? (
        <Spinner label="Đang tải máy chủ…" />
      ) : servers.isError ? (
        <Alert>{errMsg(servers.error)}</Alert>
      ) : list.length === 0 ? (
        <Empty>Chưa có máy chủ nào.</Empty>
      ) : (
        <div className="space-y-6">
          {list.map((s, i) => {
            const q = chars[i]
            return (
              <div key={s.id}>
                <h3 className="mb-2 flex flex-wrap items-center gap-2 font-serif text-lg text-gold-200">
                  <Server className="h-4 w-4 text-gold-500" aria-hidden />
                  {s.name}
                  {REGION_LABEL[s.region] && <span className="text-sm text-parch-300/60">· {REGION_LABEL[s.region]}</span>}
                  {s.is_new && <span className="badge border-seal-500/60 bg-seal-700/20 text-seal-400">Mới</span>}
                  {SERVER_STATUS[s.status] && <span className="badge border-gold-700/60 text-parch-200/70">{SERVER_STATUS[s.status]}</span>}
                </h3>
                {s.characters === 0 ? (
                  <Empty>Chưa có nhân vật trên máy chủ này.</Empty>
                ) : q?.isLoading ? (
                  <Spinner label="Đang tải nhân vật…" />
                ) : q?.isError ? (
                  <Alert>{errMsg(q.error)}</Alert>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Tên nhân vật</th>
                          <th>Cấp</th>
                          <th>Môn phái</th>
                          <th>Giới tính</th>
                          <th>Cập nhật</th>
                        </tr>
                      </thead>
                      <tbody>
                        {q?.data?.characters.map((c) => (
                          <tr key={c.id}>
                            <td className="font-semibold text-parch-50">{c.name}</td>
                            <td className="tabular">{c.level}</td>
                            <td>{sectName(c.sect_id)}</td>
                            <td>{c.gender === 1 ? 'Nữ' : 'Nam'}</td>
                            <td className="whitespace-nowrap text-parch-300/70">{fmtDateTime(c.updated_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

function TopupHistoryTab() {
  const wallet = useWallet()
  const w = wallet.data
  return (
    <div className="space-y-6">
      <Panel title="Đơn nạp thẻ">
        {wallet.isLoading ? (
          <Spinner label="Đang tải…" />
        ) : wallet.isError ? (
          <Alert>{errMsg(wallet.error)}</Alert>
        ) : !w?.orders.length ? (
          <Empty>
            Chưa có đơn nạp nào.{' '}
            <Link to="/nap-the" className="text-gold-300 hover:text-gold-200">
              Nạp thẻ ngay
            </Link>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mã đơn</th>
                  <th>Mệnh giá</th>
                  <th>Xu</th>
                  <th>Trạng thái</th>
                  <th>Thời gian</th>
                </tr>
              </thead>
              <tbody>
                {w.orders.map((o) => {
                  const st = ORDER_STATUS[o.status] ?? { label: o.status, cls: '' }
                  return (
                    <tr key={o.code}>
                      <td>
                        <Link to={`/nap-the/thanh-toan/${o.code}`} className="font-mono text-gold-300 hover:text-gold-200">
                          {o.code}
                        </Link>
                      </td>
                      <td className="tabular">{fmtVnd(o.amount_vnd)}</td>
                      <td className="tabular">{fmtXu(o.xu)}</td>
                      <td>
                        <span className={clsx('badge', st.cls)}>{st.label}</span>
                      </td>
                      <td className="whitespace-nowrap text-parch-300/70">{fmtDateTime(o.paid_at ?? o.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Biến động ví Xu">
        {!w ? (
          wallet.isLoading ? <Spinner label="Đang tải…" /> : null
        ) : !w.ledger.length ? (
          <Empty>Chưa có biến động nào.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Loại</th>
                  <th>Thay đổi</th>
                  <th>Số dư sau</th>
                  <th>Ghi chú</th>
                  <th>Thời gian</th>
                </tr>
              </thead>
              <tbody>
                {w.ledger.map((l, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap">{LEDGER_KIND[l.kind] ?? l.kind}</td>
                    <td className={clsx('tabular whitespace-nowrap font-semibold', l.delta >= 0 ? 'text-emerald-300' : 'text-seal-400')}>
                      {l.delta >= 0 ? '+' : '−'}
                      {fmtXu(Math.abs(l.delta))}
                    </td>
                    <td className="tabular whitespace-nowrap">{fmtXu(l.balance_after)}</td>
                    <td className="text-parch-200/80">{l.note || l.ref || '—'}</td>
                    <td className="whitespace-nowrap text-parch-300/70">{fmtDateTime(l.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

function LoginsTab() {
  const q = useQuery({ queryKey: ['logins'], queryFn: () => api.get<{ logins: LoginRow[] }>('/v1/account/logins') })
  return (
    <Panel title="Lịch sử đăng nhập">
      {q.isLoading ? (
        <Spinner label="Đang tải…" />
      ) : q.isError ? (
        <Alert>{errMsg(q.error)}</Alert>
      ) : !q.data?.logins.length ? (
        <Empty>Chưa có dữ liệu.</Empty>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Kết quả</th>
                  <th>Cách đăng nhập</th>
                  <th>Thiết bị</th>
                  <th>Địa chỉ IP</th>
                </tr>
              </thead>
              <tbody>
                {q.data.logins.map((l, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap">{fmtDateTime(l.created_at)}</td>
                    <td>
                      <span className={clsx('badge', l.ok ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300' : 'border-seal-400/60 bg-seal-500/10 text-seal-400')}>
                        {l.ok ? 'Thành công' : 'Thất bại'}
                      </span>
                    </td>
                    <td>{LOGIN_METHOD[l.method] ?? l.method}</td>
                    <td title={l.user_agent}>{deviceLabel(l.user_agent)}</td>
                    <td className="font-mono text-xs text-parch-200/80">{l.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-parch-300/60">
            <ScrollText className="h-3.5 w-3.5" aria-hidden /> Thấy lần đăng nhập lạ? Hãy đổi mật khẩu ngay.
          </p>
        </>
      )}
    </Panel>
  )
}

export default function AccountPage() {
  const [params, setParams] = useSearchParams()
  const { account } = useAuth()
  const tab: TabId = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'thong-tin') as TabId
  const setTab = (id: TabId) => setParams(id === 'thong-tin' ? {} : { tab: id }, { replace: true })

  return (
    <>
      <PageBanner title="Tài Khoản" sub={account ? `Xin chào, ${account.username}` : undefined} />
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Mục tài khoản" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={clsx(
                'flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-sm border px-4 py-2.5 text-left font-serif text-[15px] transition',
                tab === t.id ? 'border-gold-400 bg-gold-500/15 text-gold-100 shadow-glow' : 'border-gold-700/50 bg-ink-900/60 text-parch-200/80 hover:border-gold-500 hover:text-gold-200',
              )}
            >
              <t.icon className="h-4 w-4" aria-hidden />
              {t.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {tab === 'thong-tin' && <InfoTab />}
          {tab === 'mat-khau' && <PasswordTab />}
          {tab === 'nhan-vat' && <CharactersTab />}
          {tab === 'lich-su-nap' && <TopupHistoryTab />}
          {tab === 'dang-nhap' && <LoginsTab />}
        </div>
      </div>
    </>
  )
}
