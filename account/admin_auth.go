package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
)

// Đăng nhập web Admin.
//   - Phiên nằm trong cookie HttpOnly + SameSite=Strict (JavaScript không đọc được, trang khác không gửi kèm được),
//     mọi yêu cầu thay đổi dữ liệu còn phải có header X-Admin-Request (chống CSRF).
//   - 2FA (TOTP) BẮT BUỘC: admin chưa bật 2FA chỉ được vào màn thiết lập 2FA (scope "enroll").
//   - Mỗi yêu cầu nạp lại admin từ DB: bị khóa / đổi mật khẩu / bị thu hồi phiên (session_epoch) là mất quyền ngay.
const (
	adminCookie     = "kh_admin"
	adminAudience   = "kiemhiep-admin"
	adminSessionTTL = 8 * time.Hour
	adminCSRFHeader = "X-Admin-Request"
)

// Vai trò và quyền: quyền cần vai trò tối thiểu.
var roleRank = map[string]int{"viewer": 1, "support": 2, "gm": 3, "super": 4}

const (
	permRead         = "read"          // xem mọi trang
	permSupport      = "support"       // đặt lại mật khẩu, đổi email, đăng xuất mọi thiết bị
	permPunish       = "punish"        // khóa / mở khóa / cấm chat, khôi phục nhân vật
	permServers      = "servers.write" // sửa máy chủ
	permManageAdmins = "admins.manage" // tạo / sửa admin
	permShop         = "shop.write"    // duyệt / huỷ đơn nạp, cộng / trừ Xu tay
	permShopSettings = "shop.settings" // đổi tỉ lệ quy đổi
	permCharEdit     = "characters.write" // sửa dữ liệu nhân vật (tên, đồ, hành trang, rương, điểm), tặng đồ, đá khỏi game
	permServerControl = "servers.control" // khởi động lại êm game server (process.go)
	permGameSettings  = "game.settings"   // hệ số kinh nghiệm / rơi đồ / rơi tiền (process.go)
)

var permMinRole = map[string]string{
	permRead: "viewer", permSupport: "support", permPunish: "gm", permServers: "super", permManageAdmins: "super",
	permShop: "gm", permShopSettings: "super", permCharEdit: "super",
	permServerControl: "super", permGameSettings: "super",
}

var (
	errAdminLogin    = newErr(http.StatusUnauthorized, "wrong_login", "Sai tên đăng nhập hoặc mật khẩu")
	errTOTPRequired  = newErr(http.StatusUnauthorized, "totp_required", "Nhập mã 6 số từ ứng dụng xác thực")
	errTOTPWrong     = newErr(http.StatusUnauthorized, "totp_wrong", "Mã xác thực không đúng hoặc đã dùng")
	errAdminDisabled = newErr(http.StatusForbidden, "admin_disabled", "Tài khoản admin đã bị vô hiệu hóa")
	errForbidden     = newErr(http.StatusForbidden, "forbidden", "Bạn không có quyền thực hiện thao tác này")
	errEnrollFirst   = newErr(http.StatusForbidden, "enroll_2fa", "Hãy bật xác thực 2 lớp trước khi tiếp tục")
	errCSRF          = newErr(http.StatusForbidden, "csrf", "Yêu cầu không hợp lệ")
	errReasonNeeded  = newErr(http.StatusBadRequest, "reason_required", "Hãy nhập lý do (ít nhất 5 ký tự)")
	errMustChangePw  = newErr(http.StatusForbidden, "must_change_password", "Hãy đổi mật khẩu tạm trước khi tiếp tục")
)

type adminRow struct {
	ID                 int64      `json:"id"`
	Username           string     `json:"username"`
	DisplayName        string     `json:"display_name"`
	Role               string     `json:"role"`
	Disabled           bool       `json:"disabled"`
	TOTPEnabled        bool       `json:"totp_enabled"`
	MustChangePassword bool       `json:"must_change_password"`
	CreatedAt          time.Time  `json:"created_at"`
	LastLoginAt        *time.Time `json:"last_login_at"`
	LastLoginIP        string     `json:"last_login_ip"`

	passwordHash string
	totpSecret   string
	totpLastStep int64
	epoch        int
}

