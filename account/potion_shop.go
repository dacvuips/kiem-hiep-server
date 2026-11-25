package main

import (
	_ "embed"
	"encoding/json"
	"log"
)

// Hiệu thuốc (PotionShop của game): mua lúc đang ở Hub thì game lưu qua HTTP — guardClientSave chỉ nhận thuốc MỚI nếu mã có trong
// bảng giá này và tiền (lượng) / điểm tích lũy Tống Kim đã trừ đủ. Bảng do tools/export_potion_prices.py sinh từ data/items
// (misc_items.json nguồn "potion" + songjin_potions.json): {"gold": {mã: lượng}, "points": {mã: điểm}}.
//
//go:embed potion_prices.json
var potionPricesJSON []byte

var potionPrices struct {
	Gold   map[string]float64 `json:"gold"`
	Points map[string]float64 `json:"points"`
}

func init() {
	if err := json.Unmarshal(potionPricesJSON, &potionPrices); err != nil {
		log.Fatalf("potion_prices.json: %v", err)
	}
}

// Thuốc mới mua (uid chưa có trong bản đã lưu, mã có trong bảng giá) -> giá lượng, giá điểm Tống Kim; ok=false nếu không phải.
func newPotionPrice(it any, known map[string]map[string]any) (gold, points float64, ok bool) {
	m, isMap := it.(map[string]any)
	if !isMap {
		return 0, 0, false
	}
	uid, _ := m["uid"].(string)
	mid, _ := m["mid"].(string)
	g, isGold := potionPrices.Gold[mid]
	p, isPoints := potionPrices.Points[mid]
	if uid == "" || !(isGold || isPoints) {
		return 0, 0, false
	}
	if _, had := known[uid]; had {
		return 0, 0, false
	}
	return g, p, true
}

// Số bình tối đa 1 chồng thuốc (= ItemDatabase.POTION_STACK của game).
const potionStack = 50

func isPotion(mid any) bool {
	s, _ := mid.(string)
	_, g := potionPrices.Gold[s]
	_, p := potionPrices.Points[s]
	return s != "" && (g || p)
}

// Số bình của 1 chồng thuốc, kẹp 1..potionStack.
func potionCount(m map[string]any) float64 {
	return min(max(num(m["count"]), 1), potionStack)
}

// Tổng số bình mỗi mã thuốc trong túi + rương của 1 bản nhân vật.
func potionTotals(p map[string]any) map[string]float64 {
	out := map[string]float64{}
	for _, key := range []string{"inventory", "storage"} {
		for _, it := range asList(p[key]) {
			if m, ok := it.(map[string]any); ok && isPotion(m["mid"]) {
				out[m["mid"].(string)] += potionCount(m)
			}
		}
	}
	return out
}

// Bản chuẩn của 1 chồng thuốc mới: chỉ mã + số bình + vị trí trong túi do game đặt.
func cleanPotion(m map[string]any) map[string]any {
	out := map[string]any{"dv": 2, "uid": m["uid"], "mid": m["mid"], "count": potionCount(m), "ilv": 0, "base": -1, "gold": -1}
	for _, k := range []string{"rx", "ry", "rb"} {
		if v, ok := m[k]; ok {
			out[k] = v
		}
	}
	return out
}
