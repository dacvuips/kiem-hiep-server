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

// Bản chuẩn của 1 bình thuốc mới: chỉ mã + vị trí trong túi do game đặt, 1 bình (thuốc không chồng).
func cleanPotion(m map[string]any) map[string]any {
	out := map[string]any{"dv": 2, "uid": m["uid"], "mid": m["mid"], "count": 1, "ilv": 0, "base": -1, "gold": -1}
	for _, k := range []string{"rx", "ry", "rb"} {
		if v, ok := m[k]; ok {
			out[k] = v
		}
	}
	return out
}
