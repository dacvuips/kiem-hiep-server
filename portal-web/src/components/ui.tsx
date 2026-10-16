import { createContext, useCallback, useContext, useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Info, Loader2, X } from 'lucide-react'

export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-2 text-sm text-parch-300/80', className)} role="status">
      <Loader2 className="h-4 w-4 animate-spin text-gold-400" aria-hidden />
      {label}
    </span>
  )
}

export function Alert({ tone = 'error', children, className }: { tone?: 'error' | 'ok' | 'info'; children: ReactNode; className?: string }) {
  const Icon = tone === 'error' ? AlertTriangle : tone === 'ok' ? CheckCircle2 : Info
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={clsx(
        'flex items-start gap-2.5 rounded-sm border px-3.5 py-2.5 text-sm',
        tone === 'error' && 'border-seal-500/60 bg-seal-700/20 text-seal-400',
        tone === 'ok' && 'border-emerald-600/50 bg-emerald-900/20 text-emerald-300',
        tone === 'info' && 'border-gold-600/50 bg-gold-500/10 text-gold-200',
        className,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input {...props} type={show ? 'text' : 'password'} className={clsx('input pr-11', props.className)} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-parch-300/60 hover:text-gold-300"
        aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

/** Tiêu đề phần có hoa văn hai bên. */
export function SectionTitle({ kicker, title, sub }: { kicker?: string; title: string; sub?: string }) {
  return (
    <div className="mb-10 text-center">
      {kicker && <p className="mb-2 font-serif text-xs uppercase tracking-[0.35em] text-seal-400">{kicker}</p>}
      <h2 className="section-title">
        <span className="title-gold text-3xl sm:text-4xl">{title}</span>
      </h2>
      {sub && <p className="mx-auto mt-3 max-w-2xl text-sm text-parch-200/70">{sub}</p>}
    </div>
  )
}

/** Dải tiêu đề đầu trang con. */
export function PageBanner({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="page-banner border-b border-gold-700/40">
      <div className="mx-auto max-w-6xl px-4 pb-10 pt-12 text-center sm:pb-12 sm:pt-16">
        <h1 className="title-gold text-3xl sm:text-5xl">{title}</h1>
        {sub && <p className="mx-auto mt-3 max-w-2xl text-sm text-parch-200/80 sm:text-base">{sub}</p>}
      </div>
    </div>
  )
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="frame w-full max-w-md animate-rise p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 className="title-gold text-xl">{title}</h3>
          <button onClick={onClose} className="text-parch-300/60 hover:text-gold-300" aria-label="Đóng">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- thông báo nhanh

type Toast = { id: number; tone: 'ok' | 'error' | 'info'; text: string }
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([])
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random()
    setList((l) => [...l, { id, tone, text }])
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 4500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
        {list.map((t) => (
          <Alert key={t.id} tone={t.tone} className="pointer-events-auto w-full max-w-md animate-rise bg-ink-900/95 shadow-frame">
            {t.text}
          </Alert>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Đã có lỗi xảy ra'
}
