import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { CreditCard, Download, Globe, KeyRound, LockKeyhole, Monitor, ScrollText, Shield, Smartphone, Swords, UserPlus, Users } from 'lucide-react'
import { SectionTitle } from '../components/ui'
import { ELEMENTS, SECTS, type Element } from '../lib/sects'
import { useAuth } from '../lib/auth'

function Hero() {
  const { status } = useAuth()
  return (
    <section className="hero-bg relative -mt-16 flex min-h-[88vh] items-center overflow-hidden pt-16">
      {/* Nhân vật hai bên (chỉ màn rộng) */}
      <img src="/img/char-kim_nam.webp" alt="" aria-hidden className="pointer-events-none absolute bottom-0 left-[-9%] hidden h-[62%] max-h-[540px] opacity-80 drop-shadow-[0_0_30px_rgba(0,0,0,0.9)] xl:block" />
      <img src="/img/char-thuy_nu.webp" alt="" aria-hidden className="pointer-events-none absolute bottom-0 right-[-2%] hidden h-[60%] max-h-[520px] opacity-80 drop-shadow-[0_0_30px_rgba(0,0,0,0.9)] xl:block" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_45%_50%_at_50%_45%,rgba(13,9,7,0.75),transparent)]" />
      <div className="relative mx-auto w-full max-w-4xl px-4 py-20 text-center">
        <p className="animate-rise font-serif text-xs uppercase tracking-[0.5em] text-gold-300/90 sm:text-sm">Giang hồ hiểm ác — anh hùng xuất thiếu niên</p>
        <div className="mt-5 flex justify-center animate-rise [animation-delay:80ms]">
          <img src="/img/logo.png" alt="Kiếm Hiệp — JX1 Idle Origin" className="h-28 w-auto max-w-[85%] object-contain drop-shadow-[0_10px_25px_rgba(0,0,0,0.8)] sm:h-36 md:h-44" />
        </div>
        <div className="mx-auto mt-4 flex max-w-md animate-rise items-center gap-3 [animation-delay:140ms]">
          <span className="divider-gold" />
          <span className="seal-stamp h-8 w-8 shrink-0 text-sm">Võ</span>
          <span className="divider-gold" />
        </div>
        <p className="mt-4 animate-rise font-serif text-lg text-parch-100 [animation-delay:200ms] sm:text-2xl">Võ lâm truyền kỳ — kiếm hiệp 2D</p>
        <p className="mx-auto mt-3 max-w-xl animate-rise text-sm text-parch-200/80 [animation-delay:260ms] sm:text-base">
          Bái nhập một trong Thập Đại Môn Phái, luyện tuyệt học ngũ hành, lập bang kết nghĩa và tranh hùng khắp Trung Nguyên.
        </p>
        <div className="mt-9 flex animate-rise flex-wrap items-center justify-center gap-3 [animation-delay:320ms] sm:gap-4">
          <a href="#tai-game" className="btn-gold btn-lg min-w-[150px]">
            <Download className="h-5 w-5" aria-hidden /> Tải game
          </a>
          <Link to="/nap-the" className="btn-seal btn-lg min-w-[150px]">
            <CreditCard className="h-5 w-5" aria-hidden /> Nạp thẻ
          </Link>
          {status !== 'in' && (
            <Link to="/dang-ky" className="btn-ghost btn-lg min-w-[150px]">
              <UserPlus className="h-5 w-5" aria-hidden /> Đăng ký
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}

const QUICK = [
  { to: '/dang-ky', label: 'Đăng ký tài khoản', sub: 'Tạo tài khoản miễn phí', icon: UserPlus },
  { to: '/nap-the', label: 'Nạp thẻ', sub: 'Nạp Xu, đổi Nguyên bảo', icon: CreditCard },
  { to: '/tai-khoan?tab=mat-khau', label: 'Đổi mật khẩu', sub: 'Bảo vệ tài khoản', icon: LockKeyhole },
  { to: '/quen-mat-khau', label: 'Quên mật khẩu', sub: 'Lấy lại qua email', icon: KeyRound },
]

function QuickActions() {
  return (
    <section className="relative z-10 mx-auto -mt-14 max-w-6xl px-4">
      <div className="frame grid grid-cols-2 divide-gold-700/40 lg:grid-cols-4 lg:divide-x">
        {QUICK.map((q, i) => (
          <Link
            key={q.to}
            to={q.to}
            className={clsx(
              'group flex flex-col items-center gap-2 px-3 py-5 text-center transition hover:bg-gold-500/5 sm:flex-row sm:gap-4 sm:px-6 sm:text-left',
              i < 2 && 'border-b border-gold-700/40 lg:border-b-0',
              i % 2 === 0 && 'border-r border-gold-700/40 lg:border-r-0',
            )}
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-gold-500/60 bg-gradient-to-b from-ink-700 to-ink-900 text-gold-300 shadow-glow transition group-hover:scale-105 group-hover:text-gold-200">
              <q.icon className="h-5 w-5" aria-hidden />
            </span>
            <span>
              <span className="block font-serif text-[15px] font-semibold text-gold-200 group-hover:text-gold-100">{q.label}</span>
              <span className="mt-0.5 hidden text-xs text-parch-300/60 sm:block">{q.sub}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

const ORDER: Element[] = ['kim', 'moc', 'thuy', 'hoa', 'tho']

function Sects() {
  return (
    <section id="mon-phai" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:py-24">
      <SectionTitle kicker="Môn phái" title="Thập Đại Môn Phái" sub="Mười môn phái chia theo ngũ hành Kim – Mộc – Thủy – Hỏa – Thổ. Ngũ hành tương sinh tương khắc quyết định thắng bại trên giang hồ." />
      <div className="mb-10 flex flex-wrap items-center justify-center gap-3 sm:gap-6">
        {ORDER.map((e) => (
          <div key={e} className="flex items-center gap-2">
            <img src={`/img/el-${e}.webp`} alt="" aria-hidden className="h-9 w-9" />
            <span className={clsx('font-serif text-sm font-semibold', ELEMENTS[e].color)}>Hệ {ELEMENTS[e].label}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {SECTS.map((s) => (
          <article key={s.id} className="frame group flex flex-col overflow-hidden transition duration-300 hover:-translate-y-1 hover:border-gold-400">
            <div className={clsx('relative h-56 overflow-hidden bg-gradient-to-t to-transparent', ELEMENTS[s.element].ring)}>
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_80%,rgba(217,178,100,0.18),transparent_65%)]" />
              <img
                src={s.image}
                alt={`Nhân vật môn phái ${s.name}`}
                loading="lazy"
                className="absolute bottom-0 left-1/2 h-[96%] max-w-none -translate-x-1/2 object-contain drop-shadow-[0_6px_10px_rgba(0,0,0,0.8)] transition duration-500 group-hover:scale-105"
              />
              <img src={`/img/el-${s.element}.webp`} alt={`Hệ ${ELEMENTS[s.element].label}`} title={`Hệ ${ELEMENTS[s.element].label}`} className="absolute right-2 top-2 h-10 w-10" />
              <span className="absolute left-2 top-2 rounded-sm border border-gold-700/60 bg-ink-950/80 px-1.5 py-0.5 text-[11px] text-parch-200/80">{s.alignment}</span>
              <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink-900 to-transparent" />
            </div>
            <div className="flex flex-1 flex-col px-4 pb-5 pt-1">
              <h3 className="title-gold text-xl">{s.name}</h3>
              <p className={clsx('mt-0.5 text-xs font-semibold uppercase tracking-wider', ELEMENTS[s.element].color)}>Ngũ hành: {ELEMENTS[s.element].label}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-parch-200/75">{s.desc}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

const FEATURES = [
  { icon: Swords, title: 'Chiến đấu thời gian thực', text: 'Chiêu thức phái môn, khinh công, combo liên hoàn — luyện tay là thắng.' },
  { icon: Users, title: 'Tổ đội & bang hội', text: 'Kết bằng hữu, lập bang phái, cùng nhau vượt ải và tranh đoạt lãnh địa.' },
  { icon: Shield, title: 'Tài khoản an toàn', text: 'Mật khẩu mã hoá chuẩn mới, lấy lại mật khẩu qua email, lịch sử đăng nhập minh bạch.' },
]

function Features() {
  return (
    <section className="border-y border-gold-700/30 bg-ink-900/40">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 md:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="flex gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm border border-seal-500/60 bg-seal-700/20 text-seal-400">
              <f.icon className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <h3 className="font-serif text-lg font-semibold text-gold-200">{f.title}</h3>
              <p className="mt-1 text-sm text-parch-200/70">{f.text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

interface PlatformInfo {
  icon: typeof Monitor
  name: string
  req: string[]
  action?: string
  href?: string
  qrHref?: string
}

const PLATFORMS: PlatformInfo[] = [
  { icon: Monitor, name: 'PC (Windows)', req: ['Windows 10/11 64-bit', 'CPU 2 nhân, RAM 4 GB', 'Card đồ hoạ hỗ trợ OpenGL 3.3', 'Dung lượng trống 2 GB'], action: 'Sắp ra mắt' },
  { icon: Smartphone, name: 'Android', req: ['Android 8.0 trở lên', 'RAM 3 GB trở lên', 'Dung lượng trống 1,5 GB', 'Kết nối Wi‑Fi hoặc 4G'], action: 'Tải APK Launcher (35 MB)', href: 'https://kiem-hiep-api.viettheo.site/download/kiem-hiep-launcher.apk', qrHref: 'https://kiem-hiep-api.viettheo.site/download/' },
  { icon: Globe, name: 'Chơi trên web', req: ['Chrome, Edge, Firefox bản mới', 'Hỗ trợ WebGL 2', 'RAM 4 GB trở lên', 'Không cần cài đặt'], action: 'Sắp ra mắt' },
]

function DownloadSection() {
  return (
    <section id="tai-game" className="download-bg scroll-mt-16 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4">
        <SectionTitle kicker="Tải game" title="Hướng Dẫn Tải Game" sub="Kiếm Hiệp sẽ có mặt trên PC, Android và trình duyệt. Dùng chung một tài khoản trên mọi nền tảng." />
        <div className="grid gap-6 md:grid-cols-3">
          {PLATFORMS.map((p) => (
            <div key={p.name} className="frame flex flex-col p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-gold-500/60 bg-ink-800 text-gold-300 shadow-glow">
                  <p.icon className="h-6 w-6" aria-hidden />
                </span>
                <h3 className="title-gold text-xl">{p.name}</h3>
              </div>
              <h4 className="mt-5 text-xs font-semibold uppercase tracking-wider text-parch-300/60">Cấu hình đề nghị</h4>
              <ul className="mt-2 flex-1 space-y-1.5 text-sm text-parch-200/80">
                {p.req.map((r) => (
                  <li key={r} className="flex gap-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rotate-45 bg-gold-400" aria-hidden />
                    {r}
                  </li>
                ))}
              </ul>
              {p.href ? (
                <div className="mt-6 flex flex-col gap-2">
                  <a href={p.href} download="kiem-hiep-launcher.apk" className="btn-gold flex w-full items-center justify-center gap-2 py-2.5 font-bold shadow-glow">
                    <Download className="h-4 w-4" aria-hidden /> {p.action}
                  </a>
                  {p.qrHref && (
                    <a href={p.qrHref} className="text-center text-xs text-gold-400/90 underline-offset-4 hover:underline">
                      📱 Quét mã QR cài đặt nhanh
                    </a>
                  )}
                </div>
              ) : (
                <button className="btn-ghost mt-6 w-full" disabled>
                  <Download className="h-4 w-4" aria-hidden /> {p.action || 'Sắp ra mắt'}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="parchment mx-auto mt-12 max-w-3xl p-6 sm:p-8">
          <h3 className="flex items-center gap-2 font-serif text-xl font-bold text-parch-900">
            <ScrollText className="h-5 w-5 text-seal-600" aria-hidden /> Các bước bắt đầu
          </h3>
          <ol className="mt-4 space-y-3 text-sm text-parch-800">
            {[
              <>
                <Link to="/dang-ky" className="font-semibold text-seal-600 underline-offset-2 hover:underline">Đăng ký tài khoản</Link> miễn phí trên trang này.
              </>,
              <>Tải bản cài đặt phù hợp với thiết bị (đang chuẩn bị phát hành).</>,
              <>Mở game, đăng nhập bằng tài khoản vừa tạo, chọn máy chủ và tạo nhân vật.</>,
              <>
                Muốn có Nguyên bảo? <Link to="/nap-the" className="font-semibold text-seal-600 underline-offset-2 hover:underline">Nạp thẻ</Link> vào ví Xu rồi đổi sang nhân vật.
              </>,
            ].map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-seal-600 font-serif text-xs font-bold text-parch-50">{i + 1}</span>
                <span className="pt-0.5">{t}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

export default function Home() {
  return (
    <>
      <Hero />
      <QuickActions />
      <Sects />
      <Features />
      <DownloadSection />
    </>
  )
}
