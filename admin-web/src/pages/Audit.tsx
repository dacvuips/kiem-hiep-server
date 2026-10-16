import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { api, type AuditItem, type Page } from '../lib/api'
import { ACTION_LABEL, actionLabel, fmtDateTime } from '../lib/format'
import { Empty, ErrorBox, Loading, PageHeader, Pager } from '../components/ui'

const GROUPS = [
  { v: '', l: 'Tất cả thao tác' },
  { v: 'account.', l: 'Tài khoản người chơi' },
  { v: 'character.', l: 'Nhân vật' },
  { v: 'server.', l: 'Máy chủ' },
  { v: 'admin.', l: 'Admin' },
  ...Object.entries(ACTION_LABEL).map(([v, l]) => ({ v, l: '— ' + l })),
]

// Nhật ký thao tác admin (chỉ thêm, không sửa / xóa được ở database).
export default function AuditPage() {
  const [params, setParams] = useSearchParams()
  const action = params.get('action') || ''
  const page = Number(params.get('page') || 1)
  const q = useQuery({
    queryKey: ['audit', action, page],
    queryFn: () => api.get<Page<AuditItem>>(`/audit?action=${encodeURIComponent(action)}&page=${page}&size=25`),
    placeholderData: keepPreviousData,
  })
  return (
    <>
      <PageHeader title="Nhật ký" desc="Mọi thao tác của admin. Nhật ký không thể sửa hoặc xóa." />
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <select
            className="input max-w-xs"
            value={action}
            onChange={(e) => setParams((p) => { p.set('action', e.target.value); p.delete('page'); return p })}
          >
            {GROUPS.map((g) => <option key={g.v} value={g.v}>{g.l}</option>)}
          </select>
          {q.data && <span className="text-sm text-muted tabular">{q.data.total} mục</span>}
        </div>
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <div className="p-4"><ErrorBox error={q.error} /></div>
        ) : q.data!.items.length === 0 ? (
          <Empty icon={<ScrollText className="h-8 w-8" />} title="Không có mục nào" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-line bg-subtle/50">
                  <tr>
                    <th className="th">Thời gian</th>
                    <th className="th">Admin</th>
                    <th className="th">Thao tác</th>
                    <th className="th">Đối tượng</th>
                    <th className="th hidden md:table-cell">Lý do</th>
                    <th className="th hidden lg:table-cell">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {q.data!.items.map((a) => (
                    <tr key={a.id} className="align-top hover:bg-subtle/60">
                      <td className="td whitespace-nowrap text-muted tabular">{fmtDateTime(a.created_at)}</td>
                      <td className="td font-medium">{a.admin || 'Hệ thống'}</td>
                      <td className="td">
                        <div>{actionLabel(a.action)}</div>
                        <Detail d={a.detail} />
                      </td>
                      <td className="td">
                        {a.target_type === 'account' ? (
                          <Link to={`/accounts/${a.target_id}`} className="font-medium text-accent hover:underline">{a.target || `#${a.target_id}`}</Link>
                        ) : (
                          <span>{a.target || (a.target_id ? `#${a.target_id}` : '—')}</span>
                        )}
                      </td>
                      <td className="td hidden max-w-xs text-muted md:table-cell">{a.reason || '—'}</td>
                      <td className="td hidden font-mono text-xs text-muted lg:table-cell">{a.ip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} size={25} total={q.data!.total} onPage={(p) => setParams((x) => { x.set('page', String(p)); return x })} />
          </>
        )}
      </div>
    </>
  )
}

const DETAIL_LABEL: Record<string, string> = {
  hours: 'Số giờ', old_email: 'Email cũ', new_email: 'Email mới', role: 'Vai trò', old_role: 'Vai trò cũ', disabled: 'Vô hiệu', name: 'Tên',
  status: 'Trạng thái', region: 'Khu vực', scope: 'Phạm vi', character_id: 'Mã nhân vật',
}

function Detail({ d }: { d: Record<string, unknown> }) {
  const entries = Object.entries(d ?? {}).filter(([k]) => k in DETAIL_LABEL)
  if (entries.length === 0) return null
  return (
    <div className="mt-0.5 text-xs text-muted">
      {entries.map(([k, v]) => `${DETAIL_LABEL[k]}: ${k === 'hours' && v === 0 ? 'vĩnh viễn' : String(v)}`).join(' · ')}
    </div>
  )
}