const adminCols = `id, username, display_name, role, disabled, totp_enabled, must_change_password, created_at, last_login_at,
	last_login_ip, password_hash, totp_secret, totp_last_step, session_epoch`

func scanAdmin(row pgx.Row) (adminRow, error) {
	var a adminRow
	err := row.Scan(&a.ID, &a.Username, &a.DisplayName, &a.Role, &a.Disabled, &a.TOTPEnabled, &a.MustChangePassword,
		&a.CreatedAt, &a.LastLoginAt, &a.LastLoginIP, &a.passwordHash, &a.totpSecret, &a.totpLastStep, &a.epoch)
	return a, err
}

func (a adminRow) can(perm string) bool {
	return roleRank[a.Role] >= roleRank[permMinRole[perm]]
}

// adminCtx: admin đang gọi API + scope phiên ("full" hoặc "enroll").
type adminCtx struct {
	adminRow
	scope string
}

// ---------------------------------------------------------------- phiên

func (s *server) adminToken(a adminRow, scope string) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"iss": s.cfg.JWTIssuer, "aud": adminAudience, "typ": "admin",
		"sub": strconv.FormatInt(a.ID, 10), "ep": a.epoch, "scope": scope,
		"iat": now.Unix(), "nbf": now.Unix(), "exp": now.Add(adminSessionTTL).Unix(),
	}
	t := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	t.Header["kid"] = s.keys.signKID
	return t.SignedString(s.keys.signKey)
}

func (s *server) setAdminCookie(w http.ResponseWriter, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name: adminCookie, Value: token, Path: "/admin/api", MaxAge: maxAge,
		HttpOnly: true, Secure: s.cfg.AdminCookieSecure, SameSite: http.SameSiteStrictMode,
	})
}

