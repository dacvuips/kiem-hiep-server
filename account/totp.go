package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// TOTP (RFC 6238): 6 số, chu kỳ 30 giây, HMAC-SHA1 — tương thích Google Authenticator / Microsoft Authenticator / Authy.
const (
	totpPeriod = 30
	totpDigits = 6
	totpIssuer = "Kiem Hiep Admin"
)

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

func newTOTPSecret() (string, error) {
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return b32.EncodeToString(b), nil
}

func totpURL(secret, account string) string {
	label := url.PathEscape(totpIssuer + ":" + account)
	q := url.Values{"secret": {secret}, "issuer": {totpIssuer}, "digits": {"6"}, "period": {"30"}, "algorithm": {"SHA1"}}
	return "otpauth://totp/" + label + "?" + q.Encode()
}

func totpCode(secret string, step int64) (string, error) {
	key, err := b32.DecodeString(strings.ToUpper(secret))
	if err != nil {
		return "", err
	}
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], uint64(step))
	m := hmac.New(sha1.New, key)
	m.Write(msg[:])
	sum := m.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	v := binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", v%1_000_000), nil
}

// verifyTOTP chấp nhận lệch ±1 chu kỳ (đồng hồ điện thoại lệch). Trả về step đã khớp; step phải lớn hơn lastStep
// (mã đã dùng 1 lần thì không dùng lại được, kể cả còn trong 30 giây).
func verifyTOTP(secret, code string, lastStep int64, now time.Time) (int64, bool) {
	code = strings.TrimSpace(code)
	if len(code) != totpDigits {
		return 0, false
	}
	cur := now.Unix() / totpPeriod
	for _, d := range []int64{0, -1, 1} {
		step := cur + d
		if step <= lastStep {
			continue
		}
		want, err := totpCode(secret, step)
		if err == nil && subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 {
			return step, true
		}
	}
	return 0, false
}

// Khóa TOTP lưu trong DB được mã hóa AES-256-GCM bằng khóa dẫn xuất từ TOKEN_HMAC_KEY — lộ DB không lộ khóa 2FA.
func (k *keyring) totpKey() []byte {
	m := hmac.New(sha256.New, k.tokenKey)
	m.Write([]byte("admin-totp-v1"))
	return m.Sum(nil)
}

func (k *keyring) sealSecret(plain string) (string, error) {
	block, err := aes.NewCipher(k.totpKey())
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(plain), nil)), nil
}

func (k *keyring) openSecret(sealed string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(k.totpKey())
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("totp secret hỏng")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	return string(plain), err
}
