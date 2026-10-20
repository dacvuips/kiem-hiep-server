-- Thêm cột is_gm cho tài khoản để chỉ định tài khoản GM
ALTER TABLE accounts ADD COLUMN is_gm BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX accounts_is_gm_idx ON accounts (is_gm) WHERE is_gm = true;
