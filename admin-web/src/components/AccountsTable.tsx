import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronRight, Search, Users } from 'lucide-react'
import { api, type Account, type Page } from '../lib/api'
import { fmtAgo, fmtDateTime, isFuture } from '../lib/format'
import { Badge, Empty, ErrorBox, Loading, Pager, Tabs } from './ui'

export type StatusFilter = 'all' | 'active' | 'banned' | 'muted'

export function AccountStatus({ a }: { a: Account }) {
  return (
    <div className="flex flex-wrap gap-1">
      {a.status === 'banned' ? (
        <Badge tone="danger" dot>{a.banned_until ? 'Khóa có hạn' : 'Khóa vĩnh viễn'}</Badge>
      ) : (
        <Badge tone="ok" dot>Hoạt động</Badge>
      )}
      {isFuture(a.muted_until) && <Badge tone="warn">Cấm chat</Badge>}
    </div>
  )
}

// Bảng tài khoản có ô tìm kiếm + lọc trạng thái; trạng thái lưu trên URL (?q=&status=&page=) để chia sẻ / quay lại được.
export default function AccountsTable({ tabs }: { tabs: { value: StatusFilter; label: string }[] }) {
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') as StatusFilter) || tabs[0].value
  const page = Number(params.get('page') || 1)
  const q = params.get('q') || ''
  const [text, setText] = useState(q)

  // Gõ xong 300ms mới tìm, đỡ gọi server liên tục.
  useEffect(() => {
    const t = setTimeout(() => {
      if (text !== q) setParams((p) => { p.set('q', text); p.delete('page'); return p }, { replace: true })
    }, 300)
    return () => clearTimeout(t)
  }, [text, q, setParams])

  const query = useQuery({
    queryKey: ['accounts', q, status, page],
    queryFn: () => api.get<Page<Account>>(`/accounts?q=${encodeURIComponent(q)}&status=${status}&page=${page}&size=20`),
    placeholderData: keepPreviousData,
  })

  const set = (k: string, v: string) => setParams((p) => { p.set(k, v); if (k !== 'page') p.delete('page'); return p })

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            className="input pl-9"
            placeholder="Tên, email, IP, mã tài khoản, tên nhân vật…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        {query.data && <span className="text-sm text-muted tabular">{query.data.total} tài khoản</span>}
      </div>
      {tabs.length > 1 && (
        <div className="px-4 pt-1">
          <Tabs value={status} onChange={(v) => set('status', v)} items={tabs} />
        </div>
      )}
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <div className="p-4"><ErrorBox error={query.error} /></div>
      ) : query.data!.items.length === 0 ? (
        <Empty icon={<Users className="h-8 w-8" />} title="Không có tài khoản nào" desc={q ? 'Thử từ khóa khác.' : undefined} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-subtle/50">
                <tr>
                  <th className="th">Tài khoản</th>
                  <th className="th">Trạng thái</th>
                  <th className="th hidden md:table-cell">Nhân vật</th>
                  <th className="th hidden lg:table-cell">Đăng nhập gần nhất</th>
                  <th className="th hidden sm:table-cell">Ngày tạo</th>
                  <th className="th w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {query.data!.items.map((a) => (
                  <tr key={a.id} className="group transition hover:bg-subtle/60">
                    <td className="td">
                      <Link to={`/accounts/${a.id}`} className="block">
                        <div className="font-medium group-hover:text-accent">{a.username}</div>
                        <div className="max-w-[240px] truncate text-xs text-muted">{a.email}</div>
                      </Link>
                    </td>
                    <td className="td">
                      <AccountStatus a={a} />
                      {a.status === 'banned' && a.ban_reason && (
                        <div className="mt-1 max-w-[260px] truncate text-xs text-muted" title={a.ban_reason}>{a.ban_reason}</div>
                      )}
                    </td>
                    <td className="td hidden tabular md:table-cell">{a.characters}</td>
                    <td className="td hidden lg:table-cell">
                      <div>{fmtAgo(a.last_login_at)}</div>
                      <div className="text-xs text-muted tabular">{a.last_login_ip || '—'}</div>
                    </td>
                    <td className="td hidden text-muted tabular sm:table-cell">{fmtDateTime(a.created_at)}</td>
                    <td className="td">
                      <Link to={`/accounts/${a.id}`} aria-label={`Xem ${a.username}`}>
                        <ChevronRight className="h-4 w-4 text-muted group-hover:text-fg" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} size={20} total={query.data!.total} onPage={(p) => set('page', String(p))} />
        </>
      )}
    </div>
  )
}
