package main

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"log"
	"strings"
)

// Khóa bí mật của hệ thống — CHỈ đọc từ biến môi trường, không bao giờ nằm trong code, database hay client.
//
//	JWT_PRIVATE_KEY   khóa Ed25519 (32 byte seed, base64) để KÝ access token. Chỉ account server có.
//	JWT_KID           mã của khóa đang ký (ghi vào header "kid" của token).
//	JWT_PUBLIC_KEYS   (tùy chọn) khóa công khai cũ còn được chấp nhận khi đổi khóa: "kid1:base64,kid2:base64".
//	PASSWORD_PEPPER   khóa trộn vào mật khẩu trước khi băm argon2id — lộ database vẫn không dò được mật khẩu.
//	TOKEN_HMAC_KEY    khóa HMAC để băm refresh token / mã OTP lưu trong database.
//
// Game server chỉ cần KHÓA CÔNG KHAI (lấy ở /.well-known/jwks.json) để kiểm tra token, không thể tự ký token.
type keyring struct {
	signKID  string
	signKey  ed25519.PrivateKey
	verify   map[string]ed25519.PublicKey
	pepper   []byte
	tokenKey []byte
}

func loadKeyring() *keyring {
	k := &keyring{verify: map[string]ed25519.PublicKey{}}
	seed := mustSecret("JWT_PRIVATE_KEY", 32)
	if len(seed) != ed25519.SeedSize {
		log.Fatalf("JWT_PRIVATE_KEY phải là đúng %d byte (base64) — tạo bằng: account genkeys", ed25519.SeedSize)
	}
	k.signKey = ed25519.NewKeyFromSeed(seed)
	k.signKID = env("JWT_KID", "")
	if k.signKID == "" {
		log.Fatal("thiếu JWT_KID")
	}
	k.verify[k.signKID] = k.signKey.Public().(ed25519.PublicKey)
	for _, item := range strings.Split(env("JWT_PUBLIC_KEYS", ""), ",") {
		kid, b64, ok := strings.Cut(strings.TrimSpace(item), ":")
		if !ok {
			continue
		}
		pub, err := base64.StdEncoding.DecodeString(b64)
		if err != nil || len(pub) != ed25519.PublicKeySize {
			log.Fatalf("JWT_PUBLIC_KEYS: khóa %q không hợp lệ", kid)
		}
		k.verify[kid] = pub
	}
	k.pepper = mustSecret("PASSWORD_PEPPER", 32)
	k.tokenKey = mustSecret("TOKEN_HMAC_KEY", 32)
	return k
}

// mustSecret đọc khóa base64 từ biến môi trường; thiếu, quá ngắn hoặc còn là giá trị mẫu thì dừng server.
func mustSecret(name string, minLen int) []byte {
	v := env(name, "")
	if v == "" || strings.HasPrefix(v, "DOI_") {
		log.Fatalf("thiếu biến môi trường %s — tạo bằng: account genkeys", name)
	}
	b, err := base64.StdEncoding.DecodeString(v)
	if err != nil || len(b) < minLen {
		log.Fatalf("%s phải là base64 của ít nhất %d byte ngẫu nhiên", name, minLen)
	}
	return b
}

// tokenHash: HMAC-SHA256 của refresh token / mã OTP. Không có TOKEN_HMAC_KEY thì không thể dò ngược mã 6 số từ database.
func (k *keyring) tokenHash(s string) []byte {
	m := hmac.New(sha256.New, k.tokenKey)
	m.Write([]byte(s))
	return m.Sum(nil)
}

// peppered: HMAC(pepper, mật khẩu) — đưa vào argon2id thay cho mật khẩu gốc.
func (k *keyring) peppered(pw string) []byte {
	m := hmac.New(sha256.New, k.pepper)
	m.Write([]byte(pw))
	return m.Sum(nil)
}

type jwk struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	Alg string `json:"alg"`
	Use string `json:"use"`
	Kid string `json:"kid"`
	X   string `json:"x"`
}

// jwks: danh sách khóa công khai cho game server / dịch vụ khác kiểm tra token.
func (k *keyring) jwks() map[string][]jwk {
	keys := []jwk{}
	for kid, pub := range k.verify {
		keys = append(keys, jwk{Kty: "OKP", Crv: "Ed25519", Alg: "EdDSA", Use: "sig", Kid: kid, X: base64.RawURLEncoding.EncodeToString(pub)})
	}
	return map[string][]jwk{"keys": keys}
}

// genKeys in ra bộ khóa mới để dán vào .env (lệnh: account genkeys).
func genKeys() {
	rnd := func(n int) string {
		b := make([]byte, n)
		if _, err := rand.Read(b); err != nil {
			log.Fatal(err)
		}
		return base64.StdEncoding.EncodeToString(b)
	}
	kidBytes := make([]byte, 4)
	rand.Read(kidBytes)
	fmt.Printf("JWT_KID=k%x\n", kidBytes)
	fmt.Printf("JWT_PRIVATE_KEY=%s\n", rnd(ed25519.SeedSize))
	fmt.Printf("PASSWORD_PEPPER=%s\n", rnd(32))
	fmt.Printf("TOKEN_HMAC_KEY=%s\n", rnd(32))
	fmt.Printf("DB_PASSWORD=%s\n", strings.NewReplacer("+", "", "/", "", "=", "").Replace(rnd(24)))
}
