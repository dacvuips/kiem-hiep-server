import { Link } from 'react-router-dom'
import { Compass, Mail } from 'lucide-react'
import { PageBanner } from '../components/ui'

export function Terms() {
  const items = [
    ['Tài khoản', 'Mỗi người chơi tự chịu trách nhiệm bảo mật tên đăng nhập, mật khẩu và email của mình. Không chia sẻ mật khẩu cho bất kỳ ai, kể cả người tự xưng là quản trị viên.'],
    ['Hành vi trong game', 'Nghiêm cấm sử dụng phần mềm thứ ba, lợi dụng lỗi, lừa đảo, quấy rối hoặc phát ngôn xúc phạm. Vi phạm có thể bị cấm chat hoặc khoá tài khoản.'],
    ['Nạp thẻ', 'Xu đã nạp và Nguyên bảo đã đổi sang nhân vật không được quy đổi ngược thành tiền. Hãy kiểm tra kỹ nhân vật nhận trước khi xác nhận.'],
    ['Dữ liệu cá nhân', 'Chúng tôi chỉ dùng email để hỗ trợ lấy lại mật khẩu và gửi thông báo quan trọng về tài khoản.'],
    ['Thay đổi điều khoản', 'Điều khoản có thể được cập nhật. Việc tiếp tục sử dụng dịch vụ đồng nghĩa với việc bạn chấp nhận các thay đổi.'],
  ]
  return (
    <>
      <PageBanner title="Điều Khoản Sử Dụng" />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="parchment space-y-5 p-6 sm:p-10">
          {items.map(([t, d], i) => (
            <div key={t}>
              <h2 className="font-serif text-lg font-bold text-parch-900">
                {i + 1}. {t}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-parch-800">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export function Support() {
  const faq = [
    ['Quên mật khẩu thì làm sao?', <>Vào trang <Link className="text-gold-300 hover:underline" to="/quen-mat-khau">Quên mật khẩu</Link>, nhập tên đăng nhập và email đã đăng ký để nhận mã xác nhận.</>],
    ['Đã nạp nhưng chưa thấy Nguyên bảo trong game?', <>Tiền nạp vào <b>ví Xu</b> của tài khoản. Bạn cần vào <Link className="text-gold-300 hover:underline" to="/nap-the#doi-xu">Nạp thẻ → Đổi Xu sang Nguyên bảo</Link> và chọn nhân vật. Nguyên bảo vào nhân vật ở lần vào bản đồ tiếp theo, hoặc khoảng 30 giây nếu đang online.</>],
    ['Có thể đổi email đăng ký không?', <>Hiện cần liên hệ hỗ trợ để đổi email. Hãy chuẩn bị tên đăng nhập và thông tin chứng minh quyền sở hữu tài khoản.</>],
    ['Tôi thấy lần đăng nhập lạ', <>Hãy <Link className="text-gold-300 hover:underline" to="/tai-khoan?tab=mat-khau">đổi mật khẩu</Link> ngay — mọi thiết bị khác sẽ bị đăng xuất.</>],
  ] as const
  return (
    <>
      <PageBanner title="Hỗ Trợ" sub="Giải đáp thắc mắc thường gặp" />
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
        {faq.map(([q, a]) => (
          <details key={q} className="frame group p-5 open:border-gold-400">
            <summary className="cursor-pointer list-none font-serif text-lg text-gold-200 marker:hidden">
              <span className="mr-2 inline-block text-seal-400 transition group-open:rotate-90">›</span>
              {q}
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-parch-200/80">{a}</p>
          </details>
        ))}
        <div className="frame flex items-center gap-3 p-5 text-sm text-parch-200/80">
          <Mail className="h-5 w-5 shrink-0 text-gold-400" aria-hidden />
          Cần hỗ trợ thêm? Hãy liên hệ đội ngũ vận hành qua kênh cộng đồng chính thức của game.
        </div>
      </div>
    </>
  )
}

export function NotFound() {
  return (
    <div className="auth-bg -mt-16 flex min-h-[80vh] items-center justify-center px-4 pt-16">
      <div className="frame max-w-md p-8 text-center">
        <Compass className="mx-auto h-12 w-12 text-gold-400" aria-hidden />
        <h1 className="title-gold mt-3 text-4xl">Lạc đường rồi!</h1>
        <p className="mt-2 text-parch-200/70">Trang bạn tìm không tồn tại hoặc đã bị dời đi nơi khác.</p>
        <Link to="/" className="btn-gold mt-6">
          Về trang chủ
        </Link>
      </div>
    </div>
  )
}
