package main

import (
	"context"
	"crypto/rand"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// NẠP THẺ (trang web người chơi): tiền nạp vào VÍ XU của tài khoản; người chơi đổi Xu thành Nguyên bảo cho 1 nhân vật
// (quà chờ trong character_grants — game server giao vào nhân vật, xem internal.go).
//
// Cổng thanh toán: interface paymentProvider. Hiện chỉ có cổng GIẢ LẬP (SHOP_SANDBOX=true, chỉ dùng khi phát triển):
// người chơi bấm "Xác nhận thanh toán" trên trang giả lập là đơn thành công. Cổng thật (thẻ cào / chuyển khoản) cắm vào sau:
// tạo đơn -> chuyển người chơi tới trang của cổng -> cổng gọi webhook (kiểm chữ ký) -> markPaid. Mọi lần cộng tiền đi qua
// markPaid (khoá dòng đơn, chỉ pending -> paid 1 lần) nên webhook gọi lặp cũng không cộng 2 lần.

var (
	errBadAmount      = newErr(http.StatusBadRequest, "bad_amount", "Mệnh giá không hợp lệ")
	errNoOrder        = newErr(http.StatusNotFound, "order_not_found", "Không tìm thấy đơn nạp")
	errOrderDone      = newErr(http.StatusConflict, "order_done", "Đơn nạp đã được xử lý")
	errSandboxOff     = newErr(http.StatusForbidden, "sandbox_off", "Cổng thanh toán giả lập đang tắt")
	errNotEnoughXu    = newErr(http.StatusConflict, "not_enough_xu", "Số Xu trong ví không đủ")
	errNoAccount      = newErr(http.StatusNotFound, "account_not_found", "Không tìm thấy tài khoản")
	errTooManyPending = newErr(http.StatusTooManyRequests, "too_many_pending", "Bạn có quá nhiều đơn chưa thanh toán, hãy hoàn tất hoặc huỷ bớt")
)

// Mệnh giá nạp (VNĐ) — như các gói thẻ phổ biến.
var topupPacks = []int64{10000, 20000, 50000, 100000, 200000, 500000, 1000000}

const (
	maxPendingOrders = 5
	maxTransferXu    = 10_000_000
)

type paymentProvider interface {
	Name() string
	// PayURL: trang người chơi được chuyển tới để thanh toán đơn.
	PayURL(order topupOrder) string
}

type sandboxProvider struct{}

func (sandboxProvider) Name() string { return "sandbox" }
func (sandboxProvider) PayURL(o topupOrder) string {
	return "/nap-the/thanh-toan/" + o.Code
}

func (s *server) payment() paymentProvider { return sandboxProvider{} }

type topupOrder struct {
	ID        int64      `json:"id"`
	Code      string     `json:"code"`
	AccountID int64      `json:"account_id"`
	Username  string     `json:"username,omitempty"`
	AmountVND int64      `json:"amount_vnd"`
	Xu        int64      `json:"xu"`
	Provider  string     `json:"provider"`
	Status    string     `json:"status"`
	Note      string     `json:"note"`
	CreatedAt time.Time  `json:"created_at"`
	PaidAt    *time.Time `json:"paid_at"`
}

const orderCols = `o.id, o.code, o.account_id, a.username, o.amount_vnd, o.xu, o.provider, o.status, o.note, o.created_at, o.paid_at`

func scanOrder(row pgx.Row) (topupOrder, error) {
	var o topupOrder
	err := row.Scan(&o.ID, &o.Code, &o.AccountID, &o.Username, &o.AmountVND, &o.Xu, &o.Provider, &o.Status, &o.Note, &o.CreatedAt, &o.PaidAt)
	return o, err
}

// Mã đơn: 12 ký tự chữ hoa + số (bỏ ký tự dễ nhầm), ngẫu nhiên mật mã.
func newOrderCode() (string, error) {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return "NAP" + string(b), nil
}

func (s *server) shopSetting(ctx context.Context, key string, def int64) int64 {
	var v int64
	if err := s.db.QueryRow(ctx, `SELECT value FROM shop_settings WHERE key=$1`, key).Scan(&v); err != nil {
		return def
	}
	return v
}

func (s *server) xuFor(ctx context.Context, vnd int64) int64 {
	return vnd / 10000 * s.shopSetting(ctx, "xu_per_10k", 100)
}

// addXu cộng / trừ Xu trong 1 giao dịch đang mở + ghi sổ cái. Trừ quá số dư -> errNotEnoughXu.
func addXu(ctx context.Context, tx pgx.Tx, accountID, delta int64, kind, ref, note string, adminID int64) (int64, error) {
	if _, err := tx.Exec(ctx, `INSERT INTO wallets(account_id) VALUES ($1) ON CONFLICT DO NOTHING`, accountID); err != nil {
		return 0, err
	}
	var bal int64
	if err := tx.QueryRow(ctx, `SELECT xu FROM wallets WHERE account_id=$1 FOR UPDATE`, accountID).Scan(&bal); err != nil {
		return 0, err
	}
	if bal+delta < 0 {
		return bal, errNotEnoughXu
	}
	bal += delta
	if _, err := tx.Exec(ctx, `UPDATE wallets SET xu=$2, updated_at=now() WHERE account_id=$1`, accountID, bal); err != nil {
		return 0, err
	}
	var aid any = adminID
	if adminID == 0 {
		aid = nil
	}
	_, err := tx.Exec(ctx, `INSERT INTO wallet_ledger(account_id, delta, balance_after, kind, ref, note, admin_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		accountID, delta, bal, kind, ref, note, aid)
	return bal, err
}

// markPaid: đơn pending -> paid đúng 1 lần, cộng Xu vào ví. Gọi từ cổng giả lập, webhook cổng thật, hoặc Admin duyệt tay.
func (s *server) markPaid(ctx context.Context, code, providerRef, note string, adminID int64) (topupOrder, error) {
	var out topupOrder
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		o, err := scanOrder(tx.QueryRow(ctx, `SELECT `+orderCols+` FROM topup_orders o JOIN accounts a ON a.id=o.account_id
			WHERE o.code=$1 FOR UPDATE OF o`, code))
		if errors.Is(err, pgx.ErrNoRows) {
			return errNoOrder
		}
		if err != nil {
			return err
		}
		if o.Status != "pending" {
			return errOrderDone
		}
		if _, err := tx.Exec(ctx, `UPDATE topup_orders SET status='paid', paid_at=now(), provider_ref=$2, note=$3 WHERE id=$1`,
			o.ID, providerRef, note); err != nil {
			return err
		}
		if _, err := addXu(ctx, tx, o.AccountID, o.Xu, "topup", o.Code, "", adminID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE wallets SET total_topup_vnd=total_topup_vnd+$2 WHERE account_id=$1`, o.AccountID, o.AmountVND); err != nil {
			return err
		}
		now := time.Now()
		o.Status, o.PaidAt = "paid", &now
		out = o
		return nil
	})
	return out, err
}

