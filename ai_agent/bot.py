"""
TELEGRAM AI CODING BOT - KIEM HIEP SERVER & CLIENT
Tu dong nhan yeu cau qua Telegram -> Ghi vao Google Sheet -> Chay Agent Gemini sua code -> Chup anh man hinh -> Bao cao ket qua.
"""

import os
import sys
import io
import json
import time
import subprocess
import traceback
import csv
from datetime import datetime
from pathlib import Path
import requests

# Dam bao terminal Windows khong bi loi charmap cp1252 voi tieng Viet
if sys.platform.startswith("win"):
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except Exception:
        pass

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.json"
RULES_PATH = BASE_DIR / "rules.json"
LOG_CSV_PATH = BASE_DIR / "task_history.csv"
SCREENSHOTS_DIR = BASE_DIR / "screenshots"
SCREENSHOTS_DIR.mkdir(exist_ok=True)

# Load configuration
def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

# Load rules
def load_rules():
    with open(RULES_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

CONFIG = load_config()
RULES = load_rules()
CURRENT_KEY_INDEX = 0

def get_current_gemini_key():
    global CURRENT_KEY_INDEX
    keys = CONFIG.get("gemini_api_keys", [])
    if not keys:
        raise ValueError("Khong tim thay Gemini API Key trong config.json")
    return keys[CURRENT_KEY_INDEX % len(keys)]

def rotate_gemini_key():
    global CURRENT_KEY_INDEX
    keys = CONFIG.get("gemini_api_keys", [])
    CURRENT_KEY_INDEX = (CURRENT_KEY_INDEX + 1) % len(keys)
    print(f"🔄 Da chuyen sang Gemini API Key #{CURRENT_KEY_INDEX + 1}")
    return get_current_gemini_key()

# ==================== TELEGRAM API ====================

def send_telegram_message(chat_id, text, parse_mode=None):
    token = CONFIG["telegram_bot_token"]
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    
    if not text:
        return None
        
    MAX_LEN = 3900
    chunks = []
    current_text = str(text)
    
    while len(current_text) > MAX_LEN:
        split_at = current_text.rfind("\n", 0, MAX_LEN)
        if split_at == -1 or split_at < 1500:
            split_at = MAX_LEN
        chunks.append(current_text[:split_at])
        current_text = current_text[split_at:].lstrip()
    if current_text:
        chunks.append(current_text)
        
    last_res = None
    for chunk in chunks:
        payload = {
            "chat_id": chat_id,
            "text": chunk
        }
        if parse_mode:
            payload["parse_mode"] = parse_mode
        try:
            r = requests.post(url, json=payload, timeout=25)
            res = r.json()
            if not res.get("ok"):
                print(f"❌ Telegram API Error: {res}")
                if parse_mode and "can't parse entities" in res.get("description", ""):
                    payload.pop("parse_mode", None)
                    r2 = requests.post(url, json=payload, timeout=25)
                    res = r2.json()
            last_res = res
        except Exception as e:
            print(f"❌ Loi gui tin nhan Telegram: {e}")
            
    return last_res

def send_telegram_photo(chat_id, photo_path, caption=None):
    token = CONFIG["telegram_bot_token"]
    url = f"https://api.telegram.org/bot{token}/sendPhoto"
    data = {"chat_id": chat_id}
    if caption:
        data["caption"] = caption
    try:
        with open(photo_path, "rb") as f:
            r = requests.post(url, data=data, files={"photo": f}, timeout=30)
            return r.json()
    except Exception as e:
        print(f"❌ Loi gui anh Telegram: {e}")
        return None

# ==================== GOOGLE SHEET & LOCAL CSV ====================

def log_task_start(user_name, prompt):
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    row_id = None
    
    # 1. Ghi vao Google Sheet qua Apps Script Webhook neu co
    webhook_url = CONFIG.get("google_sheet_webhook_url", "").strip()
    if webhook_url:
        try:
            payload = {
                "action": "add_task",
                "timestamp": now_str,
                "user": user_name,
                "prompt": prompt,
                "status": "Đang xử lý",
                "details": "",
                "image_url": ""
            }
            res = requests.post(webhook_url, json=payload, timeout=10)
            data = res.json()
            if data.get("status") == "success":
                row_id = data.get("row_id")
        except Exception as e:
            print(f"⚠️ Khong the ket noi Google Apps Script: {e}")
            
    # 2. Luon ghi vao file CSV cuc bo de khong bao gio mat du lieu
    file_exists = LOG_CSV_PATH.exists()
    with open(LOG_CSV_PATH, "a", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        if not file_exists:
            writer.writerow(["Row ID", "Thoi Gian", "Nguoi Yeu Cau", "Noi Dung Yeu Cau", "Trang Thai", "Chi Tiet", "Anh"])
        local_id = int(time.time())
        actual_id = row_id or local_id
        writer.writerow([actual_id, now_str, user_name, prompt, "Đang xử lý", "", ""])
        
    return actual_id

def log_task_finish(row_id, status, details, image_path=""):
    # 1. Update vao Google Sheet qua Apps Script
    webhook_url = CONFIG.get("google_sheet_webhook_url", "").strip()
    if webhook_url and row_id:
        try:
            payload = {
                "action": "update_task",
                "row_id": row_id,
                "status": status,
                "details": details[:1000] if details else "",
                "image_url": str(image_path) if image_path else ""
            }
            requests.post(webhook_url, json=payload, timeout=10)
        except Exception as e:
            print(f"⚠️ Khong the cap nhat Google Sheet: {e}")
            
    # 2. Update CSV cuc bo
    if LOG_CSV_PATH.exists():
        try:
            rows = []
            with open(LOG_CSV_PATH, "r", encoding="utf-8-sig") as f:
                reader = csv.reader(f)
                rows = list(reader)
            for row in rows:
                if len(row) > 0 and str(row[0]) == str(row_id):
                    if len(row) > 4: row[4] = status
                    if len(row) > 5: row[5] = details[:500]
                    if len(row) > 6: row[6] = str(image_path)
            with open(LOG_CSV_PATH, "w", newline="", encoding="utf-8-sig") as f:
                writer = csv.writer(f)
                writer.writerows(rows)
        except Exception as e:
            print(f"⚠️ Loi cap nhat CSV: {e}")

# ==================== GUARDRAILS CHECK ====================

def check_forbidden_path(p):
    p_str = str(p).lower()
    for fb in RULES.get("forbidden_paths", []):
        if fb.lower() in p_str:
            return True, f"File/Thư mục '{fb}' nằm trong danh sách BỊ CẤM truy cập!"
    for pf in RULES.get("protected_files", []):
        if pf.lower() in p.name.lower():
            return True, f"File '{p.name}' là file bảo mật (protected), không được phép thao tác!"
    return False, ""

def is_read_allowed(path_str):
    try:
        p = Path(path_str).resolve()
        is_fb, err = check_forbidden_path(p)
        if is_fb:
            return False, err
            
        allowed_reads = RULES.get("allowed_read_paths", RULES.get("allowed_scopes", []))
        for scope in allowed_reads:
            try:
                p.relative_to(Path(scope).resolve())
                return True, ""
            except ValueError:
                continue
        return False, f"Đường dẫn '{path_str}' nằm ngoài danh sách thư mục được phép ĐỌC!"
    except Exception as e:
        return False, str(e)

def is_write_allowed(path_str):
    try:
        p = Path(path_str).resolve()
        is_fb, err = check_forbidden_path(p)
        if is_fb:
            return False, err
            
        allowed_writes = RULES.get("allowed_write_paths", RULES.get("allowed_scopes", []))
        for scope in allowed_writes:
            try:
                p.relative_to(Path(scope).resolve())
                return True, ""
            except ValueError:
                continue
        return False, f"Đường dẫn '{path_str}' nằm ngoài danh sách thư mục được phép GHI / SỬA ĐỔI!"
    except Exception as e:
        return False, str(e)

def is_command_safe(command_str):
    cmd_lower = command_str.lower().strip()
    for forbidden in RULES.get("forbidden_commands", []):
        if forbidden.lower() in cmd_lower:
            return False, f"Lệnh bị chặn bởi Quy tắc bảo mật (Guardrail): Chứa cụm từ cấm '{forbidden}'!"
    return True, ""

# ==================== AGENT TOOLS ====================

def tool_read_file(path, start_line=1, end_line=500):
    ok, err = is_read_allowed(path)
    if not ok:
        return f"Error: {err}"
    try:
        if not os.path.exists(path):
            return f"Error: File '{path}' khong ton tai."
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        start = max(0, start_line - 1)
        end = min(len(lines), end_line)
        selected = lines[start:end]
        return "".join(f"{i + start + 1}: {line}" for i, line in enumerate(selected))
    except Exception as e:
        return f"Error reading file: {e}"

def tool_write_file(path, content):
    ok, err = is_write_allowed(path)
    if not ok:
        return f"Error: {err}"
    try:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return f"Ghi thanh cong file: {path} ({len(content)} ky tu)"
    except Exception as e:
        return f"Error writing file: {e}"

def tool_edit_file(path, target, replacement):
    ok, err = is_write_allowed(path)
    if not ok:
        return f"Error: {err}"
    try:
        if not os.path.exists(path):
            return f"Error: File '{path}' khong ton tai."
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        if target not in content:
            return f"Error: Target text khong tim thay trong {path}."
        new_content = content.replace(target, replacement, 1)
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)
        return f"Sua thanh cong file: {path}"
    except Exception as e:
        return f"Error editing file: {e}"

def tool_list_dir(path):
    ok, err = is_read_allowed(path)
    if not ok:
        return f"Error: {err}"
    try:
        entries = os.listdir(path)
        result = []
        for e in entries:
            full = os.path.join(path, e)
            tag = "[DIR]" if os.path.isdir(full) else "[FILE]"
            result.append(f"{tag} {e}")
        return "\n".join(result)
    except Exception as e:
        return f"Error listing dir: {e}"

def tool_run_command(command, cwd=None):
    if not cwd:
        cwd = CONFIG["workspace_paths"]["server"]
    ok, err = is_read_allowed(cwd)
    if not ok:
        return f"Error: Working dir {cwd} khong hop le: {err}"
    safe, err_msg = is_command_safe(command)
    if not safe:
        return f"BỊ TỪ CHỐI: {err_msg}"
    try:
        p = subprocess.run(command, shell=True, cwd=cwd, capture_output=True, text=True, timeout=60)
        output = (p.stdout or "") + (p.stderr or "")
        return f"Exit code: {p.returncode}\nOutput:\n{output[:3000]}"
    except subprocess.TimeoutExpired:
        return "Error: Command timed out sau 60s."
    except Exception as e:
        return f"Error running command: {e}"

def tool_capture_screenshot():
    """Chup anh LDPlayer qua ADB hoac chup man hinh"""
    now_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_file = SCREENSHOTS_DIR / f"snap_{now_str}.png"
    adb = CONFIG.get("adb_path", "adb")
    
    # Thu chup qua ADB truoc
    try:
        res = subprocess.run(f'"{adb}" exec-out screencap -p', shell=True, capture_output=True, timeout=10)
        if res.returncode == 0 and len(res.stdout) > 1000:
            with open(out_file, "wb") as f:
                f.write(res.stdout)
            return str(out_file)
    except Exception:
        pass
        
    return ""

# Dinh nghia cac functions cho Gemini
GEMINI_TOOL_DECLARATIONS = [
    {
        "name": "read_file",
        "description": "Doc noi dung file ma nguon kem so thu tu dong",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "path": {"type": "STRING", "description": "Duong dan tuyet doi hoac tuong doi den file"},
                "start_line": {"type": "INTEGER", "description": "Dong bat dau doc (mac dinh 1)"},
                "end_line": {"type": "INTEGER", "description": "Dong ket thuc doc (mac dinh 500)"}
            },
            "required": ["path"]
        }
    },
    {
        "name": "write_file",
        "description": "Ghi de hoac tao moi mot file ma nguon",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "path": {"type": "STRING", "description": "Duong dan file"},
                "content": {"type": "STRING", "description": "Noi dung can ghi"}
            },
            "required": ["path", "content"]
        }
    },
    {
        "name": "edit_file",
        "description": "Thay the mot doan code cu bang doan code moi trong file",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "path": {"type": "STRING", "description": "Duong dan file"},
                "target": {"type": "STRING", "description": "Doan code cu chinh xac can thay"},
                "replacement": {"type": "STRING", "description": "Doan code moi thay the vao"}
            },
            "required": ["path", "target", "replacement"]
        }
    },
    {
        "name": "list_dir",
        "description": "Liet ke danh sach thu muc va file ben trong mot folder",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "path": {"type": "STRING", "description": "Duong dan thu muc can xem"}
            },
            "required": ["path"]
        }
    },
    {
        "name": "run_command",
        "description": "Chay lenh build, test, git hoac kiem tra cu phap (vi du: go build ./..., npm run build, git status)",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "command": {"type": "STRING", "description": "Cau lenh can chay"},
                "cwd": {"type": "STRING", "description": "Thu muc lam viec"}
            },
            "required": ["command"]
        }
    },
    {
        "name": "capture_screenshot",
        "description": "Chup anh man hinh gia lap LDPlayer de lam bang chung kiem thu",
        "parameters": {
            "type": "OBJECT",
            "properties": {}
        }
    }
]

