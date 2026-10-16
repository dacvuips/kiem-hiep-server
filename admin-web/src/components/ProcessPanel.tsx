import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { api, type GameSettings, type ProcessInfo } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtNum } from '../lib/format'
import { Badge, Button, Card, Dialog, Empty, ErrorBox, Field, Loading, ReasonField, useToast } from './ui'

// Vận hành game server (trang Máy chủ): tiến trình đang chạy (nhịp tim mỗi 5 giây) + khởi động lại êm + thông số game.
// Mọi thao tác ghi đều cần quyền (vai trò super + 2FA) và lý do — server tài khoản kiểm lại, ghi nhật ký.

const KIND_LABEL: Record<string, string> = { world: 'Thế giới', battle: 'Tống Kim', arena: 'Đấu trường', field: 'Train chung' }

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d > 0 ? `${d}n ${h}g` : h > 0 ? `${h}g ${m}p` : `${m}p`
}

function buildLabel(b: ProcessInfo['build']): string {
  if (!b || !b.commit) return 'mã nguồn'
  return `${b.commit}${b.dirty ? '*' : ''}`
}

export function ProcessPanel() {
  const { can } = useAuth()
  const q = useQuery({
    queryKey: ['processes'],
    queryFn: () => api.get<{ items: ProcessInfo[] }>('/processes'),
    refetchInterval: 5000,
  })
  const [restart, setRestart] = useState<ProcessInfo | null>(null)
  const canControl = can('servers.control')

  return (
    <Card
      className="mt-6"
      title={<span className="flex items-center gap-2"><Activity className="h-4 w-4" /> Tiến trình game server</span>}
      action={<span className="text-xs text-muted">tự làm mới mỗi 5 giây</span>}
      bodyClass="p-0"
    >
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <div className="p-5"><ErrorBox error={q.error} /></div>
      ) : q.data!.items.length === 0 ? (
        <Empty icon={<Activity className="h-8 w-8" />} title="Chưa có tiến trình nào báo về" desc="Bật game server: bash server/dev.sh up" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line bg-subtle/50">
              <tr>
                <th className="th">Tiến trình</th>
                <th className="th">Trạng thái</th>
                <th className="th">Người</th>
                <th className="th hidden sm:table-cell">Phòng</th>
                <th className="th hidden md:table-cell">Tick (tb / max)</th>
                <th className="th hidden lg:table-cell">Gửi đi</th>
                <th className="th hidden lg:table-cell">Bản code</th>
                <th className="th hidden md:table-cell">Chạy được</th>
                {canControl && <th className="th w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data!.items.map((p) => {
                const slow = p.tick_avg_ms > 25
                return (
                  <tr key={p.key} className="hover:bg-subtle/60">
                    <td className="td">
                      <div className="font-medium">{KIND_LABEL[p.kind] ?? p.kind}{p.kind === 'field' ? ` #${p.index}` : ''}</div>
                      <div className="font-mono text-xs text-muted">{p.host}:{p.port} · máy chủ {p.server_id}</div>
                    </td>
                    <td className="td">
                      {!p.alive ? (
                        <Badge tone="danger" dot>Mất tín hiệu {p.age_sec}s</Badge>
                      ) : p.draining ? (
                        <Badge tone="warn" dot>Khởi động lại sau {p.drain_left}s</Badge>
                      ) : p.pending ? (
                        <Badge tone="warn" dot>Chờ nhận lệnh</Badge>
                      ) : (
                        <Badge tone="ok" dot>Đang chạy</Badge>
                      )}
                    </td>
                    <td className="td tabular">{fmtNum(p.online)}</td>
                    <td className="td hidden tabular sm:table-cell">{p.kind === 'field' || p.kind === 'arena' ? fmtNum(p.rooms) : '—'}</td>
                    <td className="td hidden tabular md:table-cell">
                      <span className={slow ? 'text-warn' : ''}>{p.tick_avg_ms.toFixed(1)}</span>
                      <span className="text-muted"> / {p.tick_max_ms.toFixed(0)} ms</span>
                    </td>
                    <td className="td hidden tabular lg:table-cell">{p.send_kbs.toFixed(0)} KB/s</td>
                    <td className="td hidden font-mono text-xs lg:table-cell" title={p.build?.built_at ?? ''}>{buildLabel(p.build)}</td>
                    <td className="td hidden text-muted md:table-cell">{fmtUptime(p.uptime_sec)}</td>
                    {canControl && (
                      <td className="td">
                        <Button size="sm" variant="ghost" aria-label="Khởi động lại êm" disabled={!p.alive || p.draining || !!p.pending}
                          onClick={() => setRestart(p)}>
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {restart && <RestartDialog proc={restart} onClose={() => setRestart(null)} />}
    </Card>
  )
}

function RestartDialog({ proc, onClose }: { proc: ProcessInfo; onClose: () => void }) {
  const [seconds, setSeconds] = useState(120)
  const [message, setMessage] = useState('')
  const [reason, setReason] = useState('')
  const qc = useQueryClient()
  const toast = useToast()
  const m = useMutation({
    mutationFn: () => api.post(`/processes/${encodeURIComponent(proc.key)}/restart`, { seconds, message, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['processes'] })
      toast('Đã gửi lệnh khởi động lại')
      onClose()
    },
  })
  const name = `${KIND_LABEL[proc.kind] ?? proc.kind}${proc.kind === 'field' ? ` #${proc.index}` : ''}`
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Khởi động lại êm: ${name}`}
      desc={`${fmtNum(proc.online)} người đang chơi sẽ được báo đếm ngược, dữ liệu được lưu trước khi tiến trình khởi động lại.`}
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button variant="danger" loading={m.isPending} disabled={reason.trim().length < 5 || seconds < 10 || seconds > 1800} onClick={() => m.mutate()}>
            Khởi động lại
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Đếm ngược (giây)" hint="10 – 1800 giây. Người mới không vào được trong lúc đếm ngược.">
          <input className="input tabular" type="number" min={10} max={1800} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} />
        </Field>
        <Field label="Lời nhắn cho người chơi (không bắt buộc)">
          <input className="input" maxLength={200} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="VD: cập nhật bản vá" />
        </Field>
        <ReasonField value={reason} onChange={setReason} />
      </div>
      {m.error && <div className="mt-4"><ErrorBox error={m.error} /></div>}
    </Dialog>
  )
}

export function GameSettingsPanel() {
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['game-settings'], queryFn: () => api.get<GameSettings>('/game-settings') })
  const canEdit = can('game.settings')
  const [values, setValues] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState(false)
  const qc = useQueryClient()
  const toast = useToast()
  useEffect(() => {
    if (q.data) setValues(q.data.values)
  }, [q.data])
  const m = useMutation({
    mutationFn: () => api.put('/game-settings', { values, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['game-settings'] })
      toast('Đã lưu thông số — game server áp dụng trong vài giây')
      setConfirm(false)
      setReason('')
    },
  })
  const keys = q.data ? Object.keys(q.data.defs).sort() : []
  const changed = q.data ? keys.some((k) => values[k] !== q.data!.values[k]) : false
  const invalid = q.data ? keys.some((k) => !(values[k] >= q.data!.defs[k].min && values[k] <= q.data!.defs[k].max)) : true
  return (
    <Card className="mt-6" title={<span className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" /> Thông số game (online)</span>}>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {keys.map((k) => {
              const d = q.data!.defs[k]
              return (
                <Field key={k} label={d.label} hint={`${d.min} – ${d.max} (gốc ${d.default})`}>
                  <input className="input tabular" type="number" step={0.1} min={d.min} max={d.max} disabled={!canEdit}
                    value={values[k] ?? d.default} onChange={(e) => setValues((v) => ({ ...v, [k]: Number(e.target.value) }))} />
                </Field>
              )
            })}
          </div>
          {canEdit && (
            <div className="mt-4 flex justify-end">
              <Button variant="primary" disabled={!changed || invalid} onClick={() => setConfirm(true)}>Lưu thông số</Button>
            </div>
          )}
        </>
      )}
      {confirm && (
        <Dialog
          open
          onClose={() => setConfirm(false)}
          title="Đổi thông số game"
          desc="Áp dụng ngay cho mọi game server online (kinh nghiệm, rơi đồ của quái)."
          footer={
            <>
              <Button onClick={() => setConfirm(false)}>Hủy</Button>
              <Button variant="primary" loading={m.isPending} disabled={reason.trim().length < 5} onClick={() => m.mutate()}>Lưu</Button>
            </>
          }
        >
          <ReasonField value={reason} onChange={setReason} />
          {m.error && <div className="mt-4"><ErrorBox error={m.error} /></div>}
        </Dialog>
      )}
    </Card>
  )
}
