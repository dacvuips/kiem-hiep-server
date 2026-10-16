package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"math/big"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Mật khẩu: argon2id(HMAC(PASSWORD_PEPPER, mật khẩu), salt ngẫu nhiên 16 byte).
// Tham số theo khuyến nghị OWASP (19 MiB, 2 vòng, 1 luồng): đủ chậm để chống dò, đủ nhẹ để 1 máy xử lý hàng trăm lượt/giây.
// Đổi tham số ở đây thì mật khẩu cũ vẫn kiểm tra được (tham số nằm trong chuỗi băm) và được băm lại ở lần đăng nhập sau.
const (
	argonTime    = 2
	argonMemory  = 19 * 1024
	argonThreads = 1
	argonKeyLen  = 32
	argonSaltLen = 16
)

var argonParams = fmt.Sprintf("m=%d,t=%d,p=%d", argonMemory, argonTime, argonThreads)

func (k *keyring) hashPassword(pw string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey(k.peppered(pw), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=19$%s$%s$%s", argonParams, b64.EncodeToString(salt), b64.EncodeToString(key)), nil
}

// checkPassword so mật khẩu với chuỗi băm (so sánh thời gian hằng). needRehash = true khi chuỗi băm dùng tham số cũ.
func (k *keyring) checkPassword(pw, encoded string) (ok, needRehash bool) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, false
	}
	var m, t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
		return false, false
	}
	b64 := base64.RawStdEncoding
	salt, err1 := b64.DecodeString(parts[4])
	want, err2 := b64.DecodeString(parts[5])
	if err1 != nil || err2 != nil {
		return false, false
	}
	got := argon2.IDKey(k.peppered(pw), salt, t, m, p, uint32(len(want)))
	ok = subtle.ConstantTimeCompare(got, want) == 1
	return ok, ok && parts[3] != argonParams
}

// burnPasswordCheck tốn đúng thời gian 1 lần kiểm tra mật khẩu — dùng khi tài khoản không tồn tại,
// để thời gian trả lời giống hệt tài khoản có thật (chống dò tên tài khoản qua thời gian).
func (k *keyring) burnPasswordCheck(pw string) {
	argon2.IDKey(k.peppered(pw), make([]byte, argonSaltLen), argonTime, argonMemory, argonThreads, argonKeyLen)
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func randomDigits(n int) (string, error) {
	var sb strings.Builder
	for i := 0; i < n; i++ {
		d, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", err
		}
		sb.WriteByte(byte('0' + d.Int64()))
	}
	return sb.String(), nil
}