def execute_tool_call(name, args):
    print(f"🔧 Tool Call: {name}({args})")
    if name == "read_file":
        return tool_read_file(args.get("path"), args.get("start_line", 1), args.get("end_line", 500))
    elif name == "write_file":
        return tool_write_file(args.get("path"), args.get("content", ""))
    elif name == "edit_file":
        return tool_edit_file(args.get("path"), args.get("target", ""), args.get("replacement", ""))
    elif name == "list_dir":
        return tool_list_dir(args.get("path"))
    elif name == "run_command":
        return tool_run_command(args.get("command"), args.get("cwd"))
    elif name == "capture_screenshot":
        res = tool_capture_screenshot()
        return f"Screenshot saved at: {res}" if res else "Chua bat gia lap hoac khong the chup man hinh"
    return f"Unknown tool: {name}"

# ==================== GEMINI AGENT EXECUTION ====================

def run_agent_task(prompt, chat_id, progress_callback=None):
    model = CONFIG.get("gemini_model", "gemini-2.5-flash")
    server_dir = CONFIG["workspace_paths"]["server"]
    client_dir = CONFIG["workspace_paths"]["client"]
    
    system_instruction = f"""Ban la Tro ly AI Lap Trinh Vien Chuyen Nghiep cho du an Game Kiem Hiep.
Ban co the doc file, sua code, chay build kiem tra loi, va chup anh man hinh.

QUY TAC TUAN THU BAT BUOC:
1. Chi lam viec trong 2 thu muc:
   - Backend & Web: {server_dir}
   - Game Client & Launcher: {client_dir}
2. TUYET DOI KHONG xoa database, khong DROP table, khong xoa hay in secrets tu file .env.
3. Sau khi sua code, neu sua Go backend hoac web, hay chay `go build ./...` hoac `npm run build` de xac nhan khong bi loi cu phap!
4. Cuoi cung, hay goi `capture_screenshot` neu muon kiem tra ket qua tren giao dien, roi tra loi tong ket ngan gon, ro rang nhung gi ban da thuc hien!
"""

    contents = [
        {"role": "user", "parts": [{"text": f"{system_instruction}\n\nYEU CAU CUA NGUOI DUNG:\n{prompt}"}]}
    ]

    max_steps = 15
    step = 0
    final_text = ""
    latest_screenshot = ""

    while step < max_steps:
        step += 1
        current_key = get_current_gemini_key()
        api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={current_key}"
        
        payload = {
            "contents": contents,
            "tools": [{"functionDeclarations": GEMINI_TOOL_DECLARATIONS}]
        }
        
        try:
            r = requests.post(api_url, json=payload, timeout=60)
            if r.status_code == 429:
                print("⚠️ API Key vuot han muc (429)! Dang xoay key tiep theo...")
                rotate_gemini_key()
                continue
            if r.status_code != 200:
                print(f"❌ Gemini Error {r.status_code}: {r.text}")
                # Thu xoay key neu loi
                rotate_gemini_key()
                continue
                
            res_data = r.json()
            candidates = res_data.get("candidates", [])
            if not candidates:
                final_text = "Khong nhan duoc phan hoi tu Gemini."
                break
                
            candidate = candidates[0]
            content = candidate.get("content", {})
            parts = content.get("parts", [])
            
            # Kiem tra xem co goi Function Call khong
            has_func = False
            for part in parts:
                if "functionCall" in part:
                    has_func = True
                    func_call = part["functionCall"]
                    fn_name = func_call["name"]
                    fn_args = func_call.get("args", {})
                    
                    if progress_callback:
                        progress_callback(f"⚙️ Đang thực hiện: `{fn_name}`...")
                    
                    # Thuc hien tool
                    tool_output = execute_tool_call(fn_name, fn_args)
                    
                    if fn_name == "capture_screenshot" and "Screenshot saved at:" in tool_output:
                        latest_screenshot = tool_output.split("Screenshot saved at: ")[-1].strip()
                        
                    # Dua ket qua vao history
                    contents.append({
                        "role": "model",
                        "parts": [{"functionCall": func_call}]
                    })
                    contents.append({
                        "role": "tool",
                        "parts": [{
                            "functionResponse": {
                                "name": fn_name,
                                "response": {"result": str(tool_output)}
                            }
                        }]
                    })
                    break
                elif "text" in part:
                    final_text = part["text"]

            if not has_func:
                # Da hoan thanh, khong can goi tool nua
                break
                
        except Exception as e:
            traceback.print_exc()
            rotate_gemini_key()
            time.sleep(2)
            
    # Neu chua chup screenshot, thu chup 1 tam cuoi cung
    if not latest_screenshot:
        latest_screenshot = tool_capture_screenshot()
        
    return final_text or "Đã hoàn thành yêu cầu.", latest_screenshot

