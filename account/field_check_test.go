package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Hàm băm phải khớp FieldServer.pass_hash ở game: sha256_hex(muối + mật khẩu).
func TestFieldCheckPassword(t *testing.T) {
	sum := sha256.Sum256([]byte("abcd" + "123"))
	fieldStates.Lock()
	fieldStates.m[fieldKey{99, 0}] = fieldState{ServerID: 99, Open: true, received: time.Now(), Rooms: []fieldRoom{
		{ID: "123456", Locked: true, PassSalt: "abcd", PassHash: hex.EncodeToString(sum[:])},
		{ID: "654321"},
	}}
	fieldStates.Unlock()
	defer func() { fieldStates.Lock(); delete(fieldStates.m, fieldKey{99, 0}); fieldStates.Unlock() }()

	s := &server{userRL: newRateLimiter(1000, 1000)}
	check := func(room, pw string) map[string]any {
		body := `{"server_id":99,"room":"` + room + `","password":"` + pw + `"}`
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/v1/field/check", strings.NewReader(body))
		if err := s.fieldCheck(w, r, accountRow{ID: 1}); err != nil {
			t.Fatal(err)
		}
		var out map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return out
	}
	if out := check("123456", "123"); out["ok"] != true {
		t.Fatalf("đúng mật khẩu phải ok: %v", out)
	}
	if out := check("123456", "12"); out["ok"] != false || out["code"] != "bad_password" {
		t.Fatalf("sai mật khẩu phải bad_password: %v", out)
	}
	if out := check("654321", ""); out["ok"] != true {
		t.Fatalf("phòng mở phải ok: %v", out)
	}
	if out := check("111111", ""); out["code"] != "not_found" {
		t.Fatalf("phòng không có phải not_found: %v", out)
	}
}