// ---------------------------------------------------------------- người chơi

// GET /v1/shop/config — mệnh giá + tỉ lệ (không cần đăng nhập).
func (s *server) handleShopConfig(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	packs := []map[string]int64{}
	for _, v := range topupPacks {
		packs = append(packs, map[string]int64{"amount_vnd": v, "xu": s.xuFor(ctx, v)})
	}
	return writeJSON(w, http.StatusOK, map[string]any{
		"packs": packs, "xu_per_10k": s.shopSetting(ctx, "xu_per_10k", 100),
		"jade_per_xu": s.shopSetting(ctx, "jade_per_xu", 1), "provider": s.payment().Name(), "sandbox": s.cfg.ShopSandbox,
	})
}

// GET /v1/shop/wallet — số dư + 30 dòng sổ cái gần nhất + 30 đơn gần nhất.
func (s *server) handleShopWallet(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAccount(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	var xu, total int64
	s.db.QueryRow(ctx, `SELECT xu, total_topup_vnd FROM wallets WHERE account_id=$1`, a.ID).Scan(&xu, &total)
	type ledgerRow struct {
		Delta        int64     `json:"delta"`
		BalanceAfter int64     `json:"balance_after"`
		Kind         string    `json:"kind"`
		Ref          string    `json:"ref"`
		Note         string    `json:"note"`
		CreatedAt    time.Time `json:"created_at"`
	}
	ledger := []ledgerRow{}
	rows, err := s.db.Query(ctx, `SELECT delta, balance_after, kind, ref, note, created_at FROM wallet_ledger
		WHERE account_id=$1 ORDER BY id DESC LIMIT 30`, a.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var l ledgerRow
		if err := rows.Scan(&l.Delta, &l.BalanceAfter, &l.Kind, &l.Ref, &l.Note, &l.CreatedAt); err != nil {
			rows.Close()
			return err
		}
		ledger = append(ledger, l)
	}
	rows.Close()
	orders := []topupOrder{}
	rows, err = s.db.Query(ctx, `SELECT `+orderCols+` FROM topup_orders o JOIN accounts a ON a.id=o.account_id
		WHERE o.account_id=$1 ORDER BY o.id DESC LIMIT 30`, a.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			rows.Close()
			return err
		}
		orders = append(orders, o)
	}
	rows.Close()
	return writeJSON(w, http.StatusOK, map[string]any{"xu": xu, "total_topup_vnd": total, "ledger": ledger, "orders": orders})
}