# ==================== MAIN TELEGRAM BOT POLLING ====================

def run_bot():
    token = CONFIG["telegram_bot_token"]
    allowed_ids = set(CONFIG.get("allowed_telegram_ids", []))
    print(f"🤖 BOT KIẾM HIỆP AI CODING AGENT ĐANG KHỞI CHẠY...")
    print(f"🔑 Telegram Bot Token: {token[:12]}...")
    print(f"👥 Danh sách ID Telegram được phép: {list(allowed_ids)}")
    print(f"📁 Local CSV: {LOG_CSV_PATH}")
    
    offset = 0
    # Xoa bo cac update cu truoc do neu co
    try:
        r = requests.get(f"https://api.telegram.org/bot{token}/getUpdates?offset=-1", timeout=10)
        data = r.json()
        if data.get("result"):
            offset = data["result"][-1]["update_id"] + 1
    except Exception:
        pass

    print("🟢 Bot đã sẵn sàng nhận lệnh từ Telegram!")
    
    while True:
        try:
            url = f"https://api.telegram.org/bot{token}/getUpdates?offset={offset}&timeout=20"
            res = requests.get(url, timeout=30)
            if res.status_code != 200:
                time.sleep(3)
                continue
            data = res.json()
            updates = data.get("result", [])
            for update in updates:
                offset = update["update_id"] + 1
                msg = update.get("message")
                if not msg:
                    continue
                chat_id = msg.get("chat", {}).get("id")
                from_user = msg.get("from", {})
                user_id = from_user.get("id")
                username = from_user.get("username") or from_user.get("first_name") or str(user_id)
                text = msg.get("text", "").strip()
                
                if not text:
                    continue

                print(f"\n📩 Nhận tin nhắn từ [{username} - ID: {user_id}]: {text}")

                # Kiem tra quyen
                if user_id not in allowed_ids:
                    send_telegram_message(chat_id, f"⛔ Bạn (ID: {user_id}) không có quyền ra lệnh cho Bot!\nHãy liên hệ Admin để thêm ID của bạn.")
                    continue

                if text == "/start" or text == "/help":
                    help_msg = (
                        "👋 **Xin chào! Tôi là AI Coding Bot của dự án Kiếm Hiệp.**\n\n"
                        "📌 **Quy trình hoạt động:**\n"
                        "1. Nhận yêu cầu của bạn.\n"
                        "2. Ghi nhận ngay vào Google Sheet với trạng thái [Đang xử lý].\n"
                        "3. Tự động đọc code, chỉnh sửa, build kiểm tra lỗi và chụp ảnh màn hình.\n"
                        "4. Gửi kết quả và ảnh bằng chứng trực tiếp về đây, đồng thời cập nhật Google Sheet thành [Hoàn thành].\n\n"
                        "💡 **Bạn chỉ cần gõ nội dung cần sửa code trực tiếp vào đây!**"
                    )
                    send_telegram_message(chat_id, help_msg)
                    continue

                if text == "/id":
                    send_telegram_message(chat_id, f"🆔 ID Telegram của bạn là: `{user_id}`")
                    continue

                # 1. GHI VAO GOOGLE SHEET TRUOC KHI LAM
                send_telegram_message(chat_id, f"⏳ Đang ghi nhận yêu cầu vào Google Sheet...")
                task_id = log_task_start(username, text)
                send_telegram_message(chat_id, f"📝 Đã ghi nhận yêu cầu vào Google Sheet (Task ID: #{task_id})!\n🤖 Đang phân tích và bắt đầu sửa code...")

                # Callback cap nhat tien trinh qua Telegram
                def progress(info):
                    print(f"[{task_id}] {info}")

                # 2. CHAY AGENT GEMINI
                try:
                    summary, screenshot_path = run_agent_task(text, chat_id, progress_callback=progress)
                    
                    # 3. GUI ANH BANG CHUNG NEU CO
                    if screenshot_path and os.path.exists(screenshot_path):
                        send_telegram_photo(chat_id, screenshot_path, caption=f"📸 Bằng chứng kiểm thử - Task #{task_id}")
                    
                    # 4. GUI BAO CAO HOAN THANH VE TELEGRAM
                    result_msg = f"✅ **ĐÃ HOÀN THÀNH NHIỆM VỤ #{task_id}!**\n\n📋 **Kết quả:**\n{summary}"
                    send_telegram_message(chat_id, result_msg)
                    
                    # 5. CAP NHAT GOOGLE SHEET THANH HOAN THANH
                    log_task_finish(task_id, "Hoàn thành", summary, screenshot_path)
                    print(f"🎉 Hoàn thành Task #{task_id} thành công!")

                except Exception as ex:
                    traceback.print_exc()
                    err_details = f"Lỗi: {ex}"
                    send_telegram_message(chat_id, f"❌ Có lỗi xảy ra trong quá trình xử lý:\n{err_details}")
                    log_task_finish(task_id, "Thất bại", err_details)

        except Exception as e:
            print(f"Polling loop exception: {e}")
            time.sleep(3)

if __name__ == "__main__":
    run_bot()
