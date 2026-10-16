-- Máy chủ chạy trên máy dev. Admin sửa/thêm máy chủ thật qua web Admin.
INSERT INTO game_servers (id, name, region, status, is_new, host, port, ws_url, sort_order)
VALUES (1, 'Tống Kim 01', 'north', 'normal', true, '127.0.0.1', 7777, 'ws://127.0.0.1:7778', 1);
