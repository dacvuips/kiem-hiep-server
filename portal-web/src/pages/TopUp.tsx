import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowRightLeft, CheckCircle2, Coins, CreditCard, Gem, Wallet as WalletIcon } from 'lucide-react'
import { api, type Character, type GameServer, type Order, type ShopConfig, type TransferResult } from '../lib/api'
import { useWallet } from '../lib/auth'
import { fmtDateTime, fmtJade, fmtNum, fmtVnd, fmtXu, REGION_LABEL } from '../lib/format'
import { sectName } from '../lib/sects'
import { Alert, Field, Modal, PageBanner, Spinner, errMsg, useToast } from '../components/ui'

export function useShopConfig() {
  return useQuery({ queryKey: ['shop-config'], queryFn: () => api.pub.get<ShopConfig>('/v1/shop/config'), staleTime: 60_000 })
}

/** Chuyển tới trang thanh toán: đường dẫn nội bộ thì dùng router, cổng ngoài thì chuyển hẳn trang. */
export function goPay(nav: ReturnType<typeof useNavigate>, url: string) {
  if (url.startsWith('/') && !url.startsWith('//')) nav(url)
  else window.location.href = url
}

function WalletCard() {
  const wallet = useWallet()
  return (
    <div className="frame flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-full border border-gold-400/70 bg-gradient-to-b from-gold-500/30 to-ink-900 text-gold-200 shadow-glow">
          <WalletIcon className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <p className="text-xs uppercase tracking-wider text-parch-300/60">Số dư ví Xu</p>
          <p className="title-gold tabular text-3xl">{wallet.data ? fmtXu(wallet.data.xu) : wallet.isError ? '—' : '…'}</p>
        </div>
      </div>
      <div className="text-sm text-parch-200/70 sm:text-right">
        <p>
          Tổng đã nạp: <b className="tabular text-gold-200">{wallet.data ? fmtVnd(wallet.data.total_topup_vnd) : '…'}</b>
        </p>
        <Link to="/tai-khoan?tab=lich-su-nap" className="text-gold-400 hover:text-gold-200">
          Xem lịch sử nạp →
        </Link>
      </div>
    </div>
  )
}