// requireAdmin xác thực cookie + CSRF + quyền. perm rỗng = chỉ cần đăng nhập (kể cả scope enroll).
func (s *server) requireAdmin(r *http.Request, perm string) (adminCtx, error) {
	if r.Method != http.MethodGet && r.Header.Get(adminCSRFHeader) != "1" {
		return adminCtx{}, errCSRF
	}
	c, err := r.Cookie(adminCookie)
	if err != nil {
		return adminCtx{}, errUnauthorized
	}
	t, err := jwt.Parse(c.Value, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		if pub, ok := s.keys.verify[kid]; ok {
			return pub, nil
		}
		return nil, errUnauthorized
	}, jwt.WithValidMethods([]string{"EdDSA"}), jwt.WithIssuer(s.cfg.JWTIssuer), jwt.WithAudience(adminAudience),
		jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil {
		return adminCtx{}, errUnauthorized
	}
	claims, _ := t.Claims.(jwt.MapClaims)
	if claims["typ"] != "admin" {
		return adminCtx{}, errUnauthorized
	}
	id, _ := strconv.ParseInt(strFrom(claims["sub"]), 10, 64)
	ep, _ := claims["ep"].(float64)
	scope := strFrom(claims["scope"])
	a, err := scanAdmin(s.db.QueryRow(r.Context(), `SELECT `+adminCols+` FROM admins WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return adminCtx{}, errUnauthorized
	}
	if err != nil {
		return adminCtx{}, err
	}
	if a.Disabled {
		return adminCtx{}, errAdminDisabled
	}
	if int(ep) != a.epoch {
		return adminCtx{}, errUnauthorized
	}
	ac := adminCtx{a, scope}
	if perm == "" {
		return ac, nil
	}
	if scope != "full" || !a.TOTPEnabled {
		return ac, errEnrollFirst
	}
	if a.MustChangePassword {
		return ac, errMustChangePw
	}
	if !a.can(perm) {
		return ac, errForbidden
	}
	return ac, nil
}

func strFrom(v any) string {
	s, _ := v.(string)
	return s
}

// audit ghi nhật ký thao tác (bảng chỉ thêm, không sửa/xóa được).
func (s *server) audit(ctx context.Context, r *http.Request, adminID int64, action, targetType, targetID, reason string, detail map[string]any) {
	if detail == nil {
		detail = map[string]any{}
	}
	d, _ := json.Marshal(detail)
	var aid any = adminID
	if adminID == 0 {
		aid = nil
	}
	if _, err := s.db.Exec(ctx, `INSERT INTO admin_audit(admin_id, action, target_type, target_id, reason, detail, ip)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, aid, action, targetType, targetID, reason, d, clientIP(r, s.cfg.TrustProxy)); err != nil {
		log.Printf("admin_audit: %v", err)
	}
}

func needReason(reason string) (string, error) {
	reason = strings.TrimSpace(reason)
	if len([]rune(reason)) < 5 || len([]rune(reason)) > 500 {
		return "", errReasonNeeded
	}
	return reason, nil
}

// ---------------------------------------------------------------- handlers

func (s *server) handleAdminLogin(w http.ResponseWriter, r *http.Request) error {
	if r.Header.Get(adminCSRFHeader) != "1" {
		return errCSRF
	}
	if err := s.limitIP(r); err != nil {
		return err
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	username := normUsername(req.Username)
	if !s.userRL.allow("admin:" + username) {
		return errRateLimited
	}
	ctx := r.Context()
	a, err := scanAdmin(s.db.QueryRow(ctx, `SELECT `+adminCols+` FROM admins WHERE username=$1`, username))
	if errors.Is(err, pgx.ErrNoRows) {
		s.keys.burnPasswordCheck(req.Password)
		return errAdminLogin
	}
	if err != nil {
		return err
	}
	if ok, _ := s.keys.checkPassword(req.Password, a.passwordHash); !ok {
		s.audit(ctx, r, a.ID, "admin.login_failed", "admin", strconv.FormatInt(a.ID, 10), "", nil)
		return errAdminLogin
	}
	if a.Disabled {
		return errAdminDisabled
	}
	scope := "enroll"
	if a.TOTPEnabled {
		if strings.TrimSpace(req.Code) == "" {
			return errTOTPRequired
		}
		secret, err := s.keys.openSecret(a.totpSecret)
		if err != nil {
			return err
		}
		step, ok := verifyTOTP(secret, req.Code, a.totpLastStep, time.Now())
		if !ok {
			s.audit(ctx, r, a.ID, "admin.totp_failed", "admin", strconv.FormatInt(a.ID, 10), "", nil)
			return errTOTPWrong
		}
		// Chỉ cập nhật khi step mới hơn: 2 yêu cầu cùng 1 mã thì chỉ 1 cái thắng.
		tag, err := s.db.Exec(ctx, `UPDATE admins SET totp_last_step=$2 WHERE id=$1 AND totp_last_step < $2`, a.ID, step)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errTOTPWrong
		}
		scope = "full"
	}
	token, err := s.adminToken(a, scope)
	if err != nil {
		return err
	}
	s.db.Exec(ctx, `UPDATE admins SET last_login_at=now(), last_login_ip=$2 WHERE id=$1`, a.ID, clientIP(r, s.cfg.TrustProxy))
	s.audit(ctx, r, a.ID, "admin.login", "admin", strconv.FormatInt(a.ID, 10), "", map[string]any{"scope": scope})
	s.setAdminCookie(w, token, int(adminSessionTTL.Seconds()))
	return writeJSON(w, http.StatusOK, map[string]any{"admin": a, "scope": scope})
}

func (s *server) handleAdminLogout(w http.ResponseWriter, r *http.Request) error {
	s.setAdminCookie(w, "", -1)
	return writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *server) handleAdminMe(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAdmin(r, "")
	if err != nil {
		return err
	}
	perms := []string{}
	for p := range permMinRole {
		if a.can(p) && a.TOTPEnabled && a.scope == "full" && !a.MustChangePassword {
			perms = append(perms, p)
		}
	}
	return writeJSON(w, http.StatusOK, map[string]any{"admin": a.adminRow, "scope": a.scope, "permissions": perms})
}

// POST /admin/api/2fa/setup — tạo khóa TOTP mới (chưa bật) và trả URL để hiện mã QR.
// Admin đã bật 2FA thì không tự tạo lại được (phải nhờ Super Admin đặt lại) — tránh kẻ chiếm phiên đổi 2FA.
func (s *server) handleAdmin2FASetup(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAdmin(r, "")
	if err != nil {
		return err
	}
	if a.TOTPEnabled {
		return newErr(http.StatusConflict, "totp_already_enabled", "Xác thực 2 lớp đã bật")
	}
	secret, err := newTOTPSecret()
	if err != nil {
		return err
	}
	sealed, err := s.keys.sealSecret(secret)
	if err != nil {
		return err
	}
	if _, err := s.db.Exec(r.Context(), `UPDATE admins SET totp_secret=$2 WHERE id=$1`, a.ID, sealed); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]string{"secret": secret, "otpauth_url": totpURL(secret, a.Username)})
}