// POST /v1/shop/orders {amount_vnd} — tạo đơn nạp, trả mã đơn + đường thanh toán.
func (s *server) handleShopCreateOrder(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAccount(r)
	if err != nil {
		return err
	}
	if !s.userRL.allow("order:" + a.Username) {
		return errRateLimited
	}
	var req struct {
		AmountVND int64 `json:"amount_vnd"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	ok := false
	for _, v := range topupPacks {
		ok = ok || v == req.AmountVND
	}
	if !ok {
		return errBadAmount
	}
	ctx := r.Context()
	var pending int
	s.db.QueryRow(ctx, `SELECT count(*) FROM topup_orders WHERE account_id=$1 AND status='pending'`, a.ID).Scan(&pending)
	if pending >= maxPendingOrders {
		return errTooManyPending
	}
	code, err := newOrderCode()
	if err != nil {
		return err
	}
	xu := s.xuFor(ctx, req.AmountVND)
	if xu <= 0 {
		return errBadAmount
	}
	p := s.payment()
	o, err := scanOrder(s.db.QueryRow(ctx, `WITH o AS (INSERT INTO topup_orders(code, account_id, amount_vnd, xu, provider, ip)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING *) SELECT `+orderCols+` FROM o JOIN accounts a ON a.id=o.account_id`,
		code, a.ID, req.AmountVND, xu, p.Name(), clientIP(r, s.cfg.TrustProxy)))
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusCreated, map[string]any{"order": o, "pay_url": p.PayURL(o)})
}

// GET /v1/shop/orders/{code} — xem 1 đơn của mình.
func (s *server) handleShopOrder(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAccount(r)
	if err != nil {
		return err
	}
	o, err := scanOrder(s.db.QueryRow(r.Context(), `SELECT `+orderCols+` FROM topup_orders o JOIN accounts a ON a.id=o.account_id
		WHERE o.code=$1 AND o.account_id=$2`, strings.ToUpper(r.PathValue("code")), a.ID))
	if errors.Is(err, pgx.ErrNoRows) {
		return errNoOrder
	}
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"order": o})
}

// POST /v1/shop/orders/{code}/cancel — huỷ đơn chưa thanh toán của mình.
func (s *server) handleShopCancelOrder(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAccount(r)
	if err != nil {
		return err
	}
	tag, err := s.db.Exec(r.Context(), `UPDATE topup_orders SET status='cancelled' WHERE code=$1 AND account_id=$2 AND status='pending'`,
		strings.ToUpper(r.PathValue("code")), a.ID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errOrderDone
	}
	return writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// POST /v1/shop/sandbox/{code}/pay — CỔNG GIẢ LẬP: "thanh toán" đơn của mình. Chỉ bật khi SHOP_SANDBOX=true.
func (s *server) handleShopSandboxPay(w http.ResponseWriter, r *http.Request) error {
	if !s.cfg.ShopSandbox {
		return errSandboxOff
	}
	a, err := s.requireAccount(r)
	if err != nil {
		return err
	}
	code := strings.ToUpper(r.PathValue("code"))
	var owner int64
	if err := s.db.QueryRow(r.Context(), `SELECT account_id FROM topup_orders WHERE code=$1`, code).Scan(&owner); err != nil || owner != a.ID {
		return errNoOrder
	}
	o, err := s.markPaid(r.Context(), code, "sandbox", "Thanh toán giả lập", 0)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"order": o})
}

// POST /v1/shop/transfer {character_id, xu} — đổi Xu thành Nguyên bảo cho 1 nhân vật của mình.
func (s *server) handleShopTransfer(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAccount(r)
	if err != nil {
		return err
	}
	if !s.userRL.allow("transfer:" + a.Username) {
		return errRateLimited
	}
	var req struct {
		CharacterID int64 `json:"character_id"`
		Xu          int64 `json:"xu"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	if req.Xu <= 0 || req.Xu > maxTransferXu {
		return errBadAmount
	}
	ctx := r.Context()
	jade := req.Xu * s.shopSetting(ctx, "jade_per_xu", 1)
	var balance int64
	var name string
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT name FROM characters WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL`,
			req.CharacterID, a.ID).Scan(&name); errors.Is(err, pgx.ErrNoRows) {
			return errNoCharacter
		} else if err != nil {
			return err
		}
		var err error
		balance, err = addXu(ctx, tx, a.ID, -req.Xu, "transfer", strconv.FormatInt(req.CharacterID, 10), "Đổi sang Nguyên bảo cho "+name, 0)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO character_grants(character_id, account_id, jade, xu) VALUES ($1,$2,$3,$4)`,
			req.CharacterID, a.ID, jade, req.Xu)
		return err
	})
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"xu": balance, "jade": jade, "character": name})
}

