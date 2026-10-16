-- Chợ Giao Thương theo máy chủ: mỗi món đang treo / đã bán chờ người bán nhận tiền là 1 dòng.
-- id do game server sinh; data = listing của game (MarketBook: người bán, món đồ, giá, loại tiền, hạn, trạng thái).
CREATE TABLE market_listings (
    server_id  INT         NOT NULL REFERENCES game_servers(id),
    id         TEXT        NOT NULL,
    data       JSONB       NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (server_id, id)
);
