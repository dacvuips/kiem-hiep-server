import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowRightLeft, CheckCircle2, FlaskConical, Hourglass, XCircle } from 'lucide-react'
import { api, ApiError, type Order } from '../lib/api'
import { useWallet } from '../lib/auth'
import { fmtDateTime, fmtVnd, fmtXu, ORDER_STATUS } from '../lib/format'
import { Alert, PageBanner, Spinner, errMsg, useToast } from '../components/ui'
import { useShopConfig } from './TopUp'

function Row({ k, v, strong }: { k: string; v: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-gold-700/20 py-2.5 last:border-0">
      <dt className="text-sm text-parch-300/70">{k}</dt>
      <dd className={clsx('text-right', strong ? 'tabular font-serif text-lg font-bold text-gold-200' : 'text-parch-50')}>{v}</dd>
    </div>
  )
}

export default function Payment() {
  const { code = '' } = useParams()
  const qc = useQueryClient()
  const toast = useToast()
  const cfg = useShopConfig()
  const wallet = useWallet()
  const [err, setErr] = useState('')

  const order = useQuery({
    queryKey: ['order', code],
    queryFn: () => api.get<{ order: Order }>(`/v1/shop/orders/${encodeURIComponent(code)}`).then((r) => r.order),
    // Cổng thật: hỏi lại trạng thái mỗi 3 giây khi đơn còn chờ.
    refetchInterval: (q) => (cfg.data && !cfg.data.sandbox && q.state.data?.status === 'pending' ? 3000 : false),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  })

  const onDone = (o: Order) => {
    qc.setQueryData(['order', code], o)
    qc.invalidateQueries({ queryKey: ['wallet'] })
  }

  const pay = useMutation({
    mutationFn: () => api.post<{ order: Order }>(`/v1/shop/sandbox/${encodeURIComponent(code)}/pay`).then((r) => r.order),
    onSuccess: (o) => {
      onDone(o)
      toast('ok', `Thanh toán thành công, đã cộng ${fmtXu(o.xu)} vào ví`)
    },
    onError: (e) => setErr(errMsg(e)),
  })
  const cancel = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>(`/v1/shop/orders/${encodeURIComponent(code)}/cancel`),
    onSuccess: () => {
      order.refetch()
      qc.invalidateQueries({ queryKey: ['wallet'] })
      toast('info', 'Đã huỷ đơn nạp')
    },
    onError: (e) => setErr(errMsg(e)),
  })

  const o = order.data
  const st = o ? ORDER_STATUS[o.status] : null
  const busy = pay.isPending || cancel.isPending

  return (
    <>
      <PageBanner title="Thanh Toán" sub="Hoàn tất thanh toán để nhận Xu vào ví tài khoản" />
      <div className="mx-auto max-w-3xl px-4 py-10">
        {order.isLoading ? (
          <Spinner label="Đang tải đơn nạp…" />
        ) : order.isError || !o ? (
          <div className="space-y-4">
            <Alert>{errMsg(order.error) || 'Không tìm thấy đơn nạp'}</Alert>
            <Link to="/nap-the" className="btn-ghost">
              ← Quay lại Nạp thẻ
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            <section className="frame p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="title-gold text-2xl">Đơn nạp</h2>
                {st && <span className={clsx('badge', st.cls)}>{st.label}</span>}
              </div>
              <dl className="mt-4">
                <Row k="Mã đơn" v={<span className="font-mono">{o.code}</span>} />
                <Row k="Mệnh giá" v={fmtVnd(o.amount_vnd)} strong />
                <Row k="Xu nhận được" v={fmtXu(o.xu)} strong />
                <Row k="Tạo lúc" v={fmtDateTime(o.created_at)} />
                {o.paid_at && <Row k="Thanh toán lúc" v={fmtDateTime(o.paid_at)} />}
                {o.note && <Row k="Ghi chú" v={o.note} />}
              </dl>
            </section>

            {err && <Alert>{err}</Alert>}

            {o.status === 'paid' && (
              <section className="parchment p-6 text-center sm:p-8">
                <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-700" aria-hidden />
                <h3 className="mt-3 font-serif text-2xl font-bold text-parch-900">Nạp thành công!</h3>
                <p className="mt-2 text-parch-800">
                  Đã cộng <b>{fmtXu(o.xu)}</b> vào ví. Số dư hiện tại: <b className="tabular">{wallet.data ? fmtXu(wallet.data.xu) : '…'}</b>
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <Link to="/nap-the#doi-xu" className="btn-seal">
                    <ArrowRightLeft className="h-4 w-4" aria-hidden /> Đổi Xu sang Nguyên bảo
                  </Link>
                  <Link to="/nap-the" className="btn-ghost">
                    Nạp thêm
                  </Link>
                </div>
              </section>
            )}

            {(o.status === 'cancelled' || o.status === 'failed') && (
              <section className="frame p-6 text-center">
                <XCircle className="mx-auto h-12 w-12 text-seal-400" aria-hidden />
                <p className="mt-3 text-parch-100">{o.status === 'cancelled' ? 'Đơn nạp này đã bị huỷ.' : 'Thanh toán không thành công.'}</p>
                <Link to="/nap-the" className="btn-gold mt-5">
                  Tạo đơn mới
                </Link>
              </section>
            )}

            {o.status === 'pending' &&
              (cfg.data?.sandbox ? (
                <section className="relative overflow-hidden rounded-sm border-2 border-dashed border-amber-500/80 bg-amber-950/30 p-5 sm:p-6">
                  <div className="flex items-start gap-3">
                    <FlaskConical className="mt-0.5 h-6 w-6 shrink-0 text-amber-400" aria-hidden />
                    <div>
                      <h3 className="font-bold uppercase tracking-wide text-amber-300">Cổng thanh toán giả lập (chỉ dùng thử nghiệm)</h3>
                      <p className="mt-1 text-sm text-amber-100/80">
                        Đây không phải cổng thanh toán thật và không trừ tiền. Bấm “Xác nhận thanh toán” để mô phỏng giao dịch thành công cho đơn{' '}
                        <span className="font-mono">{o.code}</span>.
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 flex flex-wrap justify-end gap-3">
                    <button className="btn-ghost" onClick={() => cancel.mutate()} disabled={busy}>
                      {cancel.isPending && <Spinner />} Huỷ đơn
                    </button>
                    <button className="btn-gold" onClick={() => pay.mutate()} disabled={busy}>
                      {pay.isPending ? <Spinner className="text-ink-950" /> : <CheckCircle2 className="h-4 w-4" aria-hidden />} Xác nhận thanh toán
                    </button>
                  </div>
                </section>
              ) : (
                <section className="frame p-6 text-center">
                  <Hourglass className="mx-auto h-10 w-10 animate-pulse text-gold-400" aria-hidden />
                  <p className="mt-3 font-serif text-lg text-gold-200">Đang chờ cổng thanh toán</p>
                  <p className="mt-1 text-sm text-parch-200/70">Trang sẽ tự cập nhật khi thanh toán hoàn tất.</p>
                  <button className="btn-ghost mt-5" onClick={() => cancel.mutate()} disabled={busy}>
                    {cancel.isPending && <Spinner />} Huỷ đơn
                  </button>
                </section>
              ))}
          </div>
        )}
      </div>
    </>
  )
}
