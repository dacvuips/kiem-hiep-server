// Danh mục dữ liệu game cho trang sửa nhân vật: tên đồ, kích thước ô, môn phái + skill. Sinh bởi tools/export_admin_catalog.gd
// (public/catalog.json) — đổi dữ liệu đồ / skill bên game thì chạy lại công cụ đó.
import { useQuery } from '@tanstack/react-query'

export interface EquipEntry { i: number; n: string; d: number; p: number; l: number; s: number; w: number; h: number }
export interface GoldEntry { i: number; n: string; d: number; p: number; l: number; s: number; m: number; g: number; w: number; h: number }
export interface SkillEntry { id: string; n: string; max: number; req: number }
export interface SectEntry { id: string; n: string; skills: SkillEntry[] }
export interface Catalog {
  equip: EquipEntry[]
  gold: GoldEntry[]
  details: Record<string, string>
  particulars: Record<string, Record<string, string>>
  parts: Record<string, string>
  menpai: string[]
  sects: SectEntry[]
  room: { w: number; h: number; bags: number }
  storage: { w: number; h: number; max_extra: number }
}

export function useCatalog() {
  return useQuery({
    queryKey: ['catalog'],
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch('/admin/catalog.json')   // vite base = /admin/
      if (!res.ok) throw new Error('Không tải được danh mục đồ / skill (catalog.json)')
      return (await res.json()) as Catalog
    },
  })
}

// ---- món đồ (ItemInstance.to_dict của game)

export interface MagicLine { attrib: string; value: number[]; name: string; prefix?: boolean }
export interface Item {
  base: number
  gold: number
  series: number
  base_values: [string, number][]
  magic: MagicLine[]
  expand_magic: MagicLine[]
  durability: number
  seed: number
  luck: number
  rx: number
  ry: number
  rb: number
  lock: number
  unlock_at: number
  price: number
  uid: string
  [k: string]: unknown
}

export const SERIES = ['Kim', 'Mộc', 'Thủy', 'Hỏa', 'Thổ']
export const LOCK_LABEL: Record<number, string> = {
  0: 'Tự do', [-1]: 'Đã khoá', 1: 'Đang mở khoá', [-2]: 'Khoá vĩnh viễn', [-3]: 'Gắn nhân vật',
}
// Ô trang bị theo loại đồ (Equipment.DETAIL_TO_PARTS bên game).
export const DETAIL_TO_PARTS: Record<number, number[]> = {
  0: [3], 1: [3], 2: [1], 3: [7, 8], 4: [6], 5: [4], 6: [2], 7: [0], 8: [5], 9: [9], 10: [10],
}

export function itemEntry(c: Catalog, it: Item): EquipEntry | GoldEntry | undefined {
  return it.gold >= 0 ? c.gold[it.gold] : c.equip[it.base]
}
export function itemName(c: Catalog | undefined, it: Item): string {
  if (!c) return it.gold >= 0 ? `Hoàng kim #${it.gold}` : `Đồ #${it.base}`
  return itemEntry(c, it)?.n ?? (it.gold >= 0 ? `Hoàng kim #${it.gold} (không rõ)` : `Đồ #${it.base} (không rõ)`)
}
export function itemSize(c: Catalog, it: Item): { w: number; h: number } {
  const e = itemEntry(c, it)
  return { w: e?.w || 1, h: e?.h || 1 }
}
export function itemDetail(c: Catalog, it: Item): number {
  return itemEntry(c, it)?.d ?? -1
}

// Xếp món vào chỗ trống đầu tiên (first-fit như ItemContainer.find_free_spot_any). Trả false nếu hết chỗ.
export function placeItem(c: Catalog, items: Item[], it: Item, w: number, h: number, bags: number): boolean {
  const size = itemSize(c, it)
  const blocked = (x: number, y: number, bag: number) =>
    items.some((o) => {
      if (o === it || o.rx < 0 || o.rb !== bag) return false
      const s = itemSize(c, o)
      return x >= o.rx && x < o.rx + s.w && y >= o.ry && y < o.ry + s.h
    })
  for (let bag = 0; bag < bags; bag++) {
    for (let y = 0; y + size.h <= h; y++) {
      for (let x = 0; x + size.w <= w; x++) {
        let free = true
        for (let cy = y; cy < y + size.h && free; cy++) for (let cx = x; cx < x + size.w && free; cx++) if (blocked(cx, cy, bag)) free = false
        if (free) {
          it.rx = x
          it.ry = y
          it.rb = bag
          return true
        }
      }
    }
  }
  return false
}
