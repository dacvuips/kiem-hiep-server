-- Đăng nhập Google qua trình duyệt hệ thống (chạy được PC / mobile / web, không cần plugin).
-- Game gọi /start -> mở trình duyệt -> Google chuyển về /callback (server đổi code lấy ID token, xác minh)
-- -> game hỏi /poll bằng poll_secret (chỉ game biết) để nhận phiên đăng nhập. Không lưu token nào ở bảng này.
CREATE TABLE oauth_logins (
    state           TEXT        PRIMARY KEY,
    poll_hash       BYTEA       NOT NULL,                 -- HMAC(poll_secret)
    code_verifier   TEXT        NOT NULL,                 -- PKCE
    nonce           TEXT        NOT NULL,
    link_account_id BIGINT      REFERENCES accounts(id) ON DELETE CASCADE,  -- khác NULL = liên kết vào tài khoản đang đăng nhập
    account_id      BIGINT      REFERENCES accounts(id) ON DELETE CASCADE,  -- kết quả sau callback
    error_code      TEXT        NOT NULL DEFAULT '',
    created_ip      TEXT        NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    completed_at    TIMESTAMPTZ
);
CREATE INDEX oauth_logins_expires_idx ON oauth_logins (expires_at);
