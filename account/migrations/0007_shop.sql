-- Nạp thẻ (trang web người chơi): ví Xu theo tài khoản, đơn nạp, sổ cái ví, quà chờ giao vào nhân vật, cài đặt tỉ lệ.

-- Ví Xu của tài khoản. Số dư không bao giờ âm.
CREATE TABLE wallets (
    account_id      BIGINT      PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    xu              BIGINT      NOT NULL DEFAULT 0 CHECK (xu >= 0),
    total_topup_vnd BIGINT      NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sổ cái ví: mọi lần cộng / trừ Xu (chỉ thêm, không sửa).
CREATE TABLE wallet_ledger (
    id            BIGSERIAL   PRIMARY KEY,
    account_id    BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    delta         BIGINT      NOT NULL,
    balance_after BIGINT      NOT NULL,
    kind          TEXT        NOT NULL,            -- topup | transfer | admin
    ref           TEXT        NOT NULL DEFAULT '', -- mã đơn / mã nhân vật
    note          TEXT        NOT NULL DEFAULT '',
    admin_id      BIGINT      REFERENCES admins(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX wallet_ledger_account_idx ON wallet_ledger (account_id, created_at DESC);

-- Đơn nạp. Mã đơn ngẫu nhiên (không đoán được). Trạng thái: pending -> paid | cancelled | failed.
CREATE TABLE topup_orders (
    id           BIGSERIAL   PRIMARY KEY,
    code         TEXT        NOT NULL UNIQUE,
    account_id   BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    amount_vnd   BIGINT      NOT NULL CHECK (amount_vnd > 0),
    xu           BIGINT      NOT NULL CHECK (xu > 0),
    provider     TEXT        NOT NULL,
    status       TEXT        NOT NULL DEFAULT 'pending',
    provider_ref TEXT        NOT NULL DEFAULT '',
    note         TEXT        NOT NULL DEFAULT '',
    ip           TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at      TIMESTAMPTZ
);
CREATE INDEX topup_orders_account_idx ON topup_orders (account_id, created_at DESC);
CREATE INDEX topup_orders_status_idx ON topup_orders (status, created_at DESC);

-- Quà chờ giao vào nhân vật (đổi Xu -> Nguyên bảo). Game server cộng khi nhân vật vào map / đang online,
-- và chỉ đánh dấu 'applied' trong CÙNG lần lưu nhân vật có số Nguyên bảo đó (không mất, không cộng 2 lần).
CREATE TABLE character_grants (
    id           BIGSERIAL   PRIMARY KEY,
    character_id BIGINT      NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    account_id   BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    jade         BIGINT      NOT NULL CHECK (jade > 0),
    xu           BIGINT      NOT NULL DEFAULT 0,
    status       TEXT        NOT NULL DEFAULT 'pending',   -- pending | applied
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_at   TIMESTAMPTZ
);
CREATE INDEX character_grants_pending_idx ON character_grants (character_id) WHERE status = 'pending';
CREATE INDEX character_grants_account_idx ON character_grants (account_id, created_at DESC);

-- Cài đặt cửa hàng (Admin sửa được): tỉ lệ quy đổi.
CREATE TABLE shop_settings (
    key        TEXT        PRIMARY KEY,
    value      BIGINT      NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO shop_settings(key, value) VALUES ('xu_per_10k', 100), ('jade_per_xu', 1);
