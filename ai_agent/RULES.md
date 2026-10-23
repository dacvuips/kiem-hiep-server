# QUY TẮC & PHÂN QUYỀN TRUY CẬP CỦA AI CODING BOT

Hệ thống cho phép bạn tùy chỉnh chi tiết:
1. **Thư mục được phép ĐỌC (Lấy thông tin)**: Bot chỉ có thể xem code trong các thư mục này.
2. **Thư mục được phép GHI (Sửa / Viết code)**: Bot chỉ có thể tạo hoặc sửa đổi file trong các thư mục này.
3. **Thư mục & File BỊ CẤM TUYỆT ĐỐI**: Kể cả nằm bên trong thư mục được phép, bot cũng KHÔNG ĐƯỢC PHÉP chạm vào.

---

## 1. Cấu hình trong file `rules.json`

```json
{
  "allowed_read_paths": [
    "D:\\game\\lam-game\\kiem-hiep-server",
    "D:\\game\\lam-game\\kiem-hiep"
  ],
  "allowed_write_paths": [
    "D:\\game\\lam-game\\kiem-hiep-server\\portal-web",
    "D:\\game\\lam-game\\kiem-hiep-server\\admin-web",
    "D:\\game\\lam-game\\kiem-hiep-server\\account",
    "D:\\game\\lam-game\\kiem-hiep"
  ],
  "forbidden_paths": [
    ".env",
    ".env.production",
    ".git",
    "deploy\\secrets",
    "github_actions_deploy",
    "id_rsa",
    "id_ed25519"
  ],
  "forbidden_commands": [
    "drop database",
    "drop table",
    "truncate",
    "format ",
    "rmdir /s /q c:",
    "git reset --hard",
    "git push -f",
    "git push --force"
  ]
}
```

---

## 2. Cách bạn tùy biến giới hạn:

- **Ví dụ 1: Bạn chỉ muốn Bot sửa Web Portal (`portal-web`) mà KHÔNG được sửa Backend (`account`)**:
  - Trong `"allowed_write_paths"`, bạn chỉ giữ lại:
    ```json
    "allowed_write_paths": [
      "D:\\game\\lam-game\\kiem-hiep-server\\portal-web"
    ]
    ```
  - Khi đó, nếu ai đó yêu cầu bot sửa code trong `account/` hay `admin-web/`, bot sẽ bị chặn ngay lập tức và báo lỗi: `"Đường dẫn nằm ngoài danh sách thư mục được phép GHI / SỬA ĐỔI!"`.

- **Ví dụ 2: Bạn chỉ muốn Bot đọc/sửa trong Client Game (`kiem-hiep`)**:
  - Bạn chỉ cần đặt đường dẫn `D:\\game\\lam-game\\kiem-hiep` vào danh sách.

- **Ví dụ 3: Bạn muốn chặn hoàn toàn 1 thư mục nhạy cảm**:
  - Chỉ cần thêm tên thư mục đó vào danh sách `"forbidden_paths"`, ví dụ `"deploy\\secrets"` hoặc `"backup"`. Bot sẽ không thể đọc cũng như không thể ghi vào đó.
