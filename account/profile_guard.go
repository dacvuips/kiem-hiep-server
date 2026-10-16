package main

import (
	"encoding/json"
	"time"
)

// guardClientSave: luật cho dữ liệu nhân vật do GAME gửi thẳng qua HTTP (lúc ở ngoài map — Hub, chọn nhân vật).
// Trong map thì game server lưu (ProfileGuard trong Godot). Ở đây không có công thức game nên dùng BẤT BIẾN:
//   - cấp, kinh nghiệm, tên, môn phái, giới tính, cờ server_seen: giữ bản đã lưu;
//   - tiền (lượng + tiền rương) không tăng; nguyên bảo không tăng;
//   - đồ: chỉ món đã có (theo uid), chỉ số giữ bản đã lưu, chỉ nhận vị trí / khoá / giá; bỏ món lạ / trùng uid — trừ THUỐC mới mua ở
//     Hiệu thuốc (mã trong potion_prices.json): nhận nếu tiền đã trừ đủ tổng giá (cùng bất biến tiền), không thì bỏ hết thuốc mới;
//   - tổng (4 chỉ số + điểm tiềm năng) không tăng; tổng (cấp các skill + điểm kỹ năng) không tăng;
//   - phe Tống / Kim: chỉ chọn được 1 lần khi chưa có phe và cấp đã lưu >= 50.
//
// Nhân vật chưa vào map lần nào (server_seen = 0) thì không chặn: lần vào map đầu game server tự khởi tạo lại phần kinh tế.
var ownerItemFields = []string{"rx", "ry", "rb", "lock", "unlock_at", "price"}

func guardClientSave(oldRaw json.RawMessage, incoming map[string]any) map[string]any {
	var old map[string]any
	if err := json.Unmarshal(oldRaw, &old); err != nil || old == nil {
		return incoming
	}
	if num(old["server_seen"]) == 0 {
		return incoming
	}
	for _, k := range []string{"level", "exp", "name", "sect_id", "sect_name", "element", "gender", "server_seen", "starter_kit", "lead_level", "lead_exp", "guild", "guild_join_after", "camp", "security_hash", "security_locked"} {
		if v, ok := old[k]; ok {
			incoming[k] = v
		}
	}
	// Đã bỏ phe Tống / Kim cố định của nhân vật (phe chỉ chọn trong trận Chiến trường Tống Kim).
	delete(incoming, "nation")
	// Hảo hữu + điểm PK + điểm tích lũy Tống Kim chỉ game server đổi: bản cũ chưa có thì game cũng không được tự thêm.
	// test_attribs = chỉ số cộng thêm của nút TEST (bản debug): chỉ lưu được khi bật DEV_TRUST_CLIENT_SAVES.
	clientPoints := num(incoming["songjin_points"])   // điểm Tống Kim game gửi — chỉ nhận khi mua thuốc Tống Kim (bên dưới)
	for _, k := range []string{"friends", "pk_value", "songjin_points", "test_attribs"} {
		if v, ok := old[k]; ok {
			incoming[k] = v
		} else {
			delete(incoming, k)
		}
	}
	// Tiền + mở thêm rương (giá StorageService: 500000 x số thứ tự rương)
	oldTotal := num(old["gold"]) + num(old["storage_gold"])
	oldExtra, newExtra := num(old["storage_extra"]), num(incoming["storage_extra"])
	if newExtra < oldExtra || newExtra > 5 {
		newExtra = oldExtra
	}
	cost := 0.0
	for k := oldExtra; k < newExtra; k++ {
		cost += 500000 * (k + 1)
	}
	// Thuốc mới mua ở Hiệu thuốc: cộng giá vào khoản đã tiêu (uid của bản đã lưu).
	oldUids := map[string]map[string]any{}
	for _, it := range asList(old["inventory"]) {
		if m, ok := it.(map[string]any); ok {
			if uid, _ := m["uid"].(string); uid != "" {
				oldUids[uid] = m
			}
		}
	}
	for _, it := range asList(old["storage"]) {
		if m, ok := it.(map[string]any); ok {
			if uid, _ := m["uid"].(string); uid != "" {
				oldUids[uid] = m
			}
		}
	}
	pointsCost := 0.0
	for _, it := range asList(incoming["inventory"]) {
		if g, p, ok := newPotionPrice(it, oldUids); ok {
			cost += g
			pointsCost += p
		}
	}
	acceptPotions := true
	if g, b := num(incoming["gold"]), num(incoming["storage_gold"]); g < 0 || b < 0 || g+b > oldTotal-cost {
		incoming["gold"], incoming["storage_gold"] = old["gold"], old["storage_gold"]
		newExtra = oldExtra
		acceptPotions = false
	}
	// Thuốc Tống Kim trả bằng điểm: game phải trừ đủ điểm; nhận thì lưu đúng điểm cũ - giá (không để game tự tăng).
	if pointsCost > 0 {
		if oldPoints := num(old["songjin_points"]); acceptPotions && clientPoints >= 0 && clientPoints <= oldPoints-pointsCost {
			incoming["songjin_points"] = oldPoints - pointsCost
		} else if acceptPotions {
			acceptPotions = false   // bỏ mọi thuốc mới -> hoàn cả tiền lượng đã trừ cho chúng
			incoming["gold"], incoming["storage_gold"] = old["gold"], old["storage_gold"]
			newExtra = oldExtra
		}
	}
	incoming["storage_extra"] = newExtra
	if j := num(incoming["jade"]); j < 0 || j > num(old["jade"]) {
		incoming["jade"] = old["jade"]
	}
	// Điểm
	stats := []string{"strength", "dexterity", "vitality", "energy", "potential_points"}
	if sumOf(incoming, stats) > sumOf(old, stats) || anyNegative(incoming, stats) {
		for _, k := range stats {
			incoming[k] = old[k]
		}
	}
	if skillTotal(incoming) > skillTotal(old) {
		incoming["skill_levels"], incoming["skill_points"] = old["skill_levels"], old["skill_points"]
	}
	// Đồ
	known := map[string]map[string]any{}
	collect := func(it any) {
		if m, ok := it.(map[string]any); ok {
			if uid, _ := m["uid"].(string); uid != "" {
				known[uid] = m
			}
		}
	}
	for _, it := range asList(old["inventory"]) {
		collect(it)
	}
	for _, it := range asList(old["storage"]) {
		collect(it)
	}
	if eq, ok := old["equipment"].(map[string]any); ok {
		for _, it := range eq {
			collect(it)
		}
	}
	seen := map[string]bool{}
	fix := func(it any) map[string]any {
		m, ok := it.(map[string]any)
		if !ok {
			return nil
		}
		uid, _ := m["uid"].(string)
		base, okKnown := known[uid]
		if uid == "" || !okKnown || seen[uid] {
			return nil
		}
		seen[uid] = true
		out := map[string]any{}
		for k, v := range base {
			out[k] = v
		}
		for _, k := range ownerItemFields {
			if v, ok := m[k]; ok {
				out[k] = v
			}
		}
		guardLock(base, out)
		return out
	}
	for _, key := range []string{"inventory", "storage"} {
		list := []any{}
		for _, it := range asList(incoming[key]) {
			if v := fix(it); v != nil {
				list = append(list, v)
			} else if key == "inventory" && acceptPotions {
				if _, _, ok := newPotionPrice(it, known); ok {
					m := it.(map[string]any)
					if uid, _ := m["uid"].(string); !seen[uid] {
						seen[uid] = true
						list = append(list, cleanPotion(m))
					}
				}
			}
		}
		incoming[key] = list
	}
	newEq := map[string]any{}
	if eq, ok := incoming["equipment"].(map[string]any); ok {
		for k, it := range eq {
			if v := fix(it); v != nil {
				newEq[k] = v
			}
		}
	}
	incoming["equipment"] = newEq
	return incoming
}

