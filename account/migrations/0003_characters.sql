-- Nhân vật theo tài khoản + máy chủ (tối đa 4 ô / tài khoản / máy chủ). Tên không trùng trong 1 máy chủ.
CREATE TABLE characters (
    id          BIGSERIAL PRIMARY KEY,
    account_id  BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    server_id   INT         NOT NULL REFERENCES game_servers(id),
    slot        SMALLINT    NOT NULL CHECK (slot BETWEEN 0 AND 3),
    name        TEXT        NOT NULL,
    name_key    TEXT        NOT NULL,                  -- tên chuẩn hóa (NFC, chữ thường) để chặn trùng
    gender      SMALLINT    NOT NULL DEFAULT 0,
    sect_id     TEXT        NOT NULL DEFAULT '',
    level       INT         NOT NULL DEFAULT 1,
    data        JSONB       NOT NULL DEFAULT '{}',     -- toàn bộ PlayerProfile.to_dict()
    version     INT         NOT NULL DEFAULT 1,        -- tăng mỗi lần lưu, chống 2 máy ghi đè lẫn nhau
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX characters_name_uniq ON characters (server_id, name_key) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX characters_slot_uniq ON characters (account_id, server_id, slot) WHERE deleted_at IS NULL;
CREATE INDEX characters_account_idx ON characters (account_id, server_id) WHERE deleted_at IS NULL;
