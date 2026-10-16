import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type Page, type AuditItem } from '../lib/api'
import { actionLabel, fmtAgo } from '../lib/format'
import AccountsTable from '../components/AccountsTable'
import { Badge, Card, Empty, PageHeader } from '../components/ui'

// Xử phạt: danh sách đang bị khóa / cấm chat + lịch sử xử phạt gần đây.
export default function PunishmentsPage() {
  const history = useQuery({
    queryKey: ['audit', 'punish'],
    queryFn: () => api.get<Page<AuditItem>>('/audit?action=account.&size=15'),
  })
  const tone = (a: string) => (a === 'account.ban' ? 'danger' : a === 'account.mute' ? 'warn' : a.startsWith('account.un') ? 'ok' : 'neutral')
  const punish = (history.data?.items ?? []).filter((a) => ['account.ban', 'account.unban', 'account.mute', 'account.unmute'].includes(a.action))
  return (
    <>
      <PageHeader title="Xử phạt" desc="Tài khoản đang bị khóa hoặc cấm chat. Mở tài khoản để khóa, cấm chat hoặc gỡ." />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <AccountsTable
            tabs={[
              { value: 'banned', label: 'Đang bị khóa' },
              { value: 'muted', label: 'Đang bị cấm chat' },
            ]}
          />
        </div>
        <Card title="Lịch sử xử phạt gần đây" bodyClass="">
          {punish.length === 0 ? (
            <Empty title="Chưa có xử phạt nào" />
          ) : (
            <ul className="divide-y divide-line">
              {punish.map((a) => (
                <li key={a.id} className="space-y-1 px-5 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={tone(a.action)}>{actionLabel(a.action)}</Badge>
                    <span className="text-xs text-muted">{fmtAgo(a.created_at)}</span>
                  </div>
                  <div>
                    <Link to={`/accounts/${a.target_id}`} className="font-medium text-accent hover:underline">{a.target || `#${a.target_id}`}</Link>
                    <span className="text-muted"> bởi {a.admin || 'hệ thống'}</span>
                  </div>
                  {a.reason && <div className="text-muted">{a.reason}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
