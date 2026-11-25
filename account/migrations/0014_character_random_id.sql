-- ID nhân vật mới: 9 chữ số ngẫu nhiên (100000000..999999999), không trùng.
-- Nhân vật cũ được đổi sang 9 số ở migration 0015.
-- Hàm bỏ qua ID đã tồn tại; nếu 2 lệnh tạo cùng lúc trúng cùng 1 số thì khóa chính chặn,
-- createCharacter (characters.go) dùng ON CONFLICT (id) DO NOTHING và thử lại.
CREATE OR REPLACE FUNCTION gen_character_id() RETURNS BIGINT AS $$
DECLARE
    v BIGINT;
BEGIN
    LOOP
        v := 100000000 + floor(random() * 900000000)::BIGINT;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM characters WHERE id = v);
    END LOOP;
    RETURN v;
END
$$ LANGUAGE plpgsql VOLATILE;

ALTER TABLE characters ALTER COLUMN id SET DEFAULT gen_character_id();
