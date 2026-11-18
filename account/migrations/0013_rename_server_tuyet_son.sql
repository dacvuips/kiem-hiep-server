-- Đổi tên server tongkim / Tống Kim / Server Đồ Xanh thành Tuyết Sơn
UPDATE game_servers
SET name = 'Tuyết Sơn'
WHERE id = 1
   OR name ILIKE '%tong%kim%'
   OR name ILIKE '%tống kim%'
   OR name ILIKE '%đồ xanh%';
