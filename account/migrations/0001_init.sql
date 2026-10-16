-- Tài khoản người chơi, phiên đăng nhập, quên mật khẩu, máy chủ game, admin + nhật ký admin.

CREATE TABLE accounts (
    id              BIGSERIAL PRIMARY KEY,
    username        TEXT        NOT NULL UNIQUE,          -- luôn lưu chữ thường
    email           TEXT        NOT NULL,                 -- KHÔNG unique: tạo tài khoản không xác thực email
    password_hash   TEXT        NOT NULL DEFAULT '',      -- rỗng = tài khoản chỉ đăng nhập Google
    google_sub      TEXT        UNIQUE,
    status          TEXT        NOT NULL DEFAULT 'active', -- active | banned
    banned_until    TIMESTAMPTZ,                          -- NULL + status=banned = khóa vĩnh viễn
    ban_reason      TEXT        NOT NULL DEFAULT '',
    muted_until     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_ip      TEXT        NOT NULL DEFAULT '',
    last_login_at   TIMESTAMPTZ,
    last_login_ip   TEXT        NOT NULL DEFAULT '',
    password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX accounts_email_idx ON accounts (lower(email));
CREATE INDEX accounts_created_idx ON accounts (created_at);

-- Refresh token (Ghi nhớ đăng nhập). Chỉ lưu SHA-256 của token, token gốc nằm ở máy người chơi.
CREATE TABLE sessions (
    id           BIGSERIAL PRIMARY KEY,
    account_id   BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    token_hash   BYTEA       NOT NULL UNIQUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ,
    ip           TEXT        NOT NULL DEFAULT '',
    user_agent   TEXT        NOT NULL DEFAULT ''
);
CREATE INDEX sessions_account_idx ON sessions (account_id);

-- Mã OTP quên mật khẩu (lưu hash). Mỗi tài khoản chỉ 1 mã còn hiệu lực.
CREATE TABLE password_resets (
    account_id  BIGINT      PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    code_hash   BYTEA       NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    attempts    INT         NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Danh sách máy chủ cho màn Chọn máy chủ (thay data/server/servers.json).
CREATE TABLE game_servers (
    id          INT         PRIMARY KEY,
    name        TEXT        NOT NULL,
    region      TEXT        NOT NULL DEFAULT 'north',     -- north | central | south
    status      TEXT        NOT NULL DEFAULT 'normal',    -- normal | crowded | maintenance
    is_new      BOOLEAN     NOT NULL DEFAULT false,
    host        TEXT        NOT NULL DEFAULT '',
    port        INT         NOT NULL DEFAULT 0,
    ws_url      TEXT        NOT NULL DEFAULT '',
    sort_order  INT         NOT NULL DEFAULT 0,
    opened_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin tách hẳn khỏi tài khoản người chơi.
CREATE TABLE admins (
    id             BIGSERIAL PRIMARY KEY,
    username       TEXT        NOT NULL UNIQUE,
    display_name   TEXT        NOT NULL DEFAULT '',
    password_hash  TEXT        NOT NULL,
    role           TEXT        NOT NULL,                  -- super | gm | support | viewer
    totp_secret    TEXT        NOT NULL DEFAULT '',       -- rỗng = chưa bật 2FA
    disabled       BOOLEAN     NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at  TIMESTAMPTZ
);

-- Nhật ký thao tác admin: chỉ thêm, không sửa/xóa.
CREATE TABLE admin_audit (
    id          BIGSERIAL PRIMARY KEY,
    admin_id    BIGINT      REFERENCES admins(id),
    action      TEXT        NOT NULL,
    target_type TEXT        NOT NULL DEFAULT '',
    target_id   TEXT        NOT NULL DEFAULT '',
    reason      TEXT        NOT NULL DEFAULT '',
    detail      JSONB       NOT NULL DEFAULT '{}',
    ip          TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_target_idx ON admin_audit (target_type, target_id);
CREATE INDEX admin_audit_created_idx ON admin_audit (created_at DESC);

CREATE FUNCTION admin_audit_readonly() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'admin_audit chỉ được thêm, không được sửa/xóa';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER admin_audit_no_change BEFORE UPDATE OR DELETE ON admin_audit
    FOR EACH ROW EXECUTE FUNCTION admin_audit_readonly();

-- Lịch sử đăng nhập (cho admin tra cứu IP/thiết bị).
CREATE TABLE login_history (
    id          BIGSERIAL PRIMARY KEY,
    account_id  BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    ok          BOOLEAN     NOT NULL,
    method      TEXT        NOT NULL DEFAULT 'password',  -- password | google | refresh
    ip          TEXT        NOT NULL DEFAULT '',
    user_agent  TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX login_history_account_idx ON login_history (account_id, created_at DESC);
CREATE INDEX login_history_ip_idx ON login_history (ip);