// POST /admin/api/2fa/enable {code} — xác nhận mã đầu tiên rồi bật 2FA, đổi phiên sang scope full.
func (s *server) handleAdmin2FAEnable(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAdmin(r, "")
	if err != nil {
		return err
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	if a.TOTPEnabled || a.totpSecret == "" {
		return errBadRequest
	}
	if !s.userRL.allow("admin2fa:" + a.Username) {
		return errRateLimited
	}
	secret, err := s.keys.openSecret(a.totpSecret)
	if err != nil {
		return err
	}
	step, ok := verifyTOTP(secret, req.Code, a.totpLastStep, time.Now())
	if !ok {
		debugTOTP("enable", secret, req.Code, a.totpLastStep) // TẠM — gỡ sau khi tìm ra lỗi 2FA
		return errTOTPWrong
	}
	if _, err := s.db.Exec(r.Context(), `UPDATE admins SET totp_enabled=true, totp_last_step=$2 WHERE id=$1`, a.ID, step); err != nil {
		return err
	}
	a.TOTPEnabled = true
	s.audit(r.Context(), r, a.ID, "admin.2fa_enabled", "admin", strconv.FormatInt(a.ID, 10), "", nil)
	token, err := s.adminToken(a.adminRow, "full")
	if err != nil {
		return err
	}
	s.setAdminCookie(w, token, int(adminSessionTTL.Seconds()))
	return writeJSON(w, http.StatusOK, map[string]any{"admin": a.adminRow, "scope": "full"})
}

// POST /admin/api/me/password {old_password, new_password} — đổi mật khẩu, thu hồi mọi phiên khác.
func (s *server) handleAdminChangePassword(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAdmin(r, "")
	if err != nil {
		return err
	}
	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	if !s.userRL.allow("adminpw:" + a.Username) {
		return errRateLimited
	}
	if ok, _ := s.keys.checkPassword(req.OldPassword, a.passwordHash); !ok {
		return errWrongPassword
	}
	if err := checkAdminPassword(req.NewPassword, a.Username); err != nil {
		return err
	}
	hash, err := s.keys.hashPassword(req.NewPassword)
	if err != nil {
		return err
	}
	if err := s.db.QueryRow(r.Context(), `UPDATE admins SET password_hash=$2, password_changed_at=now(), must_change_password=false,
		session_epoch=session_epoch+1 WHERE id=$1 RETURNING session_epoch`, a.ID, hash).Scan(&a.epoch); err != nil {
		return err
	}
	a.MustChangePassword = false
	s.audit(r.Context(), r, a.ID, "admin.password_changed", "admin", strconv.FormatInt(a.ID, 10), "", nil)
	token, err := s.adminToken(a.adminRow, a.scope)
	if err != nil {
		return err
	}
	s.setAdminCookie(w, token, int(adminSessionTTL.Seconds()))
	return writeJSON(w, http.StatusOK, map[string]any{"admin": a.adminRow})
}

// Mật khẩu admin chặt hơn người chơi: ít nhất 6 ký tự (bắt buộc kèm 2FA).
func checkAdminPassword(p, username string) error {
	if n := len([]rune(p)); n < 6 || n > 128 {
		return newErr(http.StatusBadRequest, "bad_password", "Mật khẩu admin dài 6–128 ký tự")
	}
	if strings.Contains(strings.ToLower(p), username) {
		return errPasswordIsName
	}
	return nil
}
