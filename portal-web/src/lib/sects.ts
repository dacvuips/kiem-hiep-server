// Thập đại môn phái — dữ liệu lấy từ systems/sect/data/*.tres (sect_name, description, alignment) của game.
export type Element = 'kim' | 'moc' | 'thuy' | 'hoa' | 'tho'

export const ELEMENTS: Record<Element, { label: string; color: string; ring: string }> = {
  kim: { label: 'Kim', color: 'text-amber-200', ring: 'from-amber-200/40' },
  moc: { label: 'Mộc', color: 'text-emerald-300', ring: 'from-emerald-400/40' },
  thuy: { label: 'Thủy', color: 'text-sky-300', ring: 'from-sky-400/40' },
  hoa: { label: 'Hỏa', color: 'text-orange-400', ring: 'from-orange-500/40' },
  tho: { label: 'Thổ', color: 'text-yellow-600', ring: 'from-yellow-700/40' },
}

export interface Sect {
  id: string
  name: string
  element: Element
  alignment: 'Chính phái' | 'Tà phái' | 'Trung lập'
  image: string
  desc: string
}

export const SECTS: Sect[] = [
  {
    id: 'thieu_lam',
    name: 'Thiếu Lâm',
    element: 'kim',
    alignment: 'Chính phái',
    image: '/img/char-kim_nam.webp',
    desc: 'Cửa Phật ngàn năm chốn Trung Nguyên, võ học cương mãnh trực diện, tinh thông quyền, côn, đao và nội công thâm hậu.',
  },
  {
    id: 'thien_vuong_bang',
    name: 'Thiên Vương Bang',
    element: 'kim',
    alignment: 'Trung lập',
    image: '/img/char-kim_nam.webp',
    desc: 'Bang hội võ lâm dùng trọng binh khí, sức mạnh áp đảo trực diện, chém xuyên giáp địch.',
  },
  {
    id: 'duong_mon',
    name: 'Đường Môn',
    element: 'moc',
    alignment: 'Trung lập',
    image: '/img/char-moc_nam.webp',
    desc: 'Danh gia ám khí đất Thục, sở trường phi tiêu độc châm, cơ quan thuật và trận pháp cạm bẫy.',
  },
  {
    id: 'ngu_doc_giao',
    name: 'Ngũ Độc Giáo',
    element: 'moc',
    alignment: 'Tà phái',
    image: '/img/char-moc_nu.webp',
    desc: 'Tà giáo luyện độc trùng thảo dược, chiêu thức âm hiểm khó lường, phối hợp đao chưởng với độc tính.',
  },
  {
    id: 'nga_mi',
    name: 'Nga Mi',
    element: 'thuy',
    alignment: 'Chính phái',
    image: '/img/char-thuy_nu.webp',
    desc: 'Ni phái danh tiếng đất Thục, lấy nhu khắc cương, sở trường chỉ pháp, kiếm pháp và hàn khí thấu xương.',
  },
  {
    id: 'thuy_yen_mon',
    name: 'Thúy Yên Môn',
    element: 'thuy',
    alignment: 'Trung lập',
    image: '/img/char-thuy_nu.webp',
    desc: 'Môn phái ẩn dật bên sông nước, luyện hàn khí Băng, khinh công tuyệt đỉnh, song đao liên hoàn uyển chuyển.',
  },
  {
    id: 'cai_bang',
    name: 'Cái Bang',
    element: 'hoa',
    alignment: 'Chính phái',
    image: '/img/char-hoa_nu.webp',
    desc: 'Bang hội lớn nhất võ lâm, đệ tử khắp thiên hạ, sở trường Hàng Long Thập Bát Chưởng và Đả Cẩu Bổng Pháp.',
  },
  {
    id: 'thien_nhan_giao',
    name: 'Thiên Nhẫn Giáo',
    element: 'hoa',
    alignment: 'Tà phái',
    image: '/img/char-hoa_nam.webp',
    desc: 'Tà giáo luyện chân hỏa và tâm ma, chiêu thức tàn bạo, hút máu, hút nội lực và khắc chế đối thủ.',
  },
  {
    id: 'vo_dang',
    name: 'Võ Đang',
    element: 'tho',
    alignment: 'Chính phái',
    image: '/img/char-tho_nam.webp',
    desc: 'Danh môn đạo gia lấy nhu khắc cương, tinh thông kiếm pháp và nội công Thái Cực dẫn động sấm sét.',
  },
  {
    id: 'con_lon',
    name: 'Côn Lôn',
    element: 'tho',
    alignment: 'Trung lập',
    image: '/img/char-tho_nu.webp',
    desc: 'Môn phái ẩn mình trên núi tuyết, vận Lôi khí và Băng khí, kiếm đao pháp lạnh lẽo sắc bén.',
  },
]

export const SECT_NAME: Record<string, string> = Object.fromEntries(SECTS.map((s) => [s.id, s.name]))
export const sectName = (id: string) => SECT_NAME[id] ?? (id ? id : 'Chưa nhập môn')