// GET /v1/account/logins — 20 lần đăng nhập gần nhất của mình.
func (s *server) handleAccountLogins(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAccount(r)
	if err != nil {
		return err
	}
	type row struct {
		OK        bool      `json:"ok"`
		Method    string    `json:"method"`
		IP        string    `json:"ip"`
		UserAgent string    `json:"user_agent"`
		CreatedAt time.Time `json:"created_at"`
	}
	out := []row{}
	rows, err := s.db.Query(r.Context(), `SELECT ok, method, ip, user_agent, created_at FROM login_history
		WHERE account_id=$1 ORDER BY created_at DESC LIMIT 20`, a.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var x row
		if err := rows.Scan(&x.OK, &x.Method, &x.IP, &x.UserAgent, &x.CreatedAt); err != nil {
			return err
		}
		out = append(out, x)
	}
	return writeJSON(w, http.StatusOK, map[string]any{"logins": out})
}

// ---------------------------------------------------------------- Admin

// GET /admin/api/shop/orders?status=&q=&page= — danh sách đơn nạp + tổng doanh thu.
func (s *server) handleAdminOrders(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAdmin(r, permRead); err != nil {
		return err
	}
	page, size, offset := pageParams(r)
	where := []string{"true"}
	args := []any{}
	if st := r.URL.Query().Get("status"); st != "" {
		args = append(args, st)
		where = append(where, "o.status=$"+strconv.Itoa(len(args)))
	}
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		args = append(args, "%"+likeEscape(strings.ToLower(q))+"%")
		n := strconv.Itoa(len(args))
		where = append(where, "(lower(o.code) LIKE $"+n+" OR a.username LIKE $"+n+")")
	}
	cond := strings.Join(where, " AND ")
	ctx := r.Context()
	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM topup_orders o JOIN accounts a ON a.id=o.account_id WHERE `+cond, args...).Scan(&total); err != nil {
		return err
	}
	rows, err := s.db.Query(ctx, `SELECT `+orderCols+` FROM topup_orders o JOIN accounts a ON a.id=o.account_id WHERE `+cond+
		` ORDER BY o.id DESC LIMIT `+strconv.Itoa(size)+` OFFSET `+strconv.Itoa(offset), args...)
	if err != nil {
		return err
	}
	orders := []topupOrder{}
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			rows.Close()
			return err
		}
		orders = append(orders, o)
	}
	rows.Close()
	var revenue, revenueToday, paidCount int64
	s.db.QueryRow(ctx, `SELECT COALESCE(sum(amount_vnd),0), count(*) FROM topup_orders WHERE status='paid'`).Scan(&revenue, &paidCount)
	s.db.QueryRow(ctx, `SELECT COALESCE(sum(amount_vnd),0) FROM topup_orders WHERE status='paid' AND paid_at >= date_trunc('day', now())`).Scan(&revenueToday)
	return writeJSON(w, http.StatusOK, map[string]any{
		"orders": orders, "total": total, "page": page, "size": size,
		"summary": map[string]int64{"revenue_vnd": revenue, "revenue_today_vnd": revenueToday, "paid_orders": paidCount},
	})
}

// POST /admin/api/shop/orders/{code}/{action} {reason} — action: approve (duyệt tay: cộng Xu) | cancel.
func (s *server) handleAdminOrderAction(w http.ResponseWriter, r *http.Request) error {
	ac, err := s.requireAdmin(r, permShop)
	if err != nil {
		return err
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	reason, err := needReason(req.Reason)
	if err != nil {
		return err
	}
	code := strings.ToUpper(r.PathValue("code"))
	ctx := r.Context()
	switch r.PathValue("action") {
	case "approve":
		o, err := s.markPaid(ctx, code, "admin", reason, ac.ID)
		if err != nil {
			return err
		}
		s.audit(ctx, r, ac.ID, "shop.order.approve", "order", code, reason, map[string]any{"account_id": o.AccountID, "amount_vnd": o.AmountVND, "xu": o.Xu})
		return writeJSON(w, http.StatusOK, map[string]any{"order": o})
	case "cancel":
		tag, err := s.db.Exec(ctx, `UPDATE topup_orders SET status='cancelled', note=$2 WHERE code=$1 AND status='pending'`, code, reason)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errOrderDone
		}
		s.audit(ctx, r, ac.ID, "shop.order.cancel", "order", code, reason, nil)
		return writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
	return errBadRequest
}

// GET /admin/api/accounts/{id}/wallet — ví + sổ cái + quà nhân vật của 1 tài khoản.
func (s *server) handleAdminWallet(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAdmin(r, permRead); err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	var xu, total int64
	s.db.QueryRow(ctx, `SELECT xu, total_topup_vnd FROM wallets WHERE account_id=$1`, id).Scan(&xu, &total)
	type ledgerRow struct {
		Delta        int64     `json:"delta"`
		BalanceAfter int64     `json:"balance_after"`
		Kind         string    `json:"kind"`
		Ref          string    `json:"ref"`
		Note         string    `json:"note"`
		AdminID      *int64    `json:"admin_id"`
		CreatedAt    time.Time `json:"created_at"`
	}
	ledger := []ledgerRow{}
	rows, err := s.db.Query(ctx, `SELECT delta, balance_after, kind, ref, note, admin_id, created_at FROM wallet_ledger
		WHERE account_id=$1 ORDER BY id DESC LIMIT 100`, id)
	if err != nil {
		return err
	}
	for rows.Next() {
		var l ledgerRow
		if err := rows.Scan(&l.Delta, &l.BalanceAfter, &l.Kind, &l.Ref, &l.Note, &l.AdminID, &l.CreatedAt); err != nil {
			rows.Close()
			return err
		}
		ledger = append(ledger, l)
	}
	rows.Close()
	type grantRow struct {
		ID          int64      `json:"id"`
		CharacterID int64      `json:"character_id"`
		Character   string     `json:"character"`
		Jade        int64      `json:"jade"`
		Xu          int64      `json:"xu"`
		Status      string     `json:"status"`
		CreatedAt   time.Time  `json:"created_at"`
		AppliedAt   *time.Time `json:"applied_at"`
	}
	grants := []grantRow{}
	rows, err = s.db.Query(ctx, `SELECT g.id, g.character_id, c.name, g.jade, g.xu, g.status, g.created_at, g.applied_at
		FROM character_grants g JOIN characters c ON c.id=g.character_id WHERE g.account_id=$1 ORDER BY g.id DESC LIMIT 50`, id)
	if err != nil {
		return err
	}
	for rows.Next() {
		var g grantRow
		if err := rows.Scan(&g.ID, &g.CharacterID, &g.Character, &g.Jade, &g.Xu, &g.Status, &g.CreatedAt, &g.AppliedAt); err != nil {
			rows.Close()
			return err
		}
		grants = append(grants, g)
	}
	rows.Close()
	return writeJSON(w, http.StatusOK, map[string]any{"xu": xu, "total_topup_vnd": total, "ledger": ledger, "grants": grants})
}

// POST /admin/api/accounts/{id}/wallet {delta, reason} — cộng / trừ Xu tay (đền bù, sửa sai). Ghi nhật ký admin.
func (s *server) handleAdminWalletAdjust(w http.ResponseWriter, r *http.Request) error {
	ac, err := s.requireAdmin(r, permShop)
	if err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var req struct {
		Delta  int64  `json:"delta"`
		Reason string `json:"reason"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	reason, err := needReason(req.Reason)
	if err != nil {
		return err
	}
	if req.Delta == 0 || req.Delta > maxTransferXu || req.Delta < -maxTransferXu {
		return errBadAmount
	}
	ctx := r.Context()
	var bal int64
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT true FROM accounts WHERE id=$1`, id).Scan(&exists); err != nil {
			return errNoAccount
		}
		var err error
		bal, err = addXu(ctx, tx, id, req.Delta, "admin", "", reason, ac.ID)
		return err
	})
	if err != nil {
		return err
	}
	s.audit(ctx, r, ac.ID, "shop.wallet.adjust", "account", strconv.FormatInt(id, 10), reason, map[string]any{"delta": req.Delta, "balance": bal})
	return writeJSON(w, http.StatusOK, map[string]int64{"xu": bal})
}

// GET/PUT /admin/api/shop/settings {xu_per_10k, jade_per_xu}
func (s *server) handleAdminShopSettings(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	if r.Method == http.MethodPut {
		ac, err := s.requireAdmin(r, permShopSettings)
		if err != nil {
			return err
		}
		var req struct {
			XuPer10k  int64  `json:"xu_per_10k"`
			JadePerXu int64  `json:"jade_per_xu"`
			Reason    string `json:"reason"`
		}
		if err := readJSON(r, &req); err != nil {
			return err
		}
		reason, err := needReason(req.Reason)
		if err != nil {
			return err
		}
		if req.XuPer10k < 1 || req.XuPer10k > 100000 || req.JadePerXu < 1 || req.JadePerXu > 1000 {
			return errBadRequest
		}
		for k, v := range map[string]int64{"xu_per_10k": req.XuPer10k, "jade_per_xu": req.JadePerXu} {
			if _, err := s.db.Exec(ctx, `INSERT INTO shop_settings(key, value) VALUES ($1,$2)
				ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, k, v); err != nil {
				return err
			}
		}
		s.audit(ctx, r, ac.ID, "shop.settings", "shop", "", reason, map[string]any{"xu_per_10k": req.XuPer10k, "jade_per_xu": req.JadePerXu})
	} else if _, err := s.requireAdmin(r, permRead); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{
		"xu_per_10k": s.shopSetting(ctx, "xu_per_10k", 100), "jade_per_xu": s.shopSetting(ctx, "jade_per_xu", 1),
		"sandbox": s.cfg.ShopSandbox, "provider": s.payment().Name(),
	})
}
