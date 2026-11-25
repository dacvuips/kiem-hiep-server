-- Đổi ID nhân vật CŨ (số tự tăng nhỏ) sang 9 chữ số ngẫu nhiên không trùng, giống nhân vật mới (0014).
-- Mọi chỗ lưu ID nhân vật được đổi theo trong cùng transaction:
--   characters.id (+ data.id), character_grants.character_id (FK, ON UPDATE CASCADE),
--   market_listings.data.sid (người bán), admin_audit (target_id / detail.character_id của mục nhân vật).
-- Bang hội lưu thành viên theo tên -> không cần đổi. Cache Redis game:char:<id> cũ tự hết hạn (30 phút),
-- không đụng ID mới vì ID mới >= 100000000.
-- SAU KHI CHẠY: khởi động lại game server (đang giữ character_id trong RAM); người chơi đang online phải vào lại.

CREATE TEMP TABLE character_id_map (old_id BIGINT PRIMARY KEY, new_id BIGINT NOT NULL UNIQUE) ON COMMIT DROP;

DO $$
DECLARE
    r RECORD;
    v BIGINT;
BEGIN
    FOR r IN SELECT id FROM characters WHERE id < 100000000 ORDER BY id LOOP
        LOOP
            v := 100000000 + floor(random() * 900000000)::BIGINT;
            EXIT WHEN NOT EXISTS (SELECT 1 FROM characters WHERE id = v)
                  AND NOT EXISTS (SELECT 1 FROM character_id_map WHERE new_id = v);
        END LOOP;
        INSERT INTO character_id_map(old_id, new_id) VALUES (r.id, v);
    END LOOP;
END
$$;

-- Quà chờ nhận đi theo nhân vật: cho FK tự đổi theo khi characters.id đổi.
ALTER TABLE character_grants DROP CONSTRAINT character_grants_character_id_fkey;
ALTER TABLE character_grants ADD CONSTRAINT character_grants_character_id_fkey
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE characters c
SET id = m.new_id,
    data = jsonb_set(c.data, '{id}', to_jsonb(m.new_id))
FROM character_id_map m
WHERE c.id = m.old_id;

UPDATE market_listings l
SET data = jsonb_set(l.data, '{sid}', to_jsonb(m.new_id))
FROM character_id_map m
WHERE jsonb_typeof(l.data->'sid') = 'number' AND (l.data->>'sid')::BIGINT = m.old_id;

UPDATE admin_audit a
SET target_id = m.new_id::TEXT
FROM character_id_map m
WHERE a.target_type = 'character' AND a.target_id = m.old_id::TEXT;

UPDATE admin_audit a
SET detail = jsonb_set(a.detail, '{character_id}', to_jsonb(m.new_id))
FROM character_id_map m
WHERE jsonb_typeof(a.detail->'character_id') = 'number' AND (a.detail->>'character_id')::BIGINT = m.old_id;
