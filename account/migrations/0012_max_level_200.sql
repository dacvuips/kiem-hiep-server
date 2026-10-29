-- Giới hạn cấp nhân vật tối đa 200
UPDATE characters SET level = 200, data = jsonb_set(data, '{level}', '200') WHERE level > 200;
ALTER TABLE characters ADD CONSTRAINT characters_level_check CHECK (level BETWEEN 1 AND 200);
