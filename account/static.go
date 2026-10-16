package main

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// portalWeb phục vụ trang web người chơi (đăng ký, nạp thẻ, quản lý tài khoản) tại "/". Cùng CSP chặt như web Admin.
func portalWeb(dir string) http.Handler {
	return spaHandler(dir)
}

// adminWeb phục vụ web Admin đã build (Vite) tại /admin/. Đường dẫn không phải file -> index.html (ứng dụng 1 trang).
// CSP chặt: chỉ chạy script/style/font/ảnh từ chính server, không nhúng được vào trang khác.
func adminWeb(dir string) http.Handler {
	return http.StripPrefix("/admin", spaHandler(dir))
}

// spaHandler: file tĩnh của ứng dụng 1 trang (Vite); đường dẫn không phải file -> index.html.
func spaHandler(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
		"font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", csp)
		p := path.Clean("/" + r.URL.Path)
		if st, err := os.Stat(filepath.Join(dir, filepath.FromSlash(p))); err != nil || st.IsDir() {
			w.Header().Set("Cache-Control", "no-store")
			http.ServeFile(w, r, filepath.Join(dir, "index.html"))
			return
		}
		if strings.HasPrefix(p, "/assets/") { // tên file có mã băm nội dung -> cache lâu
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		files.ServeHTTP(w, r)
	})
}
