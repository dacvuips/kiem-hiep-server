package main

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

// Cập nhật client (APK launcher): APK chỉ chứa trình tải; nội dung game là các gói .pck tải về máy.
//   GET /v1/client/manifest      -> CLIENT_DIR/manifest.json (danh sách gói + sha256, do tools/build_client_update.sh tạo)
//   GET /client/files/{file}     -> CLIENT_DIR/files/{file} (hỗ trợ Range để tải tiếp khi rớt mạng)
// Tên file gói có mã băm nội dung (core-1a2b3c4d.pck) nên cache lâu được; manifest thì không cache.
// Production nên để CDN/nginx phục vụ /client/files/ — handler này đủ dùng khi chưa có CDN.

var clientFileName = regexp.MustCompile(`^[a-z0-9_-]{1,64}\.pck$`)

func (s *server) handleClientManifest(w http.ResponseWriter, r *http.Request) error {
	data, err := os.ReadFile(filepath.Join(s.cfg.ClientDir, "manifest.json"))
	if err != nil {
		return newErr(http.StatusServiceUnavailable, "no_client_build", "Máy chủ chưa có bản cài đặt game")
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, err = w.Write(data)
	return err
}

func (s *server) handleClientFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	if !clientFileName.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	// Gói vài trăm MB tải qua 4G lâu hơn nhiều WriteTimeout chung của server (15 giây).
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(2 * time.Hour))
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, filepath.Join(s.cfg.ClientDir, "files", name))
}