func num(v any) float64 {
	if f, ok := v.(float64); ok {
		return f
	}
	return 0
}

func sumOf(m map[string]any, keys []string) float64 {
	t := 0.0
	for _, k := range keys {
		t += num(m[k])
	}
	return t
}

func anyNegative(m map[string]any, keys []string) bool {
	for _, k := range keys {
		if num(m[k]) < 0 {
			return true
		}
	}
	return false
}

func skillTotal(m map[string]any) float64 {
	t := num(m["skill_points"])
	if num(m["skill_points"]) < 0 {
		return 1e18
	}
	if sk, ok := m["skill_levels"].(map[string]any); ok {
		for _, v := range sk {
			if num(v) < 0 {
				return 1e18
			}
			t += num(v)
		}
	}
	return t
}

func asList(v any) []any {
	if l, ok := v.([]any); ok {
		return l
	}
	return nil
}

// guardLock: khoá món đồ — khoá được ngay; mở khoá phải chờ 3 ngày; khoá vĩnh viễn / gắn nhân vật không đổi (giống ProfileGuard Godot).
func guardLock(base, out map[string]any) {
	const (
		lockNormal, lockLocked, lockUnlocking = 0.0, -1.0, 1.0
		unlockSeconds                         = 259200.0
	)
	sLock, sAt := num(base["lock"]), num(base["unlock_at"])
	cLock, cAt := num(out["lock"]), num(out["unlock_at"])
	now := float64(time.Now().Unix())
	ok := false
	switch sLock {
	case lockNormal:
		ok = cLock == lockNormal || cLock == lockLocked
	case lockLocked:
		ok = cLock == lockLocked || (cLock == lockUnlocking && cAt >= now+unlockSeconds-600)
	case lockUnlocking:
		if cLock == lockUnlocking {
			out["unlock_at"] = base["unlock_at"]
			ok = true
		} else {
			ok = cLock == lockLocked || (cLock == lockNormal && now >= sAt)
		}
	}
	if !ok {
		out["lock"], out["unlock_at"] = base["lock"], base["unlock_at"]
	}
}
