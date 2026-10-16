-- Web Admin sửa nhân vật: cờ báo game server đá người chơi ra để nạp lại bản mới; mốc online gần nhất (game server hỏi trạng thái định kỳ).
ALTER TABLE characters ADD COLUMN admin_reload BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE characters ADD COLUMN online_at TIMESTAMPTZ;
