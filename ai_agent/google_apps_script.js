/**
 * GOOGLE APPS SCRIPT CHO GOOGLE SHEET QUẢN LÝ NHIỆM VỤ AI CODING BOT
 * Hướng dẫn cài đặt vào Google Sheet:
 * 1. Mở link Google Sheet: https://docs.google.com/spreadsheets/d/1GWXxgt2-KptY4Rp3P2HtBVnkuWVplWHGpd6F9NTl4K8/edit
 * 2. Trên thanh menu, chọn: Tiện ích mở rộng (Extensions) -> Apps Script
 * 3. Xóa hết code cũ, dán toàn bộ đoạn code dưới đây vào.
 * 4. Nhấn nút "Lưu" (Save - biểu tượng đĩa mềm).
 * 5. Nhấn nút "Triển khai" (Deploy) ở góc trên bên phải -> "Tùy chọn triển khai mới" (New deployment).
 * 6. Chọn loại (Select type): "Ứng dụng web" (Web app).
 * 7. Thiết lập:
 *    - Mô tả: Bot Logger
 *    - Thực thi dưới dạng (Execute as): "Tôi" (Me)
 *    - Ai có quyền truy cập (Who has access): "Bất kỳ ai" (Anyone)
 * 8. Nhấn "Triển khai" (Deploy) -> Cấp quyền (Authorize access) cho tài khoản Google của bạn.
 * 9. Copy URL ứng dụng web (dạng https://script.google.com/macros/s/.../exec) và dán vào config.json ("google_sheet_webhook_url")
 */

function setupHeaders() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var headers = [
    "Thời Gian", 
    "Người Yêu Cầu", 
    "Nội Dung Yêu Cầu", 
    "Trạng Thái", 
    "Chi Tiết Cập Nhật", 
    "Bằng Chứng / Hình Ảnh"
  ];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#4a86e8").setFontColor("#ffffff");
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "ok", 
    message: "Google Apps Script Webhook is active!"
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    setupHeaders();
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);
    var action = data.action || "add_task";
    
    if (action === "add_task") {
      var rowData = [
        data.timestamp || new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
        data.user || "Unknown",
        data.prompt || "",
        data.status || "Đang xử lý",
        data.details || "",
        data.image_url || ""
      ];
      sheet.appendRow(rowData);
      var rowNum = sheet.getLastRow();
      
      // Tô màu vàng cho dòng Đang xử lý
      sheet.getRange(rowNum, 4).setBackground("#fff2cc").setFontColor("#b45f06");
      
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        row_id: rowNum
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === "update_task") {
      var rowId = data.row_id;
      if (rowId && rowId <= sheet.getLastRow()) {
        if (data.status) {
          var statusCell = sheet.getRange(rowId, 4);
          statusCell.setValue(data.status);
          if (data.status.indexOf("Hoàn thành") !== -1) {
            statusCell.setBackground("#d9ead3").setFontColor("#38761d"); // Xanh lá
          } else if (data.status.indexOf("Thất bại") !== -1 || data.status.indexOf("Lỗi") !== -1) {
            statusCell.setBackground("#fce5cd").setFontColor("#cc0000"); // Đỏ
          }
        }
        if (data.details) {
          sheet.getRange(rowId, 5).setValue(data.details);
        }
        if (data.image_url) {
          sheet.getRange(rowId, 6).setValue(data.image_url);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        updated_row: rowId
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "Unknown action"
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
