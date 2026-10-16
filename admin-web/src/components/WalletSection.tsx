import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Coins, ShieldCheck } from 'lucide-react'
import { api, type Wallet } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtDateTime, fmtNum, fmtVnd, LEDGER_KIND } from '../lib/format'
import { Badge, Button, Card, Dialog, Empty, ErrorBox, Field, Loading, ReasonField, useToast } from './ui'

// Ví Xu của 1 tài khoản: số dư, sổ cái, quà chờ vào nhân vật + cộng / trừ Xu tay (gm+).
export default function WalletSection({ accountId }: { accountId: number }) {
  const { can } = useAuth()
  const [adjust, setAdjust] = useState(false)
  const q = useQuery({ queryKey: ['wallet', String(accountId)], queryFn: () => api.get<Wallet>(`/accounts/${accountId}/wallet`) })

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-3">
      <Card
        title="Ví Xu"
        className="h-fit"
        action={can('shop.write') && q.data && (
          <Button size="sm" icon={<Coins className="h-3.5 w-3.5" />} onClick={() => setAdjust(true)}>Cộng / trừ Xu</Button>
        )}
      >
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : (
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted">Số dư</dt>
              <dd className="mt-0.5 text-2xl font-semibold tracking-tight tabular text-gold">{fmtNum(q.data!.xu)} Xu</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Tổng đã nạp</dt>
              <dd className="mt-0.5 font-medium tabular">{fmtVnd(q.data!.total_topup_vnd)}</dd>
            </div>
          </dl>
        )}
      </Card>

      <div className="space-y-6 lg:col-span-2">
        <Card title="Lịch sử ví" bodyClass="">
          {q.data && (
            <Table
              empty="Chưa có biến động"
              head={['Thời gian', 'Biến động', 'Số dư sau', 'Loại', 'Ghi chú']}
              rows={q.data.ledger.map((l) => [
                <span className="tabular text-muted">{fmtDateTime(l.created_at)}</span>,
                <span className={clsx('font-medium tabular', l.delta >= 0 ? 'text-ok' : 'text-danger')}>
                  {l.delta >= 0 ? '+' : '−'}{fmtNum(Math.abs(l.delta))}
                </span>,
                <span className="tabular">{fmtNum(l.balance_after)}</span>,
                <Badge tone={l.kind === 'topup' ? 'gold' : l.kind === 'admin' ? 'info' : 'neutral'}>{LEDGER_KIND[l.kind] ?? l.kind}</Badge>,
                <span className="text-muted" title={l.ref || undefined}>{l.note || l.ref || '—'}</span>,
              ])}
            />
          )}
          {q.isLoading && <Loading />}
        </Card>

        <Card title="Quà chờ vào nhân vật" bodyClass="">
          {q.data && (
            <Table
              empty="Không có quà nào"
              head={['Nhân vật', 'Nguyên bảo', 'Xu', 'Trạng thái', 'Tạo lúc', 'Nhận lúc']}
              rows={q.data.grants.map((g) => [
                <span className="font-medium">{g.character || `#${g.character_id}`}</span>,
                <span className="tabular">{fmtNum(g.jade)}</span>,
                <span className="tabular">{fmtNum(g.xu)}</span>,
                g.status === 'applied' ? <Badge tone="ok" dot>Đã nhận</Badge> : <Badge tone="warn" dot>Đang chờ</Badge>,
                <span className="tabular text-muted">{fmtDateTime(g.created_at)}</span>,
                <span className="tabular text-muted">{fmtDateTime(g.applied_at)}</span>,
              ])}
            />
          )}
          {q.isLoading && <Loading />}
        </Card>
      </div>

      {adjust && q.data && <AdjustDialog accountId={accountId} balance={q.data.xu} onClose={() => setAdjust(false)} />}
    </div>
  )
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
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

function AdjustDialog({ accountId, balance, onClose }: { accountId: number; balance: number; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [text, setText] = useState('')
  const [reason, setReason] = useState('')
  const delta = Number(text)
  const valid = text.trim() !== '' && Number.isInteger(delta) && delta !== 0 && balance + delta >= 0
  const m = useMutation({
    mutationFn: () => api.post<{ xu: number }>(`/accounts/${accountId}/wallet`, { delta, reason }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['wallet', String(accountId)] })
      qc.invalidateQueries({ queryKey: ['account', String(accountId)] })
      toast(`Đã cập nhật ví: còn ${fmtNum(r.xu)} Xu`)
      onClose()
    },
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title="Cộng / trừ Xu"
      desc="Dùng để đền bù hoặc sửa sai. Số dương là cộng, số âm là trừ."
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button
            variant={delta < 0 ? 'danger' : 'primary'}
            loading={m.isPending}
            disabled={!valid || reason.trim().length < 5}
            icon={<ShieldCheck className="h-4 w-4" />}
            onClick={() => m.mutate()}
          >
            {delta < 0 ? 'Trừ Xu' : 'Cộng Xu'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Số Xu"
          hint={
            text.trim() !== '' && Number.isInteger(delta) && delta !== 0
              ? balance + delta < 0
                ? `Không đủ Xu: hiện có ${fmtNum(balance)} Xu.`
                : `Số dư sau: ${fmtNum(balance + delta)} Xu (hiện ${fmtNum(balance)}).`
              : `Hiện có ${fmtNum(balance)} Xu. Ví dụ: 500 hoặc -200.`
          }
        >
          <input className="input tabular" type="number" step={1} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <ReasonField value={reason} onChange={setReason} />
        {m.error && <ErrorBox error={m.error} />}
      </div>
    </Dialog>
  )
}
