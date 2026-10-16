-- Thông số game chỉnh từ web Admin (trang Máy chủ › Thông số game): hệ số kinh nghiệm / rơi đồ / rơi tiền của game server online.
-- Chỉ nhận khoá trong danh sách cho phép (process.go: gameSettingDefs) với khoảng giá trị giới hạn; game server đọc qua nhịp tim.
CREATE TABLE game_settings (
    key        TEXT             PRIMARY KEY,
    value      DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ      NOT NULL DEFAULT now()
);
