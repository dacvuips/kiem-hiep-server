-- Admin: 2FA (TOTP, khóa mã hóa AES-GCM), thu hồi phiên theo "epoch", đổi mật khẩu.
ALTER TABLE admins
    ADD COLUMN totp_enabled        BOOLEAN     NOT NULL DEFAULT false,
    ADD COLUMN totp_last_step      BIGINT      NOT NULL DEFAULT 0,      -- chặn dùng lại cùng 1 mã
    ADD COLUMN session_epoch       INT         NOT NULL DEFAULT 1,      -- tăng = mọi phiên cũ hết hiệu lực
    ADD COLUMN password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN must_change_password BOOLEAN    NOT NULL DEFAULT true,
    ADD COLUMN last_login_ip       TEXT        NOT NULL DEFAULT '';

-- totp_secret (từ 0001) giờ lưu bản MÃ HÓA (base64 nonce||ciphertext).
COMMENT ON COLUMN admins.totp_secret IS 'AES-GCM(nonce||ciphertext) base64 của khóa TOTP; rỗng = chưa thiết lập';

CREATE INDEX admin_audit_admin_idx ON admin_audit (admin_id, created_at DESC);
CREATE INDEX accounts_username_trgm_idx ON accounts (username text_pattern_ops);
CREATE INDEX login_history_created_idx ON login_history (created_at);
