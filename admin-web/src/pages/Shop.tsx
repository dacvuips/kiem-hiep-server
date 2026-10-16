import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Banknote, Check, CreditCard, Pencil, Receipt, Search, TrendingUp, X } from 'lucide-react'
import { api, type OrdersPage, type ShopSettings, type TopupOrder } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtDateTime, fmtNum, fmtVnd, ORDER_STATUS } from '../lib/format'
import {
  Badge, Button, Card, Dialog, Empty, ErrorBox, Field, Loading, PageHeader, Pager, ReasonField, Stat, Tabs, useToast,
} from '../components/ui'

type StatusFilter = 'all' | 'pending' | 'paid' | 'cancelled'
const TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'pending', label: 'Chờ thanh toán' },
  { value: 'paid', label: 'Đã thanh toán' },
  { value: 'cancelled', label: 'Đã huỷ' },
]
const SIZE = 20

export default function ShopPage() {
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') as StatusFilter) || 'all'
  const page = Number(params.get('page') || 1)
  const q = params.get('q') || ''
  const [text, setText] = useState(q)
  const [act, setAct] = useState<{ order: TopupOrder; kind: 'approve' | 'cancel' } | null>(null)
  const canWrite = can('shop.write')

  // Gõ xong 300ms mới tìm, đỡ gọi server liên tục.
  useEffect(() => {
    const t = setTimeout(() => {
      if (text !== q) setParams((p) => { p.set('q', text); p.delete('page'); return p }, { replace: true })
    }, 300)
    return () => clearTimeout(t)
  }, [text, q, setParams])

  const query = useQuery({
    queryKey: ['shop-orders', q, status, page],
    queryFn: () =>
      api.get<OrdersPage>(`/shop/orders?q=${encodeURIComponent(q)}&status=${status === 'all' ? '' : status}&page=${page}&size=${SIZE}`),
    placeholderData: keepPreviousData,
  })
  const set = (k: string, v: string) => setParams((p) => { p.set(k, v); if (k !== 'page') p.delete('page'); return p })
  const sum = query.data?.summary

  return (
    <>
      <PageHeader title="Nạp thẻ" desc="Đơn nạp của người chơi, doanh thu và tỉ lệ quy đổi Xu." />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Doanh thu tổng" value={sum ? fmtVnd(sum.revenue_vnd) : '—'} icon={<Banknote className="h-4 w-4" />} tone="gold" />
        <Stat label="Doanh thu hôm nay" value={sum ? fmtVnd(sum.revenue_today_vnd) : '—'} icon={<TrendingUp className="h-4 w-4" />} tone="ok" />
        <Stat label="Số đơn đã thanh toán" value={sum ? fmtNum(sum.paid_orders) : '—'} icon={<Receipt className="h-4 w-4" />} tone="info" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card overflow-hidden lg:col-span-2">
          <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input className="input pl-9" placeholder="Mã đơn hoặc tên tài khoản…" value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            {query.data && <span className="text-sm text-muted tabular">{query.data.total} đơn</span>}
          </div>
          <div className="px-4 pt-1">
            <Tabs value={status} onChange={(v) => set('status', v)} items={TABS} />
          </div>
          {query.isLoading ? (
            <Loading />
          ) : query.error ? (
            <div className="p-4"><ErrorBox error={query.error} /></div>
          ) : query.data!.orders.length === 0 ? (
            <Empty icon={<CreditCard className="h-8 w-8" />} title="Không có đơn nạp nào" desc={q ? 'Thử từ khóa khác.' : undefined} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-line bg-subtle/50">
                    <tr>
                      <th className="th">Mã đơn</th>
                      <th className="th">Tài khoản</th>
                      <th className="th">Mệnh giá</th>
                      <th className="th">Xu</th>
                      <th className="th hidden md:table-cell">Cổng</th>
                      <th className="th">Trạng thái</th>
                      <th className="th hidden lg:table-cell">Tạo lúc</th>
                      <th className="th hidden lg:table-cell">Thanh toán lúc</th>
                      {canWrite && <th className="th" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {query.data!.orders.map((o) => {
                      const st = ORDER_STATUS[o.status] ?? { label: o.status, tone: 'neutral' as const }
                      return (
                        <tr key={o.id} className="hover:bg-subtle/60">
                          <td className="td font-mono text-xs" title={o.note || undefined}>{o.code}</td>
                          <td className="td">
                            <Link to={`/accounts/${o.account_id}`} className="font-medium hover:text-accent">{o.username || `#${o.account_id}`}</Link>
                          </td>
                          <td className="td tabular whitespace-nowrap">{fmtVnd(o.amount_vnd)}</td>
                          <td className="td tabular">{fmtNum(o.xu)}</td>
                          <td className="td hidden text-muted md:table-cell">{o.provider}</td>
                          <td className="td"><Badge tone={st.tone} dot>{st.label}</Badge></td>
                          <td className="td hidden text-muted tabular lg:table-cell">{fmtDateTime(o.created_at)}</td>
                          <td className="td hidden text-muted tabular lg:table-cell">{fmtDateTime(o.paid_at)}</td>
                          {canWrite && (
                            <td className="td">
                              {o.status === 'pending' && (
                                <div className="flex justify-end gap-1">
                                  <Button size="sm" variant="ghost" icon={<Check className="h-3.5 w-3.5" />} onClick={() => setAct({ order: o, kind: 'approve' })}>Duyệt</Button>
                                  <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => setAct({ order: o, kind: 'cancel' })}>Huỷ</Button>
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Pager page={page} size={SIZE} total={query.data!.total} onPage={(p) => set('page', String(p))} />
            </>
          )}
        </div>

        <SettingsCard canEdit={can('shop.settings')} />
      </div>

      {act && <OrderDialog order={act.order} kind={act.kind} onClose={() => setAct(null)} />}
    </>
  )
}

function OrderDialog({ order, kind, onClose }: { order: TopupOrder; kind: 'approve' | 'cancel'; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState(false)
  const approve = kind === 'approve'
  const m = useMutation({
    mutationFn: () => api.post(`/shop/orders/${encodeURIComponent(order.code)}/${kind}`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shop-orders'] })
      qc.invalidateQueries({ queryKey: ['wallet', String(order.account_id)] })
      toast(approve ? `Đã duyệt đơn ${order.code}` : `Đã huỷ đơn ${order.code}`)
      onClose()
    },
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title={approve ? 'Duyệt đơn nạp' : 'Huỷ đơn nạp'}
      desc={
        approve
          ? 'Đánh dấu đơn đã thanh toán và cộng Xu vào ví tài khoản. Chỉ duyệt khi đã xác nhận tiền về.'
          : 'Đơn chuyển sang Đã huỷ, không cộng Xu.'
      }
      footer={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button
            variant={approve ? 'primary' : 'danger'}
            loading={m.isPending}
            disabled={reason.trim().length < 5 || !confirm}
            onClick={() => m.mutate()}
          >
            {approve ? 'Duyệt' : 'Huỷ đơn'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-subtle/50 p-3 text-sm">
          <div><dt className="text-xs text-muted">Mã đơn</dt><dd className="font-mono text-xs font-medium">{order.code}</dd></div>
          <div><dt className="text-xs text-muted">Tài khoản</dt><dd className="font-medium">{order.username || `#${order.account_id}`}</dd></div>
          <div><dt className="text-xs text-muted">Mệnh giá</dt><dd className="font-medium tabular">{fmtVnd(order.amount_vnd)}</dd></div>
          <div><dt className="text-xs text-muted">Xu</dt><dd className="font-medium tabular">{fmtNum(order.xu)}</dd></div>
        </dl>
        <ReasonField value={reason} onChange={setReason} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          {approve
            ? `Tôi xác nhận cộng ${fmtNum(order.xu)} Xu cho tài khoản ${order.username || `#${order.account_id}`}.`
            : `Tôi xác nhận huỷ đơn ${order.code}.`}
        </label>
        {m.error && <ErrorBox error={m.error} />}
      </div>
    </Dialog>
  )
}

function SettingsCard({ canEdit }: { canEdit: boolean }) {
  const q = useQuery({ queryKey: ['shop-settings'], queryFn: () => api.get<ShopSettings>('/shop/settings') })
  const [edit, setEdit] = useState(false)
  const s = q.data
  return (
    <Card
      title="Cài đặt quy đổi"
      className="h-fit"
      action={canEdit && s && (
        <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEdit(true)}>Sửa</Button>
      )}
    >
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <div className="space-y-4 text-sm">
          {s!.sandbox && (
            <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2.5 text-warn">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <Badge tone="warn">Cổng giả lập đang BẬT</Badge>
                <p className="mt-1 text-xs">Đơn có thể được thanh toán mà không có tiền thật. Tắt trước khi mở cho người chơi.</p>
              </div>
            </div>
          )}
          <dl className="space-y-3">
            <div>
              <dt className="text-xs text-muted">Xu mỗi 10.000đ</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular">{fmtNum(s!.xu_per_10k)} Xu</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Nguyên bảo mỗi Xu</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular">{fmtNum(s!.jade_per_xu)} Nguyên bảo</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Cổng thanh toán</dt>
              <dd className="mt-0.5 font-medium">{s!.provider || '—'}</dd>
            </div>
          </dl>
          {!canEdit && <p className="text-xs text-muted">Chỉ Super Admin được đổi tỉ lệ quy đổi.</p>}
        </div>
      )}
      {edit && s && <SettingsDialog init={s} onClose={() => setEdit(false)} />}
    </Card>
  )
}

function SettingsDialog({ init, onClose }: { init: ShopSettings; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [xu, setXu] = useState(init.xu_per_10k)
  const [jade, setJade] = useState(init.jade_per_xu)
  const [reason, setReason] = useState('')
  const valid = Number.isInteger(xu) && xu >= 1 && xu <= 100000 && Number.isInteger(jade) && jade >= 1 && jade <= 1000
  const m = useMutation({
    mutationFn: () => api.put('/shop/settings', { xu_per_10k: xu, jade_per_xu: jade, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shop-settings'] })
      toast('Đã lưu tỉ lệ quy đổi')
      onClose()
    },
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title="Sửa tỉ lệ quy đổi"
      desc="Áp dụng cho các đơn nạp tạo sau khi lưu. Đơn đã tạo giữ nguyên số Xu."
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button variant="primary" loading={m.isPending} disabled={!valid || reason.trim().length < 5} onClick={() => m.mutate()}>Lưu</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Xu mỗi 10.000đ" hint="1 – 100.000">
            <input className="input tabular" type="number" min={1} max={100000} value={xu} onChange={(e) => setXu(Number(e.target.value))} />
          </Field>
          <Field label="Nguyên bảo mỗi Xu" hint="1 – 1.000">
            <input className="input tabular" type="number" min={1} max={1000} value={jade} onChange={(e) => setJade(Number(e.target.value))} />
          </Field>
        </div>
        <ReasonField value={reason} onChange={setReason} />
        {m.error && <ErrorBox error={m.error} />}
      </div>
    </Dialog>
  )
}