function PackPicker({ cfg }: { cfg: ShopConfig }) {
  const nav = useNavigate()
  const [amount, setAmount] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const create = useMutation({
    mutationFn: (amount_vnd: number) => api.post<{ order: Order; pay_url: string }>('/v1/shop/orders', { amount_vnd }),
    onSuccess: (r) => goPay(nav, r.pay_url || `/nap-the/thanh-toan/${r.order.code}`),
    onError: (e) => setErr(errMsg(e)),
  })
  const wallet = useWallet()
  const pending = wallet.data?.orders.filter((o) => o.status === 'pending') ?? []

  return (
    <section className="frame p-5 sm:p-6">
      <h2 className="title-gold flex items-center gap-2 text-2xl">
        <CreditCard className="h-6 w-6 text-gold-400" aria-hidden /> Chọn mệnh giá
      </h2>
      <p className="mt-1 text-sm text-parch-200/70">
        Tỉ lệ: <b className="text-gold-200">10.000đ = {fmtXu(cfg.xu_per_10k)}</b>. Xu được cộng vào ví tài khoản ngay khi thanh toán thành công.
      </p>
      {cfg.sandbox && (
        <Alert tone="info" className="mt-4">
          Máy chủ đang dùng <b>cổng thanh toán giả lập</b> để thử nghiệm — không phát sinh giao dịch thật.
        </Alert>
      )}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cfg.packs.map((p) => {
          const sel = amount === p.amount_vnd
          return (
            <button
              key={p.amount_vnd}
              type="button"
              onClick={() => {
                setAmount(p.amount_vnd)
                setErr('')
              }}
              aria-pressed={sel}
              className={clsx(
                'group relative flex flex-col items-center rounded-sm border px-3 py-4 text-center transition',
                sel ? 'border-gold-300 bg-gold-500/15 shadow-glow' : 'border-gold-700/60 bg-ink-950/60 hover:border-gold-500 hover:bg-gold-500/5',
              )}
            >
              {sel && <CheckCircle2 className="absolute right-1.5 top-1.5 h-4 w-4 text-gold-300" aria-hidden />}
              <span className="tabular font-serif text-xl font-bold text-parch-50">{fmtVnd(p.amount_vnd)}</span>
              <span className="my-1.5 h-px w-10 bg-gold-600/60" />
              <span className="tabular flex items-center gap-1 text-sm font-semibold text-gold-300">
                <Coins className="h-4 w-4" aria-hidden /> {fmtXu(p.xu)}
              </span>
            </button>
          )
        })}
      </div>
      {err && <Alert className="mt-4">{err}</Alert>}
      <div className="mt-5 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-parch-200/70">
          {amount ? (
            <>
              Bạn chọn <b className="text-parch-50">{fmtVnd(amount)}</b> → nhận <b className="text-gold-200">{fmtXu(cfg.packs.find((p) => p.amount_vnd === amount)?.xu ?? 0)}</b>
            </>
          ) : (
            'Hãy chọn một mệnh giá ở trên.'
          )}
        </p>
        <button className="btn-seal btn-lg" disabled={!amount || create.isPending} onClick={() => amount && create.mutate(amount)}>
          {create.isPending ? <Spinner className="text-parch-50" /> : <CreditCard className="h-5 w-5" aria-hidden />}
          Tạo đơn nạp
        </button>
      </div>
      {pending.length > 0 && (
        <div className="mt-6 border-t border-gold-700/30 pt-4">
          <h3 className="text-sm font-semibold text-gold-200">Đơn đang chờ thanh toán</h3>
          <ul className="mt-2 divide-y divide-gold-700/20 text-sm">
            {pending.map((o) => (
              <li key={o.code} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-parch-200/80">
                  <span className="font-mono text-parch-50">{o.code}</span> · {fmtVnd(o.amount_vnd)} · {fmtDateTime(o.created_at)}
                </span>
                <Link to={`/nap-the/thanh-toan/${o.code}`} className="btn-ghost btn-sm">
                  Tiếp tục thanh toán
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export function TransferPanel({ cfg }: { cfg: ShopConfig }) {
  const qc = useQueryClient()
  const toast = useToast()
  const wallet = useWallet()
  const balance = wallet.data?.xu ?? 0
  const [serverId, setServerId] = useState<number | null>(null)
  const [charId, setCharId] = useState<number | null>(null)
  const [xuText, setXuText] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<TransferResult | null>(null)

  const servers = useQuery({ queryKey: ['servers'], queryFn: () => api.get<{ servers: GameServer[] }>('/v1/servers') })
  const chars = useQuery({
    queryKey: ['characters', serverId],
    queryFn: () => api.get<{ characters: Character[] }>(`/v1/characters?server_id=${serverId}`),
    enabled: serverId !== null,
  })

  // Tự chọn máy chủ đầu tiên có nhân vật.
  useEffect(() => {
    if (serverId === null && servers.data?.servers.length) {
      const s = servers.data.servers.find((g) => g.characters > 0) ?? servers.data.servers[0]
      setServerId(s.id)
    }
  }, [servers.data, serverId])
  useEffect(() => setCharId(null), [serverId])

  const xu = Math.floor(Number(xuText.replace(/\D/g, '')) || 0)
  const jade = xu * cfg.jade_per_xu
  const character = chars.data?.characters.find((c) => c.id === charId)

  const transfer = useMutation({
    mutationFn: () => api.post<TransferResult>('/v1/shop/transfer', { character_id: charId, xu }),
    onSuccess: (r) => {
      setConfirm(false)
      setDone(r)
      setXuText('')
      toast('ok', `Đã đổi ${fmtXu(xu)} → ${fmtJade(r.jade)} cho ${r.character}`)
      qc.invalidateQueries({ queryKey: ['wallet'] })
    },
    onError: (e) => {
      setConfirm(false)
      setErr(errMsg(e))
    },
  })

  const validate = () => {
    setErr('')
    setDone(null)
    if (!charId) return setErr('Hãy chọn nhân vật nhận Nguyên bảo')
    if (xu <= 0) return setErr('Hãy nhập số Xu muốn đổi')
    if (xu > balance) return setErr('Số Xu trong ví không đủ')
    setConfirm(true)
  }

  return (
    <section id="doi-xu" className="frame scroll-mt-24 p-5 sm:p-6">
      <h2 className="title-gold flex items-center gap-2 text-2xl">
        <ArrowRightLeft className="h-6 w-6 text-gold-400" aria-hidden /> Đổi Xu sang Nguyên bảo
      </h2>
      <p className="mt-1 text-sm text-parch-200/70">
        Tỉ lệ: <b className="text-gold-200">1 Xu = {fmtNum(cfg.jade_per_xu)} Nguyên bảo</b>. Chọn máy chủ và nhân vật nhận.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Máy chủ" htmlFor="t-server">
          <select id="t-server" className="input" value={serverId ?? ''} onChange={(e) => setServerId(Number(e.target.value))} disabled={!servers.data}>
            {!servers.data && <option value="">{servers.isError ? 'Không tải được máy chủ' : 'Đang tải…'}</option>}
            {servers.data?.servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {REGION_LABEL[s.region] ? ` (${REGION_LABEL[s.region]})` : ''} — {s.characters} nhân vật
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nhân vật" htmlFor="t-char">
          <select id="t-char" className="input" value={charId ?? ''} onChange={(e) => setCharId(Number(e.target.value) || null)} disabled={!chars.data?.characters.length}>
            <option value="">
              {chars.isLoading ? 'Đang tải…' : chars.data && chars.data.characters.length === 0 ? 'Chưa có nhân vật trên máy chủ này' : '— Chọn nhân vật —'}
            </option>
            {chars.data?.characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · Cấp {c.level} · {sectName(c.sect_id)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Số Xu muốn đổi" htmlFor="t-xu" hint={`Số dư hiện có: ${fmtXu(balance)}`}>
          <div className="flex gap-2">
            <input id="t-xu" className="input tabular" inputMode="numeric" placeholder="Ví dụ: 100" value={xuText} onChange={(e) => setXuText(e.target.value.replace(/\D/g, '').slice(0, 9))} />
            <button type="button" className="btn-ghost shrink-0" onClick={() => setXuText(String(balance))} disabled={balance <= 0}>
              Tất cả
            </button>
          </div>
        </Field>
        <div className="mt-2 flex flex-wrap gap-2">
          {[50, 100, 200, 500, 1000].map((v) => (
            <button key={v} type="button" className="btn-ghost btn-sm" onClick={() => setXuText(String(v))} disabled={v > balance}>
              {fmtXu(v)}
            </button>
          ))}
        </div>
      </div>

      <div className="parchment mt-5 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-3 text-parch-900">
          <Gem className="h-6 w-6 text-seal-600" aria-hidden />
          <div>
            <p className="text-xs uppercase tracking-wider text-parch-700">Nhân vật sẽ nhận</p>
            <p className="tabular font-serif text-2xl font-bold">{fmtJade(jade)}</p>
          </div>
        </div>
        <button className="btn-seal" onClick={validate} disabled={transfer.isPending || xu <= 0 || !charId}>
          <ArrowRightLeft className="h-4 w-4" aria-hidden /> Đổi ngay
        </button>
      </div>

      {err && <Alert className="mt-4">{err}</Alert>}
      {done && (
        <Alert tone="ok" className="mt-4">
          Đã chuyển <b>{fmtJade(done.jade)}</b> cho nhân vật <b>{done.character}</b>. Số dư ví còn <b>{fmtXu(done.xu)}</b>. Nguyên bảo sẽ vào nhân vật ở lần vào bản đồ tiếp theo, hoặc trong khoảng 30 giây nếu
          nhân vật đang trực tuyến.
        </Alert>
      )}
      <p className="mt-4 text-xs text-parch-300/60">
        Lưu ý: Nguyên bảo được giao vào nhân vật ở lần vào bản đồ tiếp theo, hoặc trong khoảng 30 giây nếu nhân vật đang trực tuyến. Giao dịch đổi Xu không thể hoàn tác.
      </p>

      <Modal open={confirm} onClose={() => !transfer.isPending && setConfirm(false)} title="Xác nhận đổi Xu">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-parch-300/70">Nhân vật</dt>
            <dd className="text-right font-semibold text-parch-50">
              {character?.name} <span className="font-normal text-parch-300/70">(Cấp {character?.level})</span>
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-parch-300/70">Máy chủ</dt>
            <dd className="text-right text-parch-50">{servers.data?.servers.find((s) => s.id === serverId)?.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-parch-300/70">Trừ ví</dt>
            <dd className="tabular font-semibold text-seal-400">−{fmtXu(xu)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-parch-300/70">Nhận được</dt>
            <dd className="tabular font-semibold text-gold-200">+{fmtJade(jade)}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-parch-300/60">Sau khi xác nhận, giao dịch không thể hoàn tác.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirm(false)} disabled={transfer.isPending}>
            Huỷ
          </button>
          <button className="btn-gold" onClick={() => transfer.mutate()} disabled={transfer.isPending}>
            {transfer.isPending && <Spinner className="text-ink-950" />} Xác nhận
          </button>
        </div>
      </Modal>
    </section>
  )
}

export default function TopUp() {
  const cfg = useShopConfig()
  const body = useMemo(() => {
    if (cfg.isLoading) return <Spinner label="Đang tải cấu hình nạp thẻ…" />
    if (cfg.isError || !cfg.data) return <Alert>{errMsg(cfg.error) || 'Không tải được cấu hình nạp thẻ'}</Alert>
    return (
      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <PackPicker cfg={cfg.data} />
        <TransferPanel cfg={cfg.data} />
      </div>
    )
  }, [cfg.isLoading, cfg.isError, cfg.data, cfg.error])

  return (
    <>
      <PageBanner title="Nạp Thẻ" sub="Nạp tiền vào ví Xu của tài khoản, sau đó đổi Xu thành Nguyên bảo cho nhân vật bạn muốn." />
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-10">
        <WalletCard />
        {body}
        <HowItWorks />
      </div>
    </>
  )
}

function HowItWorks() {
  const steps = [
    { t: 'Chọn mệnh giá', d: 'Chọn gói nạp và tạo đơn.' },
    { t: 'Thanh toán', d: 'Hoàn tất thanh toán, Xu vào ví tài khoản.' },
    { t: 'Đổi Nguyên bảo', d: 'Chọn nhân vật và số Xu muốn đổi.' },
    { t: 'Nhận trong game', d: 'Nguyên bảo vào nhân vật khi vào bản đồ (hoặc ~30 giây nếu đang online).' },
  ]
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((s, i) => (
        <div key={s.t} className="flex gap-3 rounded-sm border border-gold-700/40 bg-ink-900/60 p-4">
          <span className="seal-stamp h-8 w-8 shrink-0 text-sm">{i + 1}</span>
          <div>
            <p className="font-serif font-semibold text-gold-200">{s.t}</p>
            <p className="mt-0.5 text-xs text-parch-200/70">{s.d}</p>
          </div>
        </div>
      ))}
    </section>
  )
}
