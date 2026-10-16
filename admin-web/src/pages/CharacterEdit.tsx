import { useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownToLine, ArrowLeft, ArrowRightLeft, Gift, LogOut, Pencil, Plus, RotateCcw, Save, Shirt, Trash2 } from 'lucide-react'
import { api, type CharacterFull } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtAgo, fmtNum } from '../lib/format'
import {
  DETAIL_TO_PARTS, LOCK_LABEL, SERIES, itemDetail, itemName, placeItem, useCatalog,
  type Catalog, type Item, type MagicLine,
} from '../lib/catalog'
import { Badge, Button, Card, Dialog, Empty, ErrorBox, Field, Loading, ReasonField, Tabs, useToast } from '../components/ui'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = Record<string, any>
type Update = (fn: (d: Data) => string | void) => void
type TabKey = 'overview' | 'points' | 'equipment' | 'inventory' | 'storage' | 'grants' | 'json'

const NO_SECT_NAME = 'Vô Môn Phái'
const NATIONS = ['Chưa chọn', 'Tống', 'Kim']

export default function CharacterEditPage() {
  const { cid } = useParams()
  const q = useQuery({ queryKey: ['character', cid], queryFn: () => api.get<CharacterFull>(`/characters/${cid}`) })
  const cat = useCatalog()
  if (q.isLoading || cat.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (cat.error) return <ErrorBox error={cat.error} />
  // key = version: lưu xong / tải lại thì dựng lại bản nháp từ dữ liệu mới.
  return <Editor key={`${q.data!.id}:${q.data!.version}`} ch={q.data!} cat={cat.data!} onReload={() => q.refetch()} />
}

function Editor({ ch, cat, onReload }: { ch: CharacterFull; cat: Catalog; onReload: () => void }) {
  const { can } = useAuth()
  const canEdit = can('characters.write')
  const [tab, setTab] = useState<TabKey>('overview')
  const [draft, setDraft] = useState<Data>(() => structuredClone(ch.data))
  const [name, setName] = useState(ch.name)
  const [saving, setSaving] = useState(false)
  const [kicking, setKicking] = useState(false)
  const dirty = name !== ch.name || JSON.stringify(draft) !== JSON.stringify(ch.data)
  const toast = useToast()
  // Sửa trên bản sao; hàm sửa trả về chuỗi = lỗi (hết chỗ...) -> bỏ thay đổi, báo lỗi.
  const update: Update = (fn) => {
    const n = structuredClone(draft)
    const err = fn(n)
    if (err) return toast(err, 'danger')
    setDraft(n)
  }

  const inventory: Item[] = draft.inventory ?? []
  const storage: Item[] = draft.storage ?? []
  const grants: Data[] = draft.admin_grants ?? []
  const equipCount = Object.keys(draft.equipment ?? {}).length

  return (
    <>
      <Link to={`/accounts/${ch.account_id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Tài khoản {ch.username}
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">{ch.name}</h1>
            {ch.online ? <Badge tone="ok" dot>Đang online</Badge> : <Badge>Offline</Badge>}
            {ch.deleted_at && <Badge tone="danger">Đã xóa</Badge>}
            {ch.reload_pending && <Badge tone="warn">Chờ đá khỏi game</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">
            #{ch.id} · {ch.server} · Ô {ch.slot + 1} · Cấp {ch.level} · lưu {fmtAgo(ch.updated_at)} (bản {ch.version})
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={onReload} disabled={saving}>
            {dirty ? 'Bỏ thay đổi & tải lại' : 'Tải lại'}
          </Button>
          {canEdit && ch.online && (
            <Button size="sm" icon={<LogOut className="h-3.5 w-3.5" />} onClick={() => setKicking(true)}>Đá khỏi game</Button>
          )}
          {canEdit && (
            <Button size="sm" variant="primary" icon={<Save className="h-3.5 w-3.5" />} disabled={!dirty} onClick={() => setSaving(true)}>
              Lưu thay đổi
            </Button>
          )}
        </div>
      </div>

      {!canEdit && (
        <div className="mb-4 rounded-xl border border-line bg-subtle px-4 py-3 text-sm text-muted">
          Chỉ xem — sửa nhân vật cần quyền Super Admin.
        </div>
      )}
      {canEdit && ch.online && (
        <div className="mb-4 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-sm">
          <span className="font-medium text-warn">Người chơi đang online.</span>{' '}
          <span className="text-muted">
            Lưu xong, người chơi bị đá khỏi game trong vòng ~30 giây (phần chơi chưa lưu bị mất) và vào lại sẽ thấy bản mới.
            Game tự lưu mỗi phút — nếu báo "vừa được game lưu", bấm Tải lại rồi sửa lại. Muốn chắc chắn: bấm "Đá khỏi game" trước khi sửa.
          </span>
        </div>
      )}
      {dirty && (
        <div className="mb-4 rounded-xl border border-accent/30 bg-accent/5 px-4 py-2.5 text-sm text-accent">
          Có thay đổi chưa lưu — bấm "Lưu thay đổi" để ghi vào nhân vật.
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-4 pt-1">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: 'overview', label: 'Tổng quan' },
              { value: 'points', label: 'Điểm & Kỹ năng' },
              { value: 'equipment', label: 'Trang bị', count: equipCount },
              { value: 'inventory', label: 'Hành trang', count: inventory.length },
              { value: 'storage', label: 'Rương', count: storage.length },
              { value: 'grants', label: 'Tặng đồ', count: grants.length },
              { value: 'json', label: 'JSON' },
            ]}
          />
        </div>
        <fieldset disabled={!canEdit} className="min-w-0">
          {tab === 'overview' && <Overview d={draft} update={update} name={name} setName={setName} cat={cat} />}
          {tab === 'points' && <Points d={draft} update={update} cat={cat} />}
          {tab === 'equipment' && <Equipment d={draft} update={update} cat={cat} />}
          {tab === 'inventory' && <Inventory d={draft} update={update} cat={cat} />}
          {tab === 'storage' && <Storage d={draft} update={update} cat={cat} />}
          {tab === 'grants' && <Grants d={draft} update={update} cat={cat} />}
          {tab === 'json' && <JsonTab d={draft} setDraft={setDraft} />}
        </fieldset>
      </div>

      {saving && <SaveDialog ch={ch} name={name} draft={draft} onClose={() => setSaving(false)} />}
      {kicking && <KickDialog ch={ch} onClose={() => setKicking(false)} />}
    </>
  )
}

// ---------------------------------------------------------------- hộp thoại lưu / đá

function SaveDialog({ ch, name, draft, onClose }: { ch: CharacterFull; name: string; draft: Data; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const m = useMutation({
    mutationFn: () => api.put<{ version: number; online: boolean }>(`/characters/${ch.id}`, { version: ch.version, name, data: draft, reason }),
    onSuccess: (r) => {
      toast(r.online ? 'Đã lưu — người chơi sẽ bị đá ra để nạp bản mới' : 'Đã lưu nhân vật')
      qc.invalidateQueries({ queryKey: ['character', String(ch.id)] })
      qc.invalidateQueries({ queryKey: ['account', String(ch.account_id)] })
      onClose()
    },
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title="Lưu thay đổi nhân vật"
      desc="Ghi đè dữ liệu nhân vật bằng bản đang sửa. Mọi thay đổi được ghi vào nhật ký."
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button variant="primary" loading={m.isPending} disabled={reason.trim().length < 5} onClick={() => m.mutate()}>Lưu</Button>
        </>
      }
    >
      <ReasonField value={reason} onChange={setReason} />
      {m.error && <div className="mt-3"><ErrorBox error={m.error} /></div>}
    </Dialog>
  )
}

function KickDialog({ ch, onClose }: { ch: CharacterFull; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const m = useMutation({
    mutationFn: () => api.post(`/characters/${ch.id}/kick`, { reason }),
    onSuccess: () => {
      toast('Đã gửi lệnh — người chơi bị đá ra trong vòng ~30 giây')
      qc.invalidateQueries({ queryKey: ['character', String(ch.id)] })
      onClose()
    },
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title="Đá khỏi game"
      desc="Người chơi bị ngắt khỏi game (phần chơi chưa lưu bị mất). Họ vào lại được ngay."
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button variant="danger" loading={m.isPending} disabled={reason.trim().length < 5} onClick={() => m.mutate()}>Đá ra</Button>
        </>
      }
    >
      <ReasonField value={reason} onChange={setReason} />
      {m.error && <div className="mt-3"><ErrorBox error={m.error} /></div>}
    </Dialog>
  )
}

// ---------------------------------------------------------------- ô nhập

function NumInput({ value, onChange, min, max, compact }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; compact?: boolean
}) {
  return (
    <input
      className={compact ? 'input no-spin px-1 text-center tabular' : 'input tabular'}
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      onChange={(e) => {
        let v = Math.trunc(Number(e.target.value) || 0)
        if (min !== undefined) v = Math.max(min, v)
        if (max !== undefined) v = Math.min(max, v)
        onChange(v)
      }}
    />
  )
}

function NumField({ d, k, label, update, min = 0, max, hint }: {
  d: Data; k: string; label: string; update: Update; min?: number; max?: number; hint?: ReactNode
}) {
  return (
    <Field label={label} hint={hint}>
      <NumInput value={Number(d[k] ?? 0)} min={min} max={max} onChange={(v) => update((n) => { n[k] = v })} />
    </Field>
  )
}

// ---------------------------------------------------------------- tổng quan

function Overview({ d, update, name, setName, cat }: {
  d: Data; update: Update; name: string; setName: (v: string) => void; cat: Catalog
}) {
  return (
    <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Tên nhân vật" hint="2–16 ký tự, không trùng trên máy chủ.">
        <input className="input" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Môn phái" hint="Đổi phái: hệ ngũ hành theo phái mới.">
        <select
          className="input"
          value={d.sect_id ?? ''}
          onChange={(e) => update((n) => {
            const s = cat.sects.find((x) => x.id === e.target.value)
            n.sect_id = s?.id ?? ''
            n.sect_name = s?.n ?? NO_SECT_NAME
          })}
        >
          <option value="">{NO_SECT_NAME}</option>
          {cat.sects.map((s) => <option key={s.id} value={s.id}>{s.n}</option>)}
        </select>
      </Field>
      <Field label="Giới tính">
        <input className="input" disabled value={Number(d.gender) === 1 ? 'Nữ' : 'Nam'} />
      </Field>
      <NumField d={d} k="level" label="Cấp" update={update} min={1} max={200} />
      <NumField d={d} k="exp" label="Kinh nghiệm" update={update} />
      <Field label="Phe">
        <select className="input" value={Number(d.nation ?? 0)} onChange={(e) => update((n) => { n.nation = Number(e.target.value) })}>
          {NATIONS.map((l, i) => <option key={i} value={i}>{l}</option>)}
        </select>
      </Field>
      <NumField d={d} k="gold" label="Lượng (tiền hành trang)" update={update} hint={fmtNum(Number(d.gold ?? 0))} />
      <NumField d={d} k="jade" label="Nguyên bảo" update={update} hint={fmtNum(Number(d.jade ?? 0))} />
      <NumField d={d} k="storage_gold" label="Tiền trong rương" update={update} hint={fmtNum(Number(d.storage_gold ?? 0))} />
      <NumField d={d} k="prestige" label="Danh vọng" update={update} />
      <NumField d={d} k="fuyuan" label="Phúc duyên" update={update} />
      <NumField d={d} k="pk_value" label="Điểm PK" update={update} max={10} />
      <NumField d={d} k="lead_level" label="Cấp lãnh đạo" update={update} />
      <NumField d={d} k="stamina" label="Thể lực" update={update} />
      <Field label="Danh hiệu">
        <input className="input" value={d.title ?? ''} onChange={(e) => update((n) => { n.title = e.target.value })} />
      </Field>
    </div>
  )
}

// ---------------------------------------------------------------- điểm + kỹ năng

function Points({ d, update, cat }: { d: Data; update: Update; cat: Catalog }) {
  const sect = cat.sects.find((s) => s.id === d.sect_id)
  const levels: Record<string, number> = d.skill_levels ?? {}
  const known = new Set(sect?.skills.map((s) => s.id) ?? [])
  const others = Object.keys(levels).filter((id) => !known.has(id))
  const setLevel = (id: string, v: number) => update((n) => {
    n.skill_levels = { ...(n.skill_levels ?? {}) }
    if (v > 0) n.skill_levels[id] = v
    else delete n.skill_levels[id]
  })
  const skillName = (id: string) => {
    for (const s of cat.sects) {
      const k = s.skills.find((x) => x.id === id)
      if (k) return `${k.n} (${s.n})`
    }
    return id
  }
  return (
    <div className="space-y-6 p-5">
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <NumField d={d} k="strength" label="Sức mạnh" update={update} />
        <NumField d={d} k="dexterity" label="Thân pháp" update={update} />
        <NumField d={d} k="vitality" label="Sinh khí" update={update} />
        <NumField d={d} k="energy" label="Nội công" update={update} />
        <NumField d={d} k="potential_points" label="Điểm tiềm năng" update={update} />
        <NumField d={d} k="skill_points" label="Điểm kỹ năng" update={update} />
      </div>

      <Card
        title={`Kỹ năng ${sect ? '— ' + sect.n : '(chưa vào môn phái)'}`}
        bodyClass=""
        action={sect && (
          <Button size="sm" variant="ghost" onClick={() => update((n) => {
            n.skill_levels = { ...(n.skill_levels ?? {}) }
            for (const s of sect.skills) n.skill_levels[s.id] = s.max
          })}>Tất cả tối đa</Button>
        )}
      >
        {!sect || sect.skills.length === 0 ? (
          <Empty title="Không có kỹ năng môn phái" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-subtle/50">
                <tr><th className="th">Kỹ năng</th><th className="th">Cấp học</th><th className="th">Tối đa</th><th className="th w-40">Cấp hiện tại</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sect.skills.map((s) => (
                  <tr key={s.id}>
                    <td className="td"><div className="font-medium">{s.n}</div><div className="text-xs text-muted">{s.id}</div></td>
                    <td className="td tabular">{s.req}</td>
                    <td className="td tabular">{s.max}</td>
                    <td className="td"><NumInput value={Number(levels[s.id] ?? 0)} min={0} max={s.max} onChange={(v) => setLevel(s.id, v)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {others.length > 0 && (
        <Card title="Kỹ năng khác đã học (không thuộc phái hiện tại)" bodyClass="">
          <table className="w-full">
            <tbody className="divide-y divide-line">
              {others.map((id) => (
                <tr key={id}>
                  <td className="td"><div className="font-medium">{skillName(id)}</div><div className="text-xs text-muted">{id}</div></td>
                  <td className="td w-40"><NumInput value={Number(levels[id] ?? 0)} min={0} onChange={(v) => setLevel(id, v)} /></td>
                  <td className="td w-12 text-right">
                    <Button size="sm" variant="ghost" aria-label="Xóa" onClick={() => setLevel(id, 0)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- danh sách đồ

function itemSummary(it: Item): string {
  const lines = [...(it.magic ?? []), ...(it.expand_magic ?? [])].filter((l) => l.attrib)
  if (lines.length === 0) return 'Không có dòng thuộc tính'
  return lines.slice(0, 4).map((l) => `${l.name || l.attrib} ${l.value?.[0] ?? ''}`).join(' · ') + (lines.length > 4 ? ` · +${lines.length - 4}` : '')
}

function ItemCell({ it, cat }: { it: Item; cat: Catalog }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={it.gold >= 0 ? 'font-medium text-gold' : 'font-medium'}>{itemName(cat, it)}</span>
        <Badge>{SERIES[it.series] ?? '?'}</Badge>
        {it.lock !== 0 && <Badge tone="warn">{LOCK_LABEL[it.lock] ?? `Khoá ${it.lock}`}</Badge>}
      </div>
      <div className="mt-0.5 text-xs text-muted">{itemSummary(it)}</div>
    </div>
  )
}

function ItemTable({ items, cat, where, actions }: {
  items: Item[]; cat: Catalog; where: (it: Item) => ReactNode; actions: (it: Item, i: number) => ReactNode
}) {
  if (items.length === 0) return <Empty title="Trống" />
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="border-b border-line bg-subtle/50">
          <tr><th className="th">Món</th><th className="th">Vị trí</th><th className="th" /></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((it, i) => (
            <tr key={it.uid || i}>
              <td className="td"><ItemCell it={it} cat={cat} /></td>
              <td className="td whitespace-nowrap text-muted">{where(it)}</td>
              <td className="td"><div className="flex justify-end gap-1">{actions(it, i)}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const IconBtn = ({ title, onClick, children, danger }: { title: string; onClick: () => void; children: ReactNode; danger?: boolean }) => (
  <Button size="sm" variant="ghost" title={title} aria-label={title} onClick={onClick} className={danger ? 'hover:text-danger' : ''}>{children}</Button>
)

type Loc = { list: 'inventory' | 'storage'; index: number } | { list: 'equipment'; part: string }

function useItemEditor(update: Update, cat: Catalog) {
  const [editing, setEditing] = useState<{ loc: Loc; item: Item } | null>(null)
  const dialog = editing && (
    <ItemDialog
      item={editing.item}
      cat={cat}
      onClose={() => setEditing(null)}
      onSave={(it) => {
        const loc = editing.loc
        update((n) => {
          if (loc.list === 'equipment') n.equipment[loc.part] = it
          else n[loc.list][loc.index] = it
        })
        setEditing(null)
      }}
    />
  )
  return { open: (loc: Loc, item: Item) => setEditing({ loc, item }), dialog }
}

// Chuyển món vào hành trang / rương (xếp chỗ trống đầu tiên). Trả lời lỗi nếu hết chỗ.
function moveInto(n: Data, cat: Catalog, target: 'inventory' | 'storage', it: Item): string {
  const list: Item[] = (n[target] = n[target] ?? [])
  const moved = { ...it, rx: -1, ry: -1, rb: 0 }
  const ok = target === 'inventory'
    ? placeItem(cat, list, moved, cat.room.w, cat.room.h, cat.room.bags)
    : placeItem(cat, list, moved, cat.storage.w, cat.storage.h, 1 + Number(n.storage_extra ?? 0))
  if (!ok) return target === 'inventory' ? 'Hành trang hết chỗ' : 'Rương hết chỗ'
  list.push(moved)
  return ''
}

function Equipment({ d, update, cat }: { d: Data; update: Update; cat: Catalog }) {
  const editor = useItemEditor(update, cat)
  const eq: Record<string, Item> = d.equipment ?? {}
  const parts = Object.keys(cat.parts).sort((a, b) => Number(a) - Number(b))
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line bg-subtle/50">
            <tr><th className="th w-32">Ô</th><th className="th">Món đang mặc</th><th className="th" /></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {parts.map((p) => {
              const it = eq[p]
              return (
                <tr key={p}>
                  <td className="td font-medium">{cat.parts[p]}</td>
                  <td className="td">{it ? <ItemCell it={it} cat={cat} /> : <span className="text-muted">—</span>}</td>
                  <td className="td">
                    {it && (
                      <div className="flex justify-end gap-1">
                        <IconBtn title="Sửa" onClick={() => editor.open({ list: 'equipment', part: p }, it)}><Pencil className="h-3.5 w-3.5" /></IconBtn>
                        <IconBtn title="Tháo vào hành trang" onClick={() => update((n) => {
                          const err = moveInto(n, cat, 'inventory', it)
                          if (err) return err
                          delete n.equipment[p]
                        })}><ArrowDownToLine className="h-3.5 w-3.5" /></IconBtn>
                        <IconBtn title="Xóa" danger onClick={() => update((n) => { delete n.equipment[p] })}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {editor.dialog}
    </>
  )
}

function Inventory({ d, update, cat }: { d: Data; update: Update; cat: Catalog }) {
  const editor = useItemEditor(update, cat)
  const items: Item[] = d.inventory ?? []
  const wear = (i: number) => update((n) => {
    const it: Item = n.inventory[i]
    const parts = DETAIL_TO_PARTS[itemDetail(cat, it)] ?? []
    if (parts.length === 0) return 'Món này không mặc được'
    n.equipment = n.equipment ?? {}
    const part = String(parts.find((p) => !n.equipment[String(p)]) ?? parts[0])
    const old: Item | undefined = n.equipment[part]
    n.inventory.splice(i, 1)
    if (old) {
      const err = moveInto(n, cat, 'inventory', old)
      if (err) {
        n.inventory.splice(i, 0, it)
        return err
      }
    }
    n.equipment[part] = { ...it, rx: -1, ry: -1, rb: 0 }
  })
  return (
    <>
      <div className="flex items-center justify-between border-b border-line px-5 py-3 text-sm text-muted">
        <span>{items.length} món · {cat.room.bags} túi × {cat.room.w}×{cat.room.h} ô</span>
        {items.length > 0 && <Button size="sm" variant="ghost" onClick={() => update((n) => { n.inventory = [] })}>Xóa hết</Button>}
      </div>
      <ItemTable
        items={items}
        cat={cat}
        where={(it) => `Túi ${it.rb + 1} · ${it.rx},${it.ry}`}
        actions={(it, i) => (
          <>
            <IconBtn title="Sửa" onClick={() => editor.open({ list: 'inventory', index: i }, it)}><Pencil className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Mặc vào" onClick={() => wear(i)}><Shirt className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Cất vào rương" onClick={() => update((n) => {
              const err = moveInto(n, cat, 'storage', it)
              if (err) return err
              n.inventory.splice(i, 1)
            })}><ArrowRightLeft className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Xóa" danger onClick={() => update((n) => { n.inventory.splice(i, 1) })}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
          </>
        )}
      />
      {editor.dialog}
    </>
  )
}

function Storage({ d, update, cat }: { d: Data; update: Update; cat: Catalog }) {
  const editor = useItemEditor(update, cat)
  const items: Item[] = d.storage ?? []
  return (
    <>
      <div className="grid gap-4 border-b border-line p-5 sm:grid-cols-2">
        <NumField d={d} k="storage_extra" label="Số rương mở rộng đã mở" update={update} max={cat.storage.max_extra}
          hint={`Tổng ${1 + Number(d.storage_extra ?? 0)} rương × ${cat.storage.w}×${cat.storage.h} ô`} />
        <NumField d={d} k="storage_gold" label="Tiền trong rương" update={update} hint={fmtNum(Number(d.storage_gold ?? 0))} />
      </div>
      <ItemTable
        items={items}
        cat={cat}
        where={(it) => `Rương ${it.rb + 1} · ${it.rx},${it.ry}`}
        actions={(it, i) => (
          <>
            <IconBtn title="Sửa" onClick={() => editor.open({ list: 'storage', index: i }, it)}><Pencil className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Lấy ra hành trang" onClick={() => update((n) => {
              const err = moveInto(n, cat, 'inventory', it)
              if (err) return err
              n.storage.splice(i, 1)
            })}><ArrowRightLeft className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Xóa" danger onClick={() => update((n) => { n.storage.splice(i, 1) })}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
          </>
        )}
      />
      {editor.dialog}
    </>
  )
}

// ---------------------------------------------------------------- sửa 1 món

function ItemDialog({ item, cat, onClose, onSave }: { item: Item; cat: Catalog; onClose: () => void; onSave: (it: Item) => void }) {
  const [it, setIt] = useState<Item>(() => structuredClone(item))
  const [raw, setRaw] = useState<string | null>(null)
  const [rawErr, setRawErr] = useState('')
  const set = (fn: (x: Item) => void) => setIt((p) => {
    const n = structuredClone(p)
    fn(n)
    return n
  })
  const lines = (key: 'magic' | 'expand_magic', title: string) => (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="label mb-0">{title}</span>
        <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set((x) => {
          x[key] = [...(x[key] ?? []), { attrib: '', name: '', value: [0, 0, 0], prefix: true }]
        })}>Thêm dòng</Button>
      </div>
      {(it[key] ?? []).length === 0 && <p className="text-sm text-muted">Không có</p>}
      <div className="space-y-2">
        {(it[key] ?? []).map((l: MagicLine, i: number) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <input className="input col-span-3" placeholder="attrib (vd lifemax_v)" value={l.attrib}
              onChange={(e) => set((x) => { x[key][i].attrib = e.target.value })} />
            <input className="input col-span-3" placeholder="Tên hiển thị" value={l.name}
              onChange={(e) => set((x) => { x[key][i].name = e.target.value })} />
            {[0, 1, 2].map((k) => (
              <div key={k} className="col-span-2">
                <NumInput compact value={Number(l.value?.[k] ?? 0)} min={-999999} onChange={(v) => set((x) => {
                  const val = [...(x[key][i].value ?? [0, 0, 0])]
                  val[k] = v
                  x[key][i].value = val
                })} />
              </div>
            ))}
            <div className="col-span-12 -mt-1 flex justify-end sm:col-span-12">
              <button type="button" className="text-xs text-muted hover:text-danger" onClick={() => set((x) => { x[key].splice(i, 1) })}>Xóa dòng</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={itemName(cat, it)}
      desc={`uid ${it.uid || '—'} · ${it.gold >= 0 ? `hoàng kim #${it.gold}` : `đồ gốc #${it.base}`} · seed ${it.seed}`}
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button variant="primary" onClick={() => {
            if (raw === null) return onSave(it)
            try {
              onSave(JSON.parse(raw))
            } catch {
              setRawErr('JSON không hợp lệ')
            }
          }}>Xong</Button>
        </>
      }
    >
      {raw !== null ? (
        <div className="space-y-2">
          <textarea className="input h-96 py-2 font-mono text-xs" value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} />
          {rawErr && <ErrorBox error={new Error(rawErr)} />}
          <Button size="sm" variant="ghost" onClick={() => setRaw(null)}>Về form</Button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Ngũ hành">
              <select className="input" value={it.series} onChange={(e) => set((x) => { x.series = Number(e.target.value) })}>
                {SERIES.map((s, i) => <option key={i} value={i}>{s}</option>)}
              </select>
            </Field>
            <Field label="Độ bền"><NumInput value={it.durability} min={0} onChange={(v) => set((x) => { x.durability = v })} /></Field>
            <Field label="May mắn"><NumInput value={it.luck} min={0} onChange={(v) => set((x) => { x.luck = v })} /></Field>
            <Field label="Khoá">
              <select className="input" value={it.lock} onChange={(e) => set((x) => { x.lock = Number(e.target.value) })}>
                {Object.entries(LOCK_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          </div>
          {(it.base_values ?? []).length > 0 && (
            <div>
              <span className="label">Thuộc tính gốc</span>
              <div className="grid gap-2 sm:grid-cols-2">
                {it.base_values.map(([k, v], i) => (
                  <div key={k + i} className="flex items-center gap-2">
                    <span className="w-44 truncate text-sm text-muted" title={k}>{k}</span>
                    <NumInput value={Number(v)} min={-999999} onChange={(nv) => set((x) => { x.base_values[i] = [k, nv] })} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {lines('magic', 'Dòng thuộc tính (dòng 1/3/5 hiện, 2/4/6 ẩn — mở bằng ngũ hành)')}
          {(it.gold >= 0 || (it.expand_magic ?? []).length > 0) && lines('expand_magic', 'Dòng mở rộng hoàng kim (theo số món cùng bộ)')}
          <Button size="sm" variant="ghost" onClick={() => { setRaw(JSON.stringify(it, null, 2)); setRawErr('') }}>Sửa bằng JSON</Button>
        </div>
      )}
    </Dialog>
  )
}

// ---------------------------------------------------------------- tặng đồ

const randomSeed = () => Math.floor(Math.random() * 2147483647)

function Grants({ d, update, cat }: { d: Data; update: Update; cat: Catalog }) {
  const toast = useToast()
  const [kind, setKind] = useState<'equip' | 'gold'>('equip')
  const [detail, setDetail] = useState(0)
  const [particular, setParticular] = useState(0)
  const [level, setLevel] = useState(10)
  const [series, setSeries] = useState(0)
  const [magic, setMagic] = useState<number[]>([10, 10, 10, 10, 10, 10])
  const [luck, setLuck] = useState(0)
  const [lock, setLock] = useState(0)
  const [count, setCount] = useState(1)
  const [goldQ, setGoldQ] = useState('')
  const [goldIdx, setGoldIdx] = useState<number | null>(null)
  const [perfection, setPerfection] = useState(10)

  const particulars = Object.entries(cat.particulars[String(detail)] ?? {})
  const levels = useMemo(
    () => cat.equip.filter((e) => e.d === detail && e.p === particular).sort((a, b) => a.l - b.l),
    [cat, detail, particular],
  )
  const base = levels.find((e) => e.l === level)
  const goldHits = useMemo(() => {
    const q = goldQ.trim().toLowerCase()
    if (!q) return []
    return cat.gold.filter((g) => g.n.toLowerCase().includes(q)).slice(0, 50)
  }, [cat, goldQ])
  const grants: Data[] = d.admin_grants ?? []

  const grantName = (g: Data) => {
    if (g.kind === 'gold') return cat.gold[g.gold]?.n ?? `Hoàng kim #${g.gold}`
    const e = cat.equip.find((x) => x.d === g.detail && x.p === g.particular && x.l === g.level)
    return e ? `${e.n} (cấp ${g.level}, ${SERIES[g.series] ?? '?'})` : `Đồ ${g.detail}/${g.particular}/${g.level}`
  }

  const add = () => {
    if (kind === 'gold' && goldIdx === null) return toast('Chọn 1 món hoàng kim', 'danger')
    if (kind === 'equip' && !base) return toast('Không có đồ cấp này', 'danger')
    update((n) => {
      n.admin_grants = [...(n.admin_grants ?? [])]
      for (let i = 0; i < count; i++) {
        n.admin_grants.push(kind === 'gold'
          ? { kind: 'gold', gold: goldIdx, perfection, lock, seed: randomSeed() }
          : { kind: 'equip', detail, particular, level, series, magic: [...magic], luck, lock, seed: randomSeed() })
      }
    })
    toast(`Đã thêm ${count} món vào danh sách tặng — bấm "Lưu thay đổi" để gửi`)
  }

  return (
    <div className="grid gap-6 p-5 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="rounded-lg border border-line bg-subtle/60 px-3 py-2.5 text-sm text-muted">
          Đồ được tạo bằng đúng bộ sinh đồ của game khi nhân vật vào map (đang online thì bị đá ra rồi vào lại). Hành trang hết chỗ
          thì món chờ tới lần vào sau.
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={kind === 'equip' ? 'primary' : 'secondary'} onClick={() => setKind('equip')}>Đồ thường / xanh</Button>
          <Button size="sm" variant={kind === 'gold' ? 'primary' : 'secondary'} onClick={() => setKind('gold')}>Hoàng kim</Button>
        </div>
        {kind === 'equip' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Loại đồ">
              <select className="input" value={detail} onChange={(e) => { setDetail(Number(e.target.value)); setParticular(Number(Object.keys(cat.particulars[e.target.value] ?? {})[0] ?? 0)) }}>
                {Object.entries(cat.details).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Loại cụ thể">
              <select className="input" value={particular} onChange={(e) => setParticular(Number(e.target.value))}>
                {particulars.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Cấp đồ" hint={base?.n ?? 'Không có'}>
              <select className="input" value={level} onChange={(e) => setLevel(Number(e.target.value))}>
                {levels.map((e) => <option key={e.l} value={e.l}>{e.l} — {e.n}</option>)}
              </select>
            </Field>
            <Field label="Ngũ hành">
              <select className="input" value={series} onChange={(e) => setSeries(Number(e.target.value))}>
                {SERIES.map((s, i) => <option key={i} value={i}>{s}</option>)}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Cấp 6 dòng thuộc tính (0 = không có dòng)" hint="Dòng 1/3/5 hiện, 2/4/6 ẩn. Cấp càng cao dòng càng mạnh (tối đa 10).">
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {magic.map((m, i) => (
                    <div key={i}>
                      <div className="mb-1 text-center text-xs text-muted">Dòng {i + 1}</div>
                      <NumInput compact value={m} min={0} max={10} onChange={(v) => setMagic((x) => x.map((y, j) => (j === i ? v : y)))} />
                    </div>
                  ))}
                </div>
              </Field>
            </div>
            <Field label="May mắn" hint="Càng cao càng dễ ra dòng tốt."><NumInput value={luck} min={0} max={100} onChange={setLuck} /></Field>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Tìm hoàng kim theo tên">
              <input className="input" value={goldQ} onChange={(e) => setGoldQ(e.target.value)} placeholder="vd: Mộng Long" />
            </Field>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
              {goldHits.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted">{goldQ ? 'Không thấy món nào' : 'Nhập tên để tìm'}</p>
              ) : goldHits.map((g) => (
                <button
                  key={g.i}
                  type="button"
                  onClick={() => setGoldIdx(g.i)}
                  className={'block w-full px-3 py-2 text-left text-sm hover:bg-subtle ' + (goldIdx === g.i ? 'bg-accent/10 text-accent' : '')}
                >
                  <span className="font-medium">{g.n}</span>
                  <span className="text-muted"> · {cat.details[String(g.d)]} · {SERIES[g.s]} · {g.m >= 0 ? cat.sects.find((s) => s.id === cat.menpai[g.m])?.n ?? cat.menpai[g.m] : 'mọi phái'}</span>
                </button>
              ))}
            </div>
            <Field label="Độ hoàn mỹ (0–10)" hint="10 = mọi dòng đạt giá trị cao nhất."><NumInput value={perfection} min={0} max={10} onChange={setPerfection} /></Field>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Khoá">
            <select className="input" value={lock} onChange={(e) => setLock(Number(e.target.value))}>
              {[0, -1, -2, -3].map((v) => <option key={v} value={v}>{LOCK_LABEL[v]}</option>)}
            </select>
          </Field>
          <Field label="Số lượng"><NumInput value={count} min={1} max={50} onChange={setCount} /></Field>
        </div>
        <Button variant="primary" icon={<Gift className="h-4 w-4" />} onClick={add}>Thêm vào danh sách tặng</Button>
      </div>

      <Card title={`Đồ chờ giao (${grants.length})`} bodyClass="">
        {grants.length === 0 ? (
          <Empty title="Chưa có đồ chờ giao" />
        ) : (
          <ul className="divide-y divide-line">
            {grants.map((g, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className={g.kind === 'gold' ? 'text-gold' : ''}>{grantName(g)}</span>
                <IconBtn title="Bỏ" danger onClick={() => update((n) => { n.admin_grants.splice(i, 1) })}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- JSON

function JsonTab({ d, setDraft }: { d: Data; setDraft: (d: Data) => void }) {
  const toast = useToast()
  const [text, setText] = useState(() => JSON.stringify(d, null, 2))
  const [err, setErr] = useState('')
  return (
    <div className="space-y-3 p-5">
      <p className="text-sm text-muted">Toàn bộ dữ liệu nhân vật (PlayerProfile). Sửa sai có thể làm hỏng nhân vật — chỉ dùng khi các tab khác không có trường cần sửa.</p>
      <textarea className="input h-[60vh] py-2 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {err && <ErrorBox error={new Error(err)} />}
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => {
          try {
            const v = JSON.parse(text)
            if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error()
            setDraft(v)
            setErr('')
            toast('Đã áp dụng vào bản đang sửa')
          } catch {
            setErr('JSON không hợp lệ (phải là 1 object)')
          }
        }}>Áp dụng</Button>
        <Button onClick={() => { setText(JSON.stringify(d, null, 2)); setErr('') }}>Lấy lại từ bản đang sửa</Button>
      </div>
    </div>
  )
}
