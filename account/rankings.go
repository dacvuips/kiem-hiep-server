package main

import (
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Bảng xếp hạng của 1 máy chủ: cao thủ (cấp cao nhất) và phú hộ (nhiều tiền nhất) toàn máy chủ + trong từng môn phái.
// Tiền = tiền mang theo (gold) + tiền trong rương (storage_gold) của PlayerProfile. Cùng cấp thì ai nhiều kinh nghiệm hơn đứng trên.
// Kết quả giữ trong bộ nhớ rankingTTL cho mỗi máy chủ — người chơi mở bảng liên tục không quét bảng characters mỗi lần.
const (
	rankingTTL       = 60 * time.Second
	rankingTopServer = 100 // số người mỗi bảng toàn máy chủ
	rankingTopSect   = 10  // số người mỗi bảng môn phái
)

type rankingEntry struct {
	Rank     int    `json:"rank"`
	Name     string `json:"name"`
	Level    int    `json:"level"`
	SectID   string `json:"sect_id"`
	Gender   int    `json:"gender"`
	Money    int64  `json:"money"`
	PkPoints int    `json:"pk_points,omitempty"`
}

type rankingBoard struct {
	ServerID   int                       `json:"server_id"`
	UpdatedAt  time.Time                 `json:"updated_at"`
	Level      []rankingEntry            `json:"level"`
	Money      []rankingEntry            `json:"money"`
	PK         []rankingEntry            `json:"pk"`
	SectLevel  map[string][]rankingEntry `json:"sect_level"`
	SectMoney  map[string][]rankingEntry `json:"sect_money"`
	TTLSeconds int                       `json:"ttl_seconds"`
}

var rankingCache = struct {
	sync.Mutex
	boards map[int]*rankingBoard
}{boards: map[int]*rankingBoard{}}

// Số trong JSON nhân vật; giá trị không phải số (dữ liệu hỏng) tính 0 thay vì làm lỗi cả câu truy vấn.
const rankingCTE = `WITH c AS (
	SELECT id, name, sect_id, gender, level,
		CASE WHEN jsonb_typeof(data->'exp') = 'number' THEN (data->>'exp')::numeric ELSE 0 END AS exp,
		(CASE WHEN jsonb_typeof(data->'gold') = 'number' THEN (data->>'gold')::numeric ELSE 0 END
		 + CASE WHEN jsonb_typeof(data->'storage_gold') = 'number' THEN (data->>'storage_gold')::numeric ELSE 0 END)::bigint AS money,
		CASE WHEN jsonb_typeof(data->'pk_points') = 'number' THEN (data->>'pk_points')::bigint ELSE 0 END AS pk_points
	FROM characters WHERE server_id = $1 AND deleted_at IS NULL
)`

const rankingQuery = rankingCTE + `
SELECT 'level', '', name, sect_id, gender, level, money, rn FROM (
	SELECT *, ROW_NUMBER() OVER (ORDER BY level DESC, exp DESC, id) AS rn FROM c) t WHERE rn <= $2
UNION ALL
SELECT 'money', '', name, sect_id, gender, level, money, rn FROM (
	SELECT *, ROW_NUMBER() OVER (ORDER BY money DESC, level DESC, id) AS rn FROM c WHERE money > 0) t WHERE rn <= $2
UNION ALL
SELECT 'pk', '', name, sect_id, gender, level, pk_points, rn FROM (
	SELECT *, ROW_NUMBER() OVER (ORDER BY pk_points DESC, level DESC, id) AS rn FROM c WHERE pk_points > 0) t WHERE rn <= $2
UNION ALL
SELECT 'sect_level', sect_id, name, sect_id, gender, level, money, rn FROM (
	SELECT *, ROW_NUMBER() OVER (PARTITION BY sect_id ORDER BY level DESC, exp DESC, id) AS rn FROM c WHERE sect_id <> '') t WHERE rn <= $3
UNION ALL
SELECT 'sect_money', sect_id, name, sect_id, gender, level, money, rn FROM (
	SELECT *, ROW_NUMBER() OVER (PARTITION BY sect_id ORDER BY money DESC, level DESC, id) AS rn FROM c WHERE sect_id <> '' AND money > 0) t WHERE rn <= $3
ORDER BY 1, 2, 8`

// GET /v1/rankings?server_id=N
func (s *server) handleRankings(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAccount(r); err != nil {
		return err
	}
	serverID, err := strconv.Atoi(r.URL.Query().Get("server_id"))
	if err != nil || serverID <= 0 {
		return errBadRequest
	}
	rankingCache.Lock()
	defer rankingCache.Unlock() // 1 truy vấn / máy chủ / TTL, người hỏi cùng lúc chờ chung kết quả
	if b := rankingCache.boards[serverID]; b != nil && time.Since(b.UpdatedAt) < rankingTTL {
		return writeJSON(w, http.StatusOK, b)
	}
	rows, err := s.db.Query(r.Context(), rankingQuery, serverID, rankingTopServer, rankingTopSect)
	if err != nil {
		return err
	}
	defer rows.Close()
	b := &rankingBoard{ServerID: serverID, UpdatedAt: time.Now(), Level: []rankingEntry{}, Money: []rankingEntry{},
		PK: []rankingEntry{}, SectLevel: map[string][]rankingEntry{}, SectMoney: map[string][]rankingEntry{}, TTLSeconds: int(rankingTTL.Seconds())}
	for rows.Next() {
		var board, sect string
		var e rankingEntry
		var rank int64
		if err := rows.Scan(&board, &sect, &e.Name, &e.SectID, &e.Gender, &e.Level, &e.Money, &rank); err != nil {
			return err
		}
		e.Rank = int(rank)
		switch board {
		case "level":
			b.Level = append(b.Level, e)
		case "money":
			b.Money = append(b.Money, e)
		case "pk":
			e.PkPoints = int(e.Money)
			b.PK = append(b.PK, e)
		case "sect_level":
			b.SectLevel[sect] = append(b.SectLevel[sect], e)
		case "sect_money":
			b.SectMoney[sect] = append(b.SectMoney[sect], e)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	rankingCache.boards[serverID] = b
	return writeJSON(w, http.StatusOK, b)
}
