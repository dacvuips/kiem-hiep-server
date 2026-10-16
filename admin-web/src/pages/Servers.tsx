import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Server } from 'lucide-react'
import { api, type ServerStat } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtDateTime, fmtNum, REGION_LABEL, SERVER_STATUS } from '../lib/format'
import { Badge, Button, Dialog, Empty, ErrorBox, Field, Loading, PageHeader, useToast } from '../components/ui'
import { GameSettingsPanel, ProcessPanel } from '../components/ProcessPanel'

type Form = Omit<ServerStat, 'opened_at' | 'characters'> & { reason: string }

const blank: Form = { id: 0, name: '', region: 'north', status: 'normal', is_new: true, host: '', port: 7777, ws_url: '', sort_order: 0, reason: '' }

export default function ServersPage() {
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['servers'], queryFn: () => api.get<{ items: ServerStat[] }>('/servers') })
  const [edit, setEdit] = useState<{ form: Form; isNew: boolean } | null>(null)
  const canEdit = can('servers.write')

  return (
    <>
      <PageHeader
        title="Máy chủ"
        desc="Danh sách máy chủ người chơi thấy ở màn Chọn máy chủ. Đặt Bảo trì để chặn vào game."
        actions={
          canEdit && (
            <Button
              variant="primary"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setEdit({ form: { ...blank, id: Math.max(0, ...(q.data?.items.map((s) => s.id) ?? [0])) + 1 }, isNew: true })}
            >
              Thêm máy chủ
            </Button>
          )
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <div className="card overflow-hidden">
          {q.data!.items.length === 0 ? (
            <Empty icon={<Server className="h-8 w-8" />} title="Chưa có máy chủ" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-line bg-subtle/50">
                  <tr>
                    <th className="th">Máy chủ</th>
                    <th className="th">Trạng thái</th>
                    <th className="th hidden sm:table-cell">Khu vực</th>
                    <th className="th hidden md:table-cell">Địa chỉ</th>
                    <th className="th">Nhân vật</th>
                    <th className="th hidden lg:table-cell">Mở ngày</th>
                    {canEdit && <th className="th w-10" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {q.data!.items.map((s) => {
                    const st = SERVER_STATUS[s.status] ?? SERVER_STATUS.normal
                    return (
                      <tr key={s.id} className="hover:bg-subtle/60">
                        <td className="td">
                          <div className="flex items-center gap-2 font-medium">
                            {s.name}
                            {s.is_new && <Badge tone="gold">Mới</Badge>}
                          </div>
                          <div className="text-xs text-muted">Mã {s.id}</div>
                        </td>
                        <td className="td"><Badge tone={st.tone} dot>{st.label}</Badge></td>
                        <td className="td hidden sm:table-cell">{REGION_LABEL[s.region]}</td>
                        <td className="td hidden font-mono text-xs md:table-cell">
                          <div>{s.host}:{s.port}</div>
                          <div className="text-muted">{s.ws_url}</div>
                        </td>
                        <td className="td tabular">{fmtNum(s.characters)}</td>
                        <td className="td hidden text-muted lg:table-cell">{fmtDateTime(s.opened_at)}</td>
                        {canEdit && (
                          <td className="td">
                            <Button size="sm" variant="ghost" aria-label="Sửa" onClick={() => setEdit({ form: { ...s, reason: '' }, isNew: false })}>
                              <Pencil className="h-4 w-4" />
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
        </div>
      )}
      <ProcessPanel />
      <GameSettingsPanel />
      {edit && <ServerDialog init={edit.form} isNew={edit.isNew} onClose={() => setEdit(null)} />}
    </>
  )
}

function ServerDialog({ init, isNew, onClose }: { init: Form; isNew: boolean; onClose: () => void }) {
  const [f, setF] = useState(init)
  const qc = useQueryClient()
  const toast = useToast()
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))
  const m = useMutation({
    mutationFn: () => (isNew ? api.post('/servers', f) : api.put(`/servers/${f.id}`, f)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      toast(isNew ? 'Đã thêm máy chủ' : 'Đã lưu máy chủ')
      onClose()
    },
  })
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={isNew ? 'Thêm máy chủ' : `Sửa ${init.name}`}
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button variant="primary" loading={m.isPending} disabled={!f.name.trim() || f.reason.trim().length < 5} onClick={() => m.mutate()}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mã máy chủ">
          <input className="input tabular" type="number" min={1} disabled={!isNew} value={f.id} onChange={(e) => set('id', Number(e.target.value))} />
        </Field>
        <Field label="Tên hiển thị">
          <input className="input" maxLength={40} value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Trạng thái">
          <select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>
            {Object.entries(SERVER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        <Field label="Khu vực">
          <select className="input" value={f.region} onChange={(e) => set('region', e.target.value)}>
            {Object.entries(REGION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Host (PC / mobile)">
          <input className="input font-mono" value={f.host} onChange={(e) => set('host', e.target.value)} placeholder="game1.kiemhiep.vn" />
        </Field>
        <Field label="Cổng">
          <input className="input tabular" type="number" min={0} max={65535} value={f.port} onChange={(e) => set('port', Number(e.target.value))} />
        </Field>
        <Field label="WebSocket (bản web)">
          <input className="input font-mono" value={f.ws_url} onChange={(e) => set('ws_url', e.target.value)} placeholder="wss://game1.kiemhiep.vn/ws" />
        </Field>
        <Field label="Thứ tự hiển thị">
          <input className="input tabular" type="number" value={f.sort_order} onChange={(e) => set('sort_order', Number(e.target.value))} />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={f.is_new} onChange={(e) => set('is_new', e.target.checked)} />
          Gắn nhãn “Mới”
        </label>
        <div className="sm:col-span-2">
          <Field label="Lý do thay đổi" hint="Bắt buộc, ghi vào nhật ký.">
            <input className="input" value={f.reason} onChange={(e) => set('reason', e.target.value)} />
          </Field>
        </div>
      </div>
      {m.error && <div className="mt-4"><ErrorBox error={m.error} /></div>}
    </Dialog>
  )
}
