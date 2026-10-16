import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Activity, Ban, MessageSquareOff, Swords, UserPlus, Users, Wifi } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, type Stats } from '../lib/api'
import { actionLabel, fmtAgo, fmtDay, fmtNum, REGION_LABEL, SERVER_STATUS } from '../lib/format'
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, Stat } from '../components/ui'

export default function DashboardPage() {
  const q = useQuery({ queryKey: ['stats'], queryFn: () => api.get<Stats>('/stats'), refetchInterval: 60_000 })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const s = q.data!
  const series = s.registrations.map((r, i) => ({ day: r.day, reg: r.count, active: s.active_daily[i]?.count ?? 0 }))
  const reg30 = s.registrations.reduce((a, b) => a + b.count, 0)

  return (
    <>
      <PageHeader title="Tổng quan" desc="Số liệu cập nhật mỗi phút, theo giờ Việt Nam." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Tổng tài khoản" value={fmtNum(s.accounts)} hint={`+${fmtNum(s.new_7d)} trong 7 ngày`} icon={<Users className="h-4 w-4" />} tone="info" />
        <Stat label="Đăng ký hôm nay" value={fmtNum(s.new_today)} hint={`${fmtNum(reg30)} trong 30 ngày`} icon={<UserPlus className="h-4 w-4" />} tone="ok" />
        <Stat label="Hoạt động hôm nay" value={fmtNum(s.active_today)} hint={`${fmtNum(s.active_7d)} tài khoản trong 7 ngày`} icon={<Activity className="h-4 w-4" />} tone="gold" />
        <Stat
          label="Đang online"
          value={s.online == null ? '—' : fmtNum(s.online)}
          hint={s.online == null ? 'Có khi game server chạy' : 'Người chơi trong map'}
          icon={<Wifi className="h-4 w-4" />}
          tone="neutral"
        />
        <Stat label="Nhân vật" value={fmtNum(s.characters)} icon={<Swords className="h-4 w-4" />} tone="neutral" />
        <Stat label="Đang bị khóa" value={fmtNum(s.banned)} icon={<Ban className="h-4 w-4" />} tone="danger" />
        <Stat label="Đang bị cấm chat" value={fmtNum(s.muted)} icon={<MessageSquareOff className="h-4 w-4" />} tone="warn" />
        <Stat label="Máy chủ" value={s.servers.length} hint={`${s.servers.filter((x) => x.status === 'maintenance').length} đang bảo trì`} icon={<Wifi className="h-4 w-4" />} tone="neutral" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="30 ngày gần đây"
          action={
            <div className="flex items-center gap-4 text-xs text-muted">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent" />Đăng ký mới</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-gold" />Tài khoản hoạt động</span>
            </div>
          }
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                <defs>
                  <linearGradient id="gReg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gAct" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(var(--gold))" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="rgb(var(--gold))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgb(var(--line))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fill: 'rgb(var(--muted))', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis allowDecimals={false} tick={{ fill: 'rgb(var(--muted))', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  labelFormatter={(d) => fmtDay(String(d))}
                  formatter={(v: number, k) => [fmtNum(v), k === 'reg' ? 'Đăng ký mới' : 'Hoạt động']}
                  contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'rgb(var(--fg))', fontWeight: 600 }}
                />
                <Area type="monotone" dataKey="active" stroke="rgb(var(--gold))" strokeWidth={2} fill="url(#gAct)" animationDuration={600} />
                <Area type="monotone" dataKey="reg" stroke="rgb(var(--accent))" strokeWidth={2} fill="url(#gReg)" animationDuration={600} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Máy chủ" action={<Link to="/servers" className="text-xs font-medium text-accent hover:underline">Quản lý</Link>} bodyClass="divide-y divide-line">
          {s.servers.length === 0 && <Empty title="Chưa có máy chủ" />}
          {s.servers.map((g) => {
            const st = SERVER_STATUS[g.status] ?? SERVER_STATUS.normal
            return (
              <div key={g.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{g.name}</div>
                  <div className="text-xs text-muted">{REGION_LABEL[g.region]} · {fmtNum(g.characters)} nhân vật</div>
                </div>
                <Badge tone={st.tone} dot>{st.label}</Badge>
              </div>
            )
          })}
        </Card>
      </div>

      <Card className="mt-6" title="Thao tác admin gần đây" action={<Link to="/audit" className="text-xs font-medium text-accent hover:underline">Xem tất cả</Link>} bodyClass="">
        {s.recent_audit.length === 0 ? (
          <Empty title="Chưa có thao tác nào" />
        ) : (
          <ul className="divide-y divide-line">
            {s.recent_audit.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{a.admin || 'Hệ thống'}</span>{' '}
                  <span className="text-muted">{actionLabel(a.action).toLowerCase()}</span>{' '}
                  {a.target_type === 'account' && a.target ? (
                    <Link to={`/accounts/${a.target_id}`} className="font-medium text-accent hover:underline">{a.target}</Link>
                  ) : (
                    a.target && <span className="font-medium">{a.target}</span>
                  )}
                  {a.reason && <span className="text-muted"> — {a.reason}</span>}
                </div>
                <span className="text-xs text-muted">{fmtAgo(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
