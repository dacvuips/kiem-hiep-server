package main

import (
	"encoding/json"
	"testing"
)

// Chồng thuốc lưu từ Hub (guardClientSave): tính tiền theo số bình tăng thêm, gộp chồng không tốn tiền.
func potionSave(gold float64, items ...map[string]any) map[string]any {
	inv := []any{}
	for _, it := range items {
		inv = append(inv, it)
	}
	return map[string]any{"server_seen": 1.0, "gold": gold, "storage_gold": 0.0, "inventory": inv}
}

func pot(uid string, count float64) map[string]any {
	return map[string]any{"uid": uid, "mid": "1_0_0_1", "count": count, "rx": 0.0, "ry": 0.0, "rb": 0.0}
}

func guardPotions(t *testing.T, old, in map[string]any) map[string]any {
	t.Helper()
	raw, _ := json.Marshal(old)
	// Đi qua JSON như HTTP thật (số thành float64).
	b, _ := json.Marshal(in)
	var incoming map[string]any
	_ = json.Unmarshal(b, &incoming)
	return guardClientSave(raw, incoming)
}

func counts(p map[string]any) map[string]float64 {
	out := map[string]float64{}
	for _, it := range asList(p["inventory"]) {
		m := it.(map[string]any)
		out[m["uid"].(string)] = num(m["count"])
	}
	return out
}

func TestPotionStackBuyIntoExisting(t *testing.T) {
	price := potionPrices.Gold["1_0_0_1"]
	old := potionSave(10000, pot("a", 10))
	got := guardPotions(t, old, potionSave(10000-5*price, pot("a", 15)))
	if c := counts(got)["a"]; c != 15 {
		t.Fatalf("mua thêm 5 vào chồng: count = %v, muốn 15", c)
	}
}

func TestPotionStackUnpaidReverts(t *testing.T) {
	old := potionSave(10000, pot("a", 10))
	got := guardPotions(t, old, potionSave(10000, pot("a", 40), pot("b", 50)))
	c := counts(got)
	if c["a"] != 10 || c["b"] != 0 {
		t.Fatalf("không trả tiền mà tăng chồng: %v, muốn a=10, không có b", c)
	}
}

func TestPotionStackMergeAndUseFree(t *testing.T) {
	old := potionSave(10000, pot("a", 30), pot("b", 30))
	// Gộp b vào a (a đầy 50, b còn 10) rồi uống 3 bình.
	got := guardPotions(t, old, potionSave(10000, pot("a", 50), pot("b", 7)))
	c := counts(got)
	if c["a"] != 50 || c["b"] != 7 || num(got["gold"]) != 10000 {
		t.Fatalf("gộp + dùng: %v gold=%v", c, got["gold"])
	}
}

func TestPotionStackNewStackCapped(t *testing.T) {
	price := potionPrices.Gold["1_0_0_1"]
	old := potionSave(100000, pot("a", 1))
	got := guardPotions(t, old, potionSave(100000-50*price, pot("a", 1), pot("n", 999)))
	if c := counts(got)["n"]; c != 50 {
		t.Fatalf("chồng mới vượt 50: count = %v", c)
	}
}
