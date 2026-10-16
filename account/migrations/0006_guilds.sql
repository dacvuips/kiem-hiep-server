-- Bang hội (dùng chung cho mọi thành viên) theo máy chủ. data = dữ liệu bang của game (GuildService: thành viên, quỹ, nhật ký...).
CREATE TABLE guilds (
    server_id  INT         NOT NULL REFERENCES game_servers(id),
    name       TEXT        NOT NULL,
    data       JSONB       NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (server_id, name)
);
