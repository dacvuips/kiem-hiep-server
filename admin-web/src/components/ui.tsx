import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react'

// ---------------------------------------------------------------- nút

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent/90 shadow-sm',
  secondary: 'bg-surface text-fg border border-line hover:bg-subtle',
  ghost: 'text-muted hover:text-fg hover:bg-subtle',
  danger: 'bg-danger text-white hover:bg-danger/90 shadow-sm',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'sm' | 'md'
  loading?: boolean
  icon?: ReactNode
}) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-55',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
        VARIANT[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- nhãn

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'gold'
const TONE: Record<Tone, string> = {
  ok: 'bg-ok/10 text-ok ring-ok/20',
  warn: 'bg-warn/10 text-warn ring-warn/25',
  danger: 'bg-danger/10 text-danger ring-danger/20',
  info: 'bg-info/10 text-info ring-info/20',
  neutral: 'bg-subtle text-muted ring-line',
  gold: 'bg-gold/10 text-gold ring-gold/25',
}

export function Badge({ tone = 'neutral', children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONE[tone])}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

// ---------------------------------------------------------------- khung

export function Card({ title, action, children, className, bodyClass }: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClass?: string
}) {
  return (
    <section className={clsx('card', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className={clsx(bodyClass ?? 'p-5')}>{children}</div>
    </section>
  )
}

export function PageHeader({ title, desc, actions }: { title: string; desc?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {desc && <p className="mt-1 text-sm text-muted">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('h-5 w-5 animate-spin text-muted', className)} />
}

export function Loading() {
  return (
    <div className="flex h-48 items-center justify-center">
      <Spinner />
    </div>
  )
}

export function Empty({ icon, title, desc }: { icon?: ReactNode; title: string; desc?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-muted/60">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {desc && <p className="mt-1 max-w-sm text-sm text-muted">{desc}</p>}
    </div>
  )
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : 'Có lỗi xảy ra'
  return (
    <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{msg}</span>
    </div>
  )
}

// ---------------------------------------------------------------- tab

export function Tabs<T extends string>({ value, onChange, items }: {
  value: T
  onChange: (v: T) => void
  items: { value: T; label: ReactNode; count?: number }[]
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line">
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={clsx(
            '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition',
            value === it.value ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
          )}
        >
          {it.label}
          {it.count !== undefined && (
            <span className="rounded-full bg-subtle px-1.5 text-xs tabular text-muted">{it.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- phân trang

export function Pager({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size))
  const from = total === 0 ? 0 : (page - 1) * size + 1
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
      <span className="tabular">
        {from}–{Math.min(page * size, total)} / {total}
      </span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Trang trước">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="tabular px-2">
          {page} / {pages}
        </span>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Trang sau">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- hộp thoại

export function Dialog({ open, onClose, title, desc, children, footer, wide }: {
  open: boolean
  onClose: () => void
  title: string
  desc?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" onClick={onClose} />
      <div className={clsx('card relative w-full max-h-[92vh] overflow-y-auto rounded-b-none sm:rounded-xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            <h3 className="text-base font-semibold">{title}</h3>
            {desc && <div className="mt-1 text-sm text-muted">{desc}</div>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-subtle hover:text-fg" aria-label="Đóng">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-subtle/50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- thông báo nhanh

interface ToastItem {
  id: number
  text: string
  tone: 'ok' | 'danger'
}
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'danger') => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const push = useCallback((text: string, tone: 'ok' | 'danger' = 'ok') => {
    const id = ++seq.current
    setItems((x) => [...x, { id, text, tone }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className="card pointer-events-auto flex items-center gap-2 px-4 py-3 text-sm">
            {t.tone === 'ok' ? <CheckCircle2 className="h-4 w-4 text-ok" /> : <AlertTriangle className="h-4 w-4 text-danger" />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ---------------------------------------------------------------- ô số liệu

export function Stat({ label, value, hint, icon, tone = 'neutral' }: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: Tone
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{label}</span>
        {icon && <span className={clsx('rounded-lg p-1.5 ring-1 ring-inset', TONE[tone])}>{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Lý do" hint="Bắt buộc, ít nhất 5 ký tự. Ghi vào nhật ký, không sửa được.">
      <textarea className="input h-20 resize-none py-2" value={value} onChange={(e) => onChange(e.target.value)} maxLength={500} autoFocus />
    </Field>
  )
}
